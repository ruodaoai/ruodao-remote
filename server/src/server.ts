import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { Registry, type Peer } from "./registry";
import { parseIceEnv, type IceOptions } from "./ice";
import { AdminAuth, hashAdminPassword, isPasswordHash } from "./admin-auth";
import {
  StateStore,
  normalizeInviteCode,
  type InviteRecord,
  type RegistrationMode,
  type ServerPolicy,
} from "./store";
import { ADMIN_PAGE_HTML } from "./admin-page";
import {
  ConnectionGuard,
  LoginGuard,
  RateLimiter,
  SecurityLogWriter,
  timingSafeEqualString,
  type LoginGuardOptions,
} from "./security";
import type { DeviceStatus, ServerStatsInfo } from "./protocol";
import { SERVER_VERSION } from "./version";
import { createTelemetryService, type TelemetryService } from "./telemetry";
import {
  createServerUpdateService,
  type ServerUpdateOptions,
  type ServerUpdateService,
} from "./update";

export interface RemoteServerOptions {
  host?: string;
  port?: number;
  trustProxy?: boolean;
  ice?: IceOptions;
  maxAttemptsPerMinute?: number;
  heartbeatMs?: number;
  allowedOrigins?: string[];
  log?: (event: string, meta?: Record<string, unknown>) => void;
  store?: StateStore;
  dataFile?: string | null;
  adminPassword?: string | null;
  adminPasswordHash?: string | null;
  adminSessionMs?: number;
  adminLoginGuard?: LoginGuardOptions;
  registrationMode?: RegistrationMode;
  serverName?: string;
  policy?: Partial<ServerPolicy>;
  publicUrl?: string;
  controlRequestTtlMs?: number;
  controlTokenTtlMs?: number;
  healthToken?: string | null;
  adminPath?: string | null;
  securityLogFile?: string | null;
  maxConnectionsPerIp?: number;
  maxTotalConnections?: number;
  messageLimitPer10s?: number;
  httpRequestsPerMinute?: number;
  serverStatsIntervalMs?: number;
  update?: Omit<ServerUpdateOptions, "log"> | null;
}

export interface RemoteServer {
  httpServer: Server;
  wss: WebSocketServer;
  registry: Registry;
  store: StateStore;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

interface TrackedSocket extends WebSocket {
  isAlive: boolean;
}

const VERSION = SERVER_VERSION;
const MAX_PAYLOAD_BYTES = 128 * 1024;
const MAX_ADMIN_BODY_BYTES = 64 * 1024;
const ADMIN_COOKIE = "ruodao_admin";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
};

function normalizeAdminPath(value: string | null | undefined): { page: string; api: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/admin" || trimmed === "admin") {
    return { page: "/admin", api: "/api/admin" };
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const page = withSlash.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._~-]{5,63}$/.test(page)) {
    throw new Error(
      "ADMIN_PATH 格式不正确：需要 6-64 位字母、数字、点、下划线或连字符，例如 /manage-a1b2c3d4",
    );
  }
  return { page, api: `${page}/api` };
}

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (first) {
      const value = first.split(",")[0]?.trim();
      if (value) return value;
    }
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

function originAllowed(origin: string | undefined, allowed: string[], selfHost: string): boolean {
  if (!origin) return true;
  if (origin === "null" || origin.startsWith("file://")) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (allowed.includes(origin) || allowed.includes(parsed.host)) return true;
  if (allowed.length > 0) return false;
  const host = selfHost.split(",")[0]?.trim().toLowerCase();
  if (host && parsed.host.toLowerCase() === host) return true;
  return (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
  );
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
    ...headers,
  });
  response.end(payload);
}

function adminJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  json(response, status, body, headers);
}

function lockedResponse(response: ServerResponse, retryAfterMs: number): void {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  adminJson(
    response,
    429,
    {
      error: "login-locked",
      message: `登录失败次数过多，已临时锁定，请 ${seconds} 秒后再试。`,
      retryAfter: seconds,
    },
    { "retry-after": String(seconds) },
  );
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  response.end(body);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

function isSecureRequest(request: IncomingMessage, trustProxy: boolean): boolean {
  if ("encrypted" in request.socket && request.socket.encrypted) return true;
  if (!trustProxy) return false;
  const proto = request.headers["x-forwarded-proto"];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return typeof value === "string" && value.split(",")[0]?.trim() === "https";
}

function adminToken(request: IncomingMessage): { token: string; source: "bearer" | "cookie" } | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { token, source: "bearer" };
  }
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.get(ADMIN_COOKIE);
  return token ? { token, source: "cookie" } : null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_ADMIN_BODY_BYTES) {
      throw new Error("body-too-large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid-json");
  }
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function readInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const number = Math.floor(value);
  if (number < min || number > max) return null;
  return number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function inviteActive(invite: InviteRecord, now: number): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt !== null && invite.expiresAt <= now) return false;
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return false;
  return true;
}

export function createRemoteServer(options: RemoteServerOptions = {}): RemoteServer {
  const ice = options.ice ?? parseIceEnv(process.env);
  const log = options.log ?? (() => {});
  const allowedOrigins = options.allowedOrigins ?? [];
  const trustProxy = options.trustProxy ?? false;
  const store =
    options.store ??
    new StateStore({
      filePath: options.dataFile ?? null,
      log,
      registrationMode: options.registrationMode,
      serverName: options.serverName,
      policy: options.policy,
    });
  const publicUrl = (options.publicUrl ?? "").replace(/\/+$/, "");
  const adminPath = normalizeAdminPath(options.adminPath);
  const adminHtml = ADMIN_PAGE_HTML.split("/api/admin").join(adminPath.api);
  const healthToken = options.healthToken?.trim() || null;
  const securityLog = new SecurityLogWriter(options.securityLogFile ?? null);
  const httpLimiter = new RateLimiter(options.httpRequestsPerMinute ?? 600, 60_000);
  const guard = new ConnectionGuard({
    maxConnectionsPerIp: options.maxConnectionsPerIp,
    maxTotalConnections: options.maxTotalConnections,
    messageLimit: options.messageLimitPer10s,
    onBan: (ip, reason, durationMs) => {
      securityLog.write("security.ban", ip, { reason, durationMs });
      log("security.ban", { ip, reason, durationMs });
    },
  });

  let telemetry: TelemetryService | null = null;

  let passwordHash = options.adminPasswordHash?.trim() || null;
  if (passwordHash && !isPasswordHash(passwordHash)) {
    throw new Error("ADMIN_PASSWORD_HASH 格式不正确");
  }
  if (!passwordHash && options.adminPassword) {
    passwordHash = hashAdminPassword(options.adminPassword);
  }
  const adminAuth = new AdminAuth(passwordHash, { ttlMs: options.adminSessionMs });
  const loginLimiter = new RateLimiter(8, 60_000);
  const loginGuard = new LoginGuard(options.adminLoginGuard);
  const adminLimiter = new RateLimiter(240, 60_000);
  const startedAt = Date.now();

  const registry = new Registry({
    store,
    ice,
    maxAttemptsPerMinute: options.maxAttemptsPerMinute,
    log,
    publicUrl,
    controlRequestTtlMs: options.controlRequestTtlMs,
    controlTokenTtlMs: options.controlTokenTtlMs,
  });

  const updateService: ServerUpdateService | null = options.update
    ? createServerUpdateService({
        ...options.update,
        log,
        canApply: options.update.canApply ?? (() => registry.stats().sessions === 0),
      })
    : null;
  updateService?.start();

  telemetry = createTelemetryService({
    sampleIntervalMs: options.serverStatsIntervalMs ?? 5000,
    log,
    onSample: (sample) => {
      const counts = registry.stats();
      const policy = registry.policy();
      const activeBlocks = store
        .listBlocks()
        .filter((block) => block.expiresAt === null || block.expiresAt > sample.at).length;
      const stats: ServerStatsInfo = {
        at: sample.at,
        bandwidthInKbps: sample.bandwidthInKbps,
        bandwidthOutKbps: sample.bandwidthOutKbps,
        wsInKbps: sample.wsInKbps,
        wsOutKbps: sample.wsOutKbps,
        sessionKbps: counts.sessionKbps,
        sessions: counts.sessions,
        maxSessions: counts.maxSessions,
        remainingSlots: counts.remainingSlots,
        peers: counts.peers,
        load1: sample.load1,
        cpuPct: sample.cpuPct,
        lagMs: sample.lagMs,
        memoryPct: sample.memoryPct,
        uptimeSeconds: sample.uptimeSeconds,
        sessionLimitMinutes: policy.sessionLimitMinutes,
        cooldownMinutes: policy.cooldownMinutes,
        activeBlocks,
        activeCooldowns: counts.activeCooldowns,
      };
      registry.broadcastServerStats(stats);
    },
  });
  telemetry.start();

  async function handleAdminLogin(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST") {
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }
    const ip = clientIp(request, trustProxy);
    const guard = loginGuard.check(ip);
    if (!guard.allowed) {
      store.audit(
        "admin.login-locked",
        "anonymous",
        `来自 ${ip} 的登录仍处于锁定状态`,
      );
      securityLog.write("security.admin-login-locked", ip, {
        retryAfterMs: guard.retryAfterMs,
      });
      lockedResponse(response, guard.retryAfterMs);
      return;
    }
    if (!loginLimiter.hit(ip) || !adminLimiter.hit(ip)) {
      securityLog.write("security.admin-login-rate-limited", ip, {});
      adminJson(response, 429, {
        error: "rate-limited",
        message: "登录尝试过于频繁，请一分钟后再试。",
      });
      return;
    }
    if (!adminAuth.configured) {
      adminJson(response, 503, {
        error: "admin-not-configured",
        message: "服务端未配置管理员密码，请在部署时设置 ADMIN_PASSWORD。",
      });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = asRecord(await readJsonBody(request));
    } catch (error) {
      adminJson(response, 400, {
        error: error instanceof Error ? error.message : "invalid-json",
      });
      return;
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 256) {
      adminJson(response, 400, { error: "invalid-password" });
      return;
    }
    const session = adminAuth.login(password);
    if (!session) {
      const verdict = loginGuard.fail(ip);
      store.audit("admin.login-failed", "anonymous", `来自 ${ip} 的登录失败`);
      securityLog.write("security.admin-login-failed", ip, {});
      if (!verdict.allowed) {
        store.audit(
          "admin.login-locked",
          "anonymous",
          `来自 ${ip} 的登录失败次数过多，已锁定 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒`,
        );
        securityLog.write("security.admin-login-locked", ip, {
          retryAfterMs: verdict.retryAfterMs,
        });
        lockedResponse(response, verdict.retryAfterMs);
        return;
      }
      adminJson(response, 401, {
        error: "invalid-password",
        message: "管理员密码不正确。",
      });
      return;
    }
    loginGuard.succeed(ip);
    loginLimiter.reset(ip);
    store.audit("admin.login", "admin", `来自 ${ip} 的登录`);
    securityLog.write("security.admin-login", ip, {});
    const secure = isSecureRequest(request, trustProxy);
    const maxAge = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
    response.setHeader(
      "set-cookie",
      `${ADMIN_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${
        secure ? "; Secure" : ""
      }`,
    );
    adminJson(response, 200, {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  }

  function verifyAdminRequest(
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
  ): boolean {
    const auth = adminToken(request);
    if (!auth) {
      adminJson(response, 401, { error: "unauthorized", message: "请先登录管理后台。" });
      return false;
    }
    if (!adminAuth.verify(auth.token)) {
      adminJson(response, 401, { error: "unauthorized", message: "登录已过期，请重新登录。" });
      return false;
    }
    if (auth.source === "cookie" && method !== "GET" && method !== "HEAD") {
      const origin = request.headers.origin;
      if (origin) {
        try {
          const parsed = new URL(origin);
          if (parsed.host !== request.headers.host) {
            adminJson(response, 403, { error: "origin-rejected" });
            return false;
          }
        } catch {
          adminJson(response, 403, { error: "origin-rejected" });
          return false;
        }
      }
    }
    return true;
  }

  async function handleAdminApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const ip = clientIp(request, trustProxy);
    if (!adminLimiter.hit(ip)) {
      adminJson(response, 429, { error: "rate-limited" });
      return;
    }
    const method = request.method ?? "GET";
    const pathname = url.pathname;

    if (pathname === "/api/admin/login") {
      await handleAdminLogin(request, response);
      return;
    }

    if (pathname === "/api/admin/logout" && method === "POST") {
      response.setHeader(
        "set-cookie",
        `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      );
      adminJson(response, 200, { ok: true });
      return;
    }

    if (!adminAuth.configured) {
      adminJson(response, 503, {
        error: "admin-not-configured",
        message: "服务端未配置管理员密码。",
      });
      return;
    }
    if (!verifyAdminRequest(request, response, method)) return;

    if (pathname === "/api/admin/me" && method === "GET") {
      const auth = adminToken(request);
      const payload = auth ? adminAuth.verify(auth.token) : null;
      adminJson(response, 200, {
        ok: true,
        expiresAt: payload?.exp ?? null,
        server: {
          name: store.settings.serverName,
          version: VERSION,
          publicUrl,
          registrationMode: store.settings.registrationMode,
          policy: store.policy,
        },
      });
      return;
    }

    if (pathname === "/api/admin/overview" && method === "GET") {
      const snapshot = registry.snapshot();
      const now = Date.now();
      const devices = snapshot.devices;
      const invites = store.listInvites();
      const blocks = store.listBlocks();
      adminJson(response, 200, {
        ok: true,
        server: {
          name: store.settings.serverName,
          version: VERSION,
          publicUrl,
          registrationMode: store.settings.registrationMode,
          uptimeSeconds: Math.floor((now - startedAt) / 1000),
          startedAt,
        },
        policy: store.policy,
        stats: {
          ...registry.stats(),
          approvedDevices: devices.filter((item) => item.status === "approved").length,
          pendingDevices: devices.filter((item) => item.status === "pending").length,
          blockedDevices: devices.filter((item) => item.status === "blocked").length,
          activeSessions: snapshot.sessions.length,
          activeInvites: invites.filter((item) => inviteActive(item, now)).length,
          activeBlocks: blocks.filter(
            (block) => block.expiresAt === null || block.expiresAt > now,
          ).length,
        },
        blocks,
        cooldowns: store.listCooldowns(now),
        network: telemetry?.snapshot() ?? null,
        security: guard.stats(),
      });
      return;
    }

    if (pathname === "/api/admin/devices" && method === "GET") {
      const onlineOnly = url.searchParams.get("online") === "1";
      const snapshot = registry.snapshot();
      const devices = onlineOnly
        ? snapshot.devices.filter((item) => item.online)
        : snapshot.devices;
      adminJson(response, 200, { ok: true, devices });
      return;
    }

    const deviceMatch = pathname.match(/^\/api\/admin\/devices\/([^/]+)(?:\/(disconnect))?$/);
    if (deviceMatch) {
      const deviceId = decodeURIComponent(deviceMatch[1]);
      if (deviceMatch[2] === "disconnect" && method === "POST") {
        const kicked = registry.disconnectDevice(deviceId);
        store.audit("device.disconnect", "admin", "管理员断开客户端", deviceId);
        adminJson(response, 200, { ok: true, kicked });
        return;
      }
      if (method === "PATCH") {
        let body: Record<string, unknown>;
        try {
          body = asRecord(await readJsonBody(request));
        } catch (error) {
          adminJson(response, 400, {
            error: error instanceof Error ? error.message : "invalid-json",
          });
          return;
        }
        const status = body.status;
        if (status !== "approved" && status !== "pending" && status !== "blocked") {
          adminJson(response, 400, { error: "invalid-status" });
          return;
        }
        const device = registry.setDeviceStatus(deviceId, status as DeviceStatus);
        if (!device) {
          adminJson(response, 404, { error: "not-found" });
          return;
        }
        store.audit(
          "device.status",
          "admin",
          status === "approved" ? "允许远控" : status === "blocked" ? "禁止远控" : "转为待审核",
          deviceId,
        );
        adminJson(response, 200, { ok: true, device });
        return;
      }
      if (method === "DELETE") {
        const removed = registry.removeDevice(deviceId);
        if (!removed) {
          adminJson(response, 404, { error: "not-found" });
          return;
        }
        store.audit("device.remove", "admin", "移除客户端记录", deviceId);
        adminJson(response, 200, { ok: true });
        return;
      }
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    if (pathname === "/api/admin/sessions" && method === "GET") {
      adminJson(response, 200, { ok: true, sessions: registry.snapshot().sessions });
      return;
    }

    if (pathname === "/api/admin/sessions/history" && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      adminJson(response, 200, {
        ok: true,
        sessions: store.listSessionLogs(limit),
      });
      return;
    }

    const sessionMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/end$/);
    if (sessionMatch && method === "POST") {
      const ended = registry.endSession(decodeURIComponent(sessionMatch[1]));
      store.audit("session.end", "admin", "管理员结束会话");
      adminJson(response, 200, { ok: true, ended });
      return;
    }

    if (pathname === "/api/admin/invites") {
      if (method === "GET") {
        const now = Date.now();
        const invites = store.listInvites().map((invite) => ({
          ...invite,
          active: inviteActive(invite, now),
        }));
        adminJson(response, 200, { ok: true, invites });
        return;
      }
      if (method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = asRecord(await readJsonBody(request));
        } catch (error) {
          adminJson(response, 400, {
            error: error instanceof Error ? error.message : "invalid-json",
          });
          return;
        }
        const label = readString(body.label, 40) ?? "未命名邀请码";
        const maxUsesRaw = Number(body.maxUses ?? 0);
        const expiresDaysRaw = Number(body.expiresInDays ?? 0);
        if (!Number.isFinite(maxUsesRaw) || maxUsesRaw < 0 || maxUsesRaw > 1000) {
          adminJson(response, 400, { error: "invalid-max-uses" });
          return;
        }
        if (!Number.isFinite(expiresDaysRaw) || expiresDaysRaw < 0 || expiresDaysRaw > 3650) {
          adminJson(response, 400, { error: "invalid-expiry" });
          return;
        }
        const invite = store.createInvite({
          label,
          createdBy: "admin",
          maxUses: Math.floor(maxUsesRaw),
          expiresInMs:
            Math.floor(expiresDaysRaw) > 0 ? Math.floor(expiresDaysRaw) * 86_400_000 : null,
        });
        store.audit("invite.create", "admin", `创建邀请码 ${invite.code}（${label}）`);
        adminJson(response, 201, { ok: true, invite });
        return;
      }
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    const inviteMatch = pathname.match(/^\/api\/admin\/invites\/([^/]+)(?:\/(revoke))?$/);
    if (inviteMatch) {
      const code = normalizeInviteCode(decodeURIComponent(inviteMatch[1]));
      if (inviteMatch[2] === "revoke" && method === "POST") {
        const invite = store.revokeInvite(code);
        if (!invite) {
          adminJson(response, 404, { error: "not-found" });
          return;
        }
        store.audit("invite.revoke", "admin", `撤销邀请码 ${code}`);
        adminJson(response, 200, { ok: true, invite });
        return;
      }
      if (method === "DELETE") {
        const removed = store.removeInvite(code);
        if (!removed) {
          adminJson(response, 404, { error: "not-found" });
          return;
        }
        store.audit("invite.remove", "admin", `删除邀请码 ${code}`);
        adminJson(response, 200, { ok: true });
        return;
      }
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    if (pathname === "/api/admin/activity" && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      adminJson(response, 200, { ok: true, entries: store.listAudit(limit) });
      return;
    }

    if (pathname === "/api/admin/blocks") {
      if (method === "GET") {
        adminJson(response, 200, {
          ok: true,
          blocks: store.listBlocks(),
          cooldowns: store.listCooldowns(),
          policy: store.policy,
        });
        return;
      }
      if (method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = asRecord(await readJsonBody(request));
        } catch (error) {
          adminJson(response, 400, {
            error: error instanceof Error ? error.message : "invalid-json",
          });
          return;
        }
        const kind = body.kind;
        if (kind !== "device" && kind !== "ip") {
          adminJson(response, 400, {
            error: "invalid-kind",
            message: "kind 必须是 device 或 ip。",
          });
          return;
        }
        const value = readString(body.value, 64);
        if (!value) {
          adminJson(response, 400, { error: "invalid-value", message: "请填写设备 ID 或 IP。" });
          return;
        }
        if (kind === "device" && !/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
          adminJson(response, 400, { error: "invalid-device-id" });
          return;
        }
        if (kind === "ip" && isIP(value) === 0) {
          adminJson(response, 400, { error: "invalid-ip", message: "IP 地址格式不正确。" });
          return;
        }
        const permanent = body.permanent === true;
        const minutesRaw = Number(body.minutes ?? store.policy.freezeMinutes);
        if (
          !permanent &&
          (!Number.isFinite(minutesRaw) || minutesRaw < 1 || minutesRaw > 10080)
        ) {
          adminJson(response, 400, {
            error: "invalid-duration",
            message: "冻结时长需要在 1-10080 分钟之间。",
          });
          return;
        }
        const minutes = Math.floor(minutesRaw);
        const label = readString(body.label, 64) ?? value;
        const reason =
          readString(body.reason, 120) ??
          (permanent ? "管理员拉黑" : `管理员冻结 ${minutes} 分钟`);
        const record = registry.addAccessBlock({
          kind,
          value,
          label,
          reason,
          minutes: permanent ? null : minutes,
        });
        store.audit(
          permanent ? "access.block" : "access.freeze",
          "admin",
          `${kind === "device" ? "设备" : "IP"} ${record.value}：${reason}${
            permanent ? "（永久拉黑）" : `（${minutes} 分钟）`
          }`,
          kind === "device" ? record.value : undefined,
        );
        securityLog.write(permanent ? "security.access-block" : "security.access-freeze", value, {
          kind,
          minutes: permanent ? null : minutes,
          reason,
        });
        adminJson(response, 201, { ok: true, block: record });
        return;
      }
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    const blockMatch = pathname.match(/^\/api\/admin\/blocks\/([^/]+)$/);
    if (blockMatch && method === "DELETE") {
      const record = registry.removeAccessBlock(decodeURIComponent(blockMatch[1]));
      if (!record) {
        adminJson(response, 404, { error: "not-found" });
        return;
      }
      store.audit(
        "access.unblock",
        "admin",
        `解除${record.kind === "device" ? "设备" : "IP"} ${record.value} 的限制`,
        record.kind === "device" ? record.value : undefined,
      );
      securityLog.write("security.access-unblock", record.value, { kind: record.kind });
      adminJson(response, 200, { ok: true, block: record });
      return;
    }

    const cooldownMatch = pathname.match(/^\/api\/admin\/cooldowns\/(.+)$/);
    if (cooldownMatch && method === "DELETE") {
      const key = decodeURIComponent(cooldownMatch[1]);
      if (!/^(device|ip):.{1,70}$/.test(key)) {
        adminJson(response, 400, { error: "invalid-key" });
        return;
      }
      const cleared = registry.clearCooldown(key);
      if (!cleared) {
        adminJson(response, 404, { error: "not-found" });
        return;
      }
      store.audit("cooldown.clear", "admin", `解除冷却限制 ${key}`);
      adminJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/admin/settings") {
      if (method === "GET") {
        adminJson(response, 200, {
          ok: true,
          settings: store.settings,
          policy: store.policy,
          publicUrl,
          version: VERSION,
        });
        return;
      }
      if (method === "PATCH") {
        let body: Record<string, unknown>;
        try {
          body = asRecord(await readJsonBody(request));
        } catch (error) {
          adminJson(response, 400, {
            error: error instanceof Error ? error.message : "invalid-json",
          });
          return;
        }
        const patch: { registrationMode?: RegistrationMode; serverName?: string } = {};
        if (body.registrationMode !== undefined) {
          const mode = body.registrationMode;
          if (mode !== "invite" && mode !== "approval" && mode !== "open") {
            adminJson(response, 400, { error: "invalid-registration-mode" });
            return;
          }
          patch.registrationMode = mode;
        }
        if (body.serverName !== undefined) {
          const name = readString(body.serverName, 64);
          if (!name) {
            adminJson(response, 400, { error: "invalid-server-name" });
            return;
          }
          patch.serverName = name;
        }
        const source = asRecord(body.policy);
        const policyPatch: Partial<ServerPolicy> = {};
        const limits: Array<{
          key: keyof ServerPolicy;
          min: number;
          max: number;
        }> = [
          { key: "maxSessions", min: 0, max: 10000 },
          { key: "sessionLimitMinutes", min: 0, max: 1440 },
          { key: "cooldownMinutes", min: 0, max: 1440 },
          { key: "freezeMinutes", min: 1, max: 10080 },
        ];
        for (const limit of limits) {
          const raw = source[limit.key] !== undefined ? source[limit.key] : body[limit.key];
          if (raw === undefined) continue;
          const value = readInt(raw, limit.min, limit.max);
          if (value === null) {
            adminJson(response, 400, {
              error: "invalid-policy",
              message: `${limit.key} 需要在 ${limit.min}-${limit.max} 之间。`,
            });
            return;
          }
          policyPatch[limit.key] = value;
        }
        const settings = store.updateSettings(patch);
        const policy = Object.keys(policyPatch).length
          ? registry.updatePolicy(policyPatch)
          : store.policy;
        store.audit(
          "settings.update",
          "admin",
          `接入模式：${settings.registrationMode}；名称：${settings.serverName}；最大远控人数：${
            policy.maxSessions || "不限"
          }；单次时长：${policy.sessionLimitMinutes || "不限"} 分钟；冷却：${
            policy.cooldownMinutes
          } 分钟；冻结默认：${policy.freezeMinutes} 分钟`,
        );
        adminJson(response, 200, { ok: true, settings, policy });
        return;
      }
      adminJson(response, 405, { error: "method-not-allowed" });
      return;
    }

    if (pathname === "/api/admin/update" && method === "GET") {
      adminJson(response, 200, {
        ok: true,
        update:
          updateService?.status() ?? {
            supported: false,
            enabled: false,
            reason: "当前部署未启用服务端更新。",
            currentVersion: VERSION,
            channel: "stable",
            phase: "idle",
            latest: null,
            staged: null,
            lastCheckedAt: null,
            autoApply: false,
            applyMode: "manual",
            manualCommand: null,
            error: null,
          },
      });
      return;
    }

    if (pathname === "/api/admin/update/check" && method === "POST") {
      if (!updateService) {
        adminJson(response, 503, {
          error: "update-disabled",
          message: "当前部署未启用服务端更新。",
        });
        return;
      }
      try {
        const update = await updateService.check();
        store.audit(
          "update.check",
          "admin",
          update.latest ? `检查服务端更新：最新版本 v${update.latest.version}` : "检查服务端更新",
        );
        adminJson(response, 200, { ok: true, update });
      } catch (error) {
        adminJson(response, 502, {
          error: "update-failed",
          message: error instanceof Error ? error.message : "检查更新失败",
        });
      }
      return;
    }

    if (pathname === "/api/admin/update/download" && method === "POST") {
      if (!updateService) {
        adminJson(response, 503, {
          error: "update-disabled",
          message: "当前部署未启用服务端更新。",
        });
        return;
      }
      try {
        const update = await updateService.download();
        store.audit(
          "update.download",
          "admin",
          `下载并校验服务端更新包 v${update.staged?.version ?? ""}`,
        );
        adminJson(response, 200, { ok: true, update });
      } catch (error) {
        adminJson(response, 502, {
          error: "update-failed",
          message: error instanceof Error ? error.message : "下载更新包失败",
        });
      }
      return;
    }

    if (pathname === "/api/admin/update/apply" && method === "POST") {
      if (!updateService) {
        adminJson(response, 503, {
          error: "update-disabled",
          message: "当前部署未启用服务端更新。",
        });
        return;
      }
      try {
        const result = await updateService.apply();
        store.audit(
          "update.apply",
          "admin",
          result.mode === "auto" ? "触发服务端自动更新" : "生成服务端手动更新命令",
        );
        adminJson(response, 200, {
          ok: true,
          result,
          update: updateService.status(),
        });
      } catch (error) {
        adminJson(response, 409, {
          error: "update-failed",
          message: error instanceof Error ? error.message : "应用更新失败",
        });
      }
      return;
    }

    adminJson(response, 404, { error: "not-found" });
  }

  function healthAuthorized(request: IncomingMessage, url: URL): boolean {
    if (!healthToken) return true;
    const header = request.headers["x-ruodao-health"];
    const provided =
      typeof header === "string"
        ? header
        : Array.isArray(header)
          ? (header[0] ?? "")
          : (url.searchParams.get("token") ?? "");
    return Boolean(provided) && timingSafeEqualString(healthToken, provided);
  }

  async function handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const ip = clientIp(request, trustProxy);
    if (!httpLimiter.hit(ip)) {
      securityLog.write("security.http-rate-limit", ip, {
        path: url.pathname.slice(0, 120),
      });
      json(response, 429, { error: "rate-limited" }, { "retry-after": "60" });
      return;
    }

    if (
      request.method === "OPTIONS" &&
      (url.pathname === adminPath.api || url.pathname.startsWith(`${adminPath.api}/`))
    ) {
      response.writeHead(204, {
        allow: "GET, POST, PATCH, DELETE, OPTIONS",
        ...SECURITY_HEADERS,
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      if (!healthAuthorized(request, url)) {
        json(response, 404, { error: "not-found" });
        return;
      }
      const counts = registry.stats();
      const policy = registry.policy();
      const capacity = {
        sessions: counts.sessions,
        maxSessions: counts.maxSessions,
        remainingSlots: counts.remainingSlots,
        sessionLimitMinutes: policy.sessionLimitMinutes,
        cooldownMinutes: policy.cooldownMinutes,
      };
      if (healthToken) {
        json(response, 200, {
          ok: true,
          name: "ruodao-remote-server",
          version: VERSION,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          ...capacity,
        });
        return;
      }
      json(response, 200, {
        ok: true,
        name: "ruodao-remote-server",
        version: VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        admin: adminAuth.configured,
        registrationMode: store.settings.registrationMode,
        ...capacity,
        ...counts,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/server-info") {
      const counts = registry.stats();
      const policy = registry.policy();
      json(response, 200, {
        ok: true,
        name: store.settings.serverName,
        version: VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        registrationMode: store.settings.registrationMode,
        sessions: counts.sessions,
        maxSessions: counts.maxSessions,
        remainingSlots: counts.remainingSlots,
        acceptingSessions: counts.remainingSlots === null || counts.remainingSlots > 0,
        sessionLimitMinutes: policy.sessionLimitMinutes,
        cooldownMinutes: policy.cooldownMinutes,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/version") {
      if (!healthAuthorized(request, url)) {
        json(response, 404, { error: "not-found" });
        return;
      }
      const update = updateService?.status() ?? null;
      json(response, 200, {
        name: "ruodao-remote-server",
        version: VERSION,
        channel: update?.channel ?? "stable",
        updateAvailable: update?.phase === "available" || update?.phase === "ready",
      });
      return;
    }

    if (
      request.method === "GET" &&
      (url.pathname === adminPath.page || url.pathname === `${adminPath.page}/`)
    ) {
      html(response, adminHtml);
      return;
    }

    if (url.pathname === adminPath.api || url.pathname.startsWith(`${adminPath.api}/`)) {
      const rest = url.pathname.slice(adminPath.api.length);
      const rewritten = new URL(`/api/admin${rest}${url.search}`, "http://localhost");
      await handleAdminApi(request, response, rewritten);
      return;
    }

    json(response, 404, { error: "not-found" });
  }

  const httpServer = createHttpServer((request, response) => {
    void handleHttp(request, response).catch((error: unknown) => {
      log("http.error", {
        message: error instanceof Error ? error.message : String(error),
        path: request.url,
      });
      if (!response.headersSent) {
        json(response, 500, { error: "internal-error" });
      } else {
        response.end();
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const ip = clientIp(request, trustProxy);
    const gate = guard.check(ip);
    if (!gate.allowed) {
      securityLog.write("security.ws-rejected", ip, {
        reason: gate.reason,
        retryAfterMs: gate.retryAfterMs,
      });
      const status = gate.reason === "banned" ? "403 Forbidden" : "429 Too Many Requests";
      try {
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      } catch {
        socket.destroy();
      }
      return;
    }
    if (
      !originAllowed(
        request.headers.origin,
        allowedOrigins,
        request.headers.host ?? (publicUrl ? new URL(publicUrl).host : ""),
      )
    ) {
      securityLog.write("security.origin-rejected", ip, {
        origin: String(request.headers.origin).slice(0, 120),
      });
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const tracked = ws as TrackedSocket;
    tracked.isAlive = true;
    const ip = clientIp(request, trustProxy);
    guard.connect(ip);
    const peer: Peer = registry.attach(
      {
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            telemetry?.addWsOut(Buffer.byteLength(data, "utf8"));
            ws.send(data);
          }
        },
        close: (code, reason) => ws.close(code, reason),
      },
      ip,
    );

    tracked.on("pong", () => {
      tracked.isAlive = true;
    });
    tracked.on("message", (data) => {
      const size = Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(String(data));
      telemetry?.addWsIn(size);
      if (!guard.allowMessage(ip)) {
        securityLog.write("security.ws-closed", ip, { reason: "message-flood" });
        try {
          tracked.close(1008, "rate-limited");
        } catch {
          tracked.terminate();
        }
        return;
      }
      registry.handleMessage(peer, data.toString());
    });
    tracked.on("error", () => {
      // Close handling below performs cleanup.
    });
    tracked.on("close", () => {
      guard.disconnect(ip);
      registry.detach(peer);
    });
  });

  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const tracked = client as TrackedSocket;
      if (tracked.isAlive === false) {
        tracked.terminate();
        continue;
      }
      tracked.isAlive = false;
      try {
        tracked.ping();
      } catch {
        tracked.terminate();
      }
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    httpServer,
    wss,
    registry,
    store,
    listen(): Promise<{ port: number }> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        httpServer.once("error", onError);
        httpServer.listen(options.port ?? 8787, options.host ?? "0.0.0.0", () => {
          httpServer.off("error", onError);
          const address = httpServer.address();
          const port = typeof address === "object" && address ? address.port : (options.port ?? 8787);
          resolve({ port });
        });
      });
    },
    close(): Promise<void> {
      clearInterval(heartbeat);
      updateService?.stop();
      telemetry?.stop();
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((resolve) => {
        store.flush();
        wss.close(() => resolve());
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
        if (!httpServer.listening) resolve();
      });
    },
  };
}
