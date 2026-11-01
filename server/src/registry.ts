import { randomBytes, randomUUID } from "node:crypto";
import type {
  CatalogHost,
  ClientMessage,
  ClientRejectReason,
  ControlDenyReason,
  DeviceStatus,
  HostControlRequestInfo,
  PeerInfo,
  Platform,
  RejectReason,
  ServerLimitsInfo,
  ServerMessage,
  ServerStatsInfo,
  SessionDangerEvent,
  SessionEventKind,
  SessionStatsPayload,
  SessionTelemetry,
} from "./protocol";
import { dangerActionLabel, encodeMessage, parseClientMessage } from "./protocol";
import { generateRemoteCode, RateLimiter, sanitizeName, timingSafeEqualHex } from "./security";
import { buildIceServers, parseIceEnv, type IceOptions } from "./ice";
import {
  StateStore,
  type AccessBlockRecord,
  type CooldownRecord,
  type DeviceRecord,
  type InviteRecord,
  type ServerPolicy,
  normalizeInviteCode,
} from "./store";

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type PeerRole = "pending" | "host" | "controller";

export interface Peer {
  id: string;
  socket: SocketLike;
  ip: string;
  role: PeerRole;
  code: string | null;
  sessionId: string | null;
  deviceId: string | null;
  connectedAt: number;
  lastSeen: number;
}

interface HostRecord {
  peer: Peer;
  code: string;
  keySalt: string;
  keyHash: string;
  name: string;
  platform: Platform;
  registeredAt: number;
  session: Session | null;
  published: boolean;
  note: string;
  publishedAt: number | null;
}

interface ControlRequest {
  id: string;
  host: HostRecord;
  peer: Peer;
  controllerName: string;
  controllerPlatform: Platform;
  createdAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface ApprovalToken {
  token: string;
  host: HostRecord;
  controllerDeviceId: string;
  controllerName: string;
  controllerPlatform: Platform;
  requestId: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface Session {
  id: string;
  code: string;
  host: HostRecord;
  controller: Peer;
  controllerName: string;
  controllerPlatform: Platform;
  createdAt: number;
  endsAt: number | null;
  limitTimer: NodeJS.Timeout | null;
  telemetry: SessionTelemetry | null;
  dangerEvents: SessionDangerEvent[];
}

export interface RegistryOptions {
  store: StateStore;
  ice?: IceOptions;
  maxAttemptsPerMinute?: number;
  now?: () => number;
  log?: (event: string, meta?: Record<string, unknown>) => void;
  publicUrl?: string;
  controlRequestTtlMs?: number;
  controlTokenTtlMs?: number;
}

export interface DeviceSnapshot extends DeviceRecord {
  online: boolean;
  roles: Array<"host" | "controller">;
  ip: string;
  code: string | null;
  sessionId: string | null;
  connectedAt: number | null;
  published: boolean;
  publishedNote: string;
}

export interface SessionSnapshot {
  id: string;
  code: string;
  createdAt: number;
  endsAt: number | null;
  durationMs: number;
  telemetry: SessionTelemetry | null;
  dangerEvents: SessionDangerEvent[];
  host: {
    deviceId: string | null;
    name: string;
    platform: Platform;
    ip: string;
  };
  controller: {
    deviceId: string | null;
    name: string;
    platform: Platform;
    ip: string;
  };
}

const RETRY_ALLOCATIONS = 64;
const MAX_PENDING_REQUESTS_PER_HOST = 5;

export class Registry {
  private readonly peers = new Map<string, Peer>();
  private readonly hostsByCode = new Map<string, HostRecord>();
  private readonly hostsByPeerId = new Map<string, HostRecord>();
  private readonly hostsByDeviceId = new Map<string, HostRecord>();
  private readonly sessions = new Map<string, Session>();
  private readonly requests = new Map<string, ControlRequest>();
  private readonly requestByPeerId = new Map<string, string>();
  private readonly tokens = new Map<string, ApprovalToken>();
  private readonly store: StateStore;
  private readonly ice: IceOptions;
  private readonly now: () => number;
  private readonly log: (event: string, meta?: Record<string, unknown>) => void;
  private readonly publicUrl: string;
  private readonly connectLimiter: RateLimiter;
  private readonly lookupLimiter: RateLimiter;
  private readonly registerLimiter: RateLimiter;
  private readonly codeLimiter: RateLimiter;
  private readonly helloLimiter: RateLimiter;
  private readonly requestLimiter: RateLimiter;
  private readonly statsLimiter: RateLimiter;
  private readonly eventLimiter: RateLimiter;
  private readonly requestTtlMs: number;
  private readonly tokenTtlMs: number;

  constructor(options: RegistryOptions) {
    this.store = options.store;
    this.ice = options.ice ?? parseIceEnv({});
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.publicUrl = options.publicUrl ?? "";
    this.requestTtlMs = Math.max(20, options.controlRequestTtlMs ?? 60_000);
    this.tokenTtlMs = Math.max(20, options.controlTokenTtlMs ?? 60_000);
    const attempts = Math.max(3, options.maxAttemptsPerMinute ?? 10);
    this.connectLimiter = new RateLimiter(attempts, 60_000, this.now);
    this.lookupLimiter = new RateLimiter(60, 60_000, this.now);
    this.registerLimiter = new RateLimiter(20, 60_000, this.now);
    this.codeLimiter = new RateLimiter(attempts * 3, 60_000, this.now);
    this.helloLimiter = new RateLimiter(40, 60_000, this.now);
    this.requestLimiter = new RateLimiter(20, 60_000, this.now);
    this.statsLimiter = new RateLimiter(120, 60_000, this.now);
    this.eventLimiter = new RateLimiter(60, 60_000, this.now);
  }

  attach(socket: SocketLike, ip: string): Peer {
    const now = this.now();
    const peer: Peer = {
      id: randomUUID(),
      socket,
      ip,
      role: "pending",
      code: null,
      sessionId: null,
      deviceId: null,
      connectedAt: now,
      lastSeen: now,
    };
    this.peers.set(peer.id, peer);
    return peer;
  }

  detach(peer: Peer): void {
    peer.lastSeen = this.now();
    const host = this.hostsByPeerId.get(peer.id);
    if (host) {
      this.removeHost(host, "host-closed");
    }
    this.cancelRequestForPeer(peer, "cancelled");
    if (peer.sessionId) {
      const session = this.sessions.get(peer.sessionId);
      if (session) this.closeSession(session, "controller-left", [peer]);
    }
    this.peers.delete(peer.id);
    if (peer.deviceId) {
      this.store.touchDevice(peer.deviceId, { at: this.now() });
    }
  }

  handleMessage(peer: Peer, raw: string): void {
    peer.lastSeen = this.now();
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      if (raw.includes('"client.hello"')) {
        this.rejectClient(peer, "invalid-hello", "客户端握手信息不完整，请升级到最新版本。");
      } else {
        this.sendError(peer, parsed.error, "Invalid message.");
      }
      return;
    }
    const message = parsed.message;

    switch (message.type) {
      case "client.hello":
        this.hello(peer, message);
        break;
      case "host.register":
        if (this.ensureDevice(peer, "host")) this.registerHost(peer, message);
        break;
      case "host.update-key":
        if (this.ensureDevice(peer, "host")) this.updateHostKey(peer, message);
        break;
      case "host.unregister":
        if (this.ensureDevice(peer, "host")) this.unregisterHost(peer);
        break;
      case "host.heartbeat":
        break;
      case "controller.lookup":
        if (this.ensureDevice(peer, "controller")) this.lookup(peer, message.code);
        break;
      case "controller.connect":
        if (this.ensureDevice(peer, "controller")) {
          this.connect(peer, message.code, message.keyHash, message.controllerName, message.platform);
        }
        break;
      case "controller.disconnect":
        this.disconnectController(peer);
        break;
      case "host.publish":
        if (this.ensureDevice(peer, "host")) {
          this.publishHost(peer, message.published, message.note ?? "");
        }
        break;
      case "host.control-decision":
        if (this.ensureDevice(peer, "host")) {
          this.decideControlRequest(peer, message.requestId, message.accept);
        }
        break;
      case "controller.request":
        if (this.ensureDevice(peer, "controller")) {
          this.requestControl(peer, message.hostDeviceId);
        }
        break;
      case "controller.connect-token":
        if (this.ensureDevice(peer, "controller")) {
          this.connectWithToken(peer, message.token, message.controllerName, message.platform);
        }
        break;
      case "session.stats":
        this.updateSessionStats(peer, message.stats);
        break;
      case "session.event":
        this.recordSessionEvent(peer, message.kind, message.action, message.detail);
        break;
      case "signal":
        this.relaySignal(peer, message.data);
        break;
      case "ping":
        this.send(peer, { type: "pong" });
        break;
      default:
        this.sendError(peer, "unknown-type", "Unsupported message type.");
    }
  }

  stats(): {
    peers: number;
    hosts: number;
    sessions: number;
    onlineDevices: number;
    publishedHosts: number;
    pendingRequests: number;
    sessionKbps: number;
    maxSessions: number;
    remainingSlots: number | null;
    activeCooldowns: number;
  } {
    const devices = new Set<string>();
    for (const peer of this.peers.values()) {
      if (peer.deviceId) devices.add(peer.deviceId);
    }
    let sessionKbps = 0;
    for (const session of this.sessions.values()) {
      if (session.telemetry) sessionKbps += Math.max(0, session.telemetry.kbps);
    }
    const maxSessions = this.store.policy.maxSessions;
    return {
      peers: this.peers.size,
      hosts: this.hostsByCode.size,
      sessions: this.sessions.size,
      onlineDevices: devices.size,
      publishedHosts: [...this.hostsByCode.values()].filter((host) => host.published).length,
      pendingRequests: this.requests.size,
      sessionKbps: Math.round(sessionKbps),
      maxSessions,
      remainingSlots: maxSessions > 0 ? Math.max(0, maxSessions - this.sessions.size) : null,
      activeCooldowns: this.store.listCooldowns().length,
    };
  }

  snapshot(): { devices: DeviceSnapshot[]; sessions: SessionSnapshot[] } {
    const online = new Map<
      string,
      {
        roles: Set<"host" | "controller">;
        ip: string;
        code: string | null;
        sessionId: string | null;
        connectedAt: number;
        peers: number;
      }
    >();
    for (const peer of this.peers.values()) {
      if (!peer.deviceId) continue;
      const current = online.get(peer.deviceId) ?? {
        roles: new Set<"host" | "controller">(),
        ip: peer.ip,
        code: null,
        sessionId: null,
        connectedAt: peer.connectedAt,
        peers: 0,
      };
      if (peer.role === "host" || peer.role === "controller") current.roles.add(peer.role);
      current.peers += 1;
      if (peer.role === "host") current.code = peer.code;
      if (peer.sessionId) current.sessionId = peer.sessionId;
      if (peer.connectedAt < current.connectedAt) current.connectedAt = peer.connectedAt;
      online.set(peer.deviceId, current);
    }

    const devices = this.store.listDevices().map((device) => {
      const live = online.get(device.id);
      const host = this.hostsByDeviceId.get(device.id);
      return {
        ...device,
        online: Boolean(live),
        roles: live ? [...live.roles] : [],
        ip: live?.ip ?? device.lastIp,
        code: live?.code ?? null,
        sessionId: live?.sessionId ?? null,
        connectedAt: live?.connectedAt ?? null,
        published: Boolean(host?.published),
        publishedNote: host?.note ?? "",
      };
    });

    const now = this.now();
    const sessions = [...this.sessions.values()].map((session) => ({
      id: session.id,
      code: session.code,
      createdAt: session.createdAt,
      endsAt: session.endsAt,
      durationMs: now - session.createdAt,
      telemetry: session.telemetry ? { ...session.telemetry } : null,
      dangerEvents: session.dangerEvents.map((event) => ({ ...event })),
      host: {
        deviceId: session.host.peer.deviceId,
        name: session.host.name,
        platform: session.host.platform,
        ip: session.host.peer.ip,
      },
      controller: {
        deviceId: session.controller.deviceId,
        name: session.controllerName,
        platform: session.controllerPlatform,
        ip: session.controller.ip,
      },
    }));

    return { devices, sessions };
  }

  getStore(): StateStore {
    return this.store;
  }

  listInvites(): InviteRecord[] {
    return this.store.listInvites();
  }

  setDeviceStatus(
    deviceId: string,
    status: DeviceStatus,
  ): DeviceRecord | null {
    const device = this.store.setDeviceStatus(deviceId, status);
    if (!device) return null;
    if (status !== "approved") {
      this.kickDevice(
        deviceId,
        status === "blocked" ? "blocked" : "device-pending",
        status === "blocked"
          ? "管理员已禁止此客户端进行远控。"
          : "管理员已暂停此客户端的远控权限。",
      );
    } else {
      for (const peer of this.peers.values()) {
        if (peer.deviceId === deviceId) this.sendCatalog(peer);
      }
      this.broadcastCatalog();
    }
    this.log("device.status-changed", { deviceId, status });
    return device;
  }

  disconnectDevice(deviceId: string): boolean {
    const kicked = this.kickDevice(
      deviceId,
      "admin-disconnect",
      "管理员已断开此客户端，请稍后重新连接。",
    );
    if (kicked) this.log("device.disconnected", { deviceId });
    return kicked;
  }

  removeDevice(deviceId: string): boolean {
    this.kickDevice(
      deviceId,
      "admin-disconnect",
      "管理员已将此客户端从服务器移除。",
    );
    const removed = this.store.removeDevice(deviceId);
    if (removed) this.log("device.removed", { deviceId });
    return removed;
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.closeSession(session, "admin-disconnect");
    this.log("session.ended-by-admin", { sessionId });
    return true;
  }

  policy(): ServerPolicy {
    return this.store.policy;
  }

  updatePolicy(patch: Partial<ServerPolicy>): ServerPolicy {
    const policy = this.store.updatePolicy(patch);
    this.log("policy.updated", { ...policy });
    return policy;
  }

  limits(): ServerLimitsInfo {
    const policy = this.store.policy;
    return {
      maxSessions: policy.maxSessions,
      sessionLimitMinutes: policy.sessionLimitMinutes,
      cooldownMinutes: policy.cooldownMinutes,
    };
  }

  listAccessBlocks(): AccessBlockRecord[] {
    return this.store.listBlocks();
  }

  addAccessBlock(input: {
    kind: "device" | "ip";
    value: string;
    label?: string;
    reason?: string;
    /** null 表示永久拉黑，数字表示冻结分钟数 */
    minutes: number | null;
  }): AccessBlockRecord {
    const durationMs =
      input.minutes === null ? null : Math.max(1, Math.floor(input.minutes)) * 60_000;
    const record = this.store.addBlock({
      kind: input.kind,
      value: input.value,
      label: input.label,
      reason: input.reason,
      createdBy: "admin",
      durationMs,
    });
    const permanent = record.expiresAt === null;
    const message = permanent
      ? "此设备已被服务器管理员拉黑，无法接入。"
      : `此设备已被管理员冻结，约 ${Math.max(
          1,
          Math.ceil(((record.expiresAt ?? 0) - this.now()) / 60_000),
        )} 分钟后可重新接入。`;
    this.kickMatching(
      (peer) =>
        (record.kind === "device" && peer.deviceId === record.value) ||
        (record.kind === "ip" && peer.ip.toLowerCase() === record.value),
      permanent ? "blocked" : "frozen",
      message,
    );
    this.log("access.blocked", {
      kind: record.kind,
      value: record.value,
      permanent,
      expiresAt: record.expiresAt,
    });
    return record;
  }

  removeAccessBlock(id: string): AccessBlockRecord | null {
    const record = this.store.removeBlock(id);
    if (record) {
      this.log("access.unblocked", { kind: record.kind, value: record.value });
    }
    return record;
  }

  listCooldowns(): CooldownRecord[] {
    return this.store.listCooldowns();
  }

  clearCooldown(key: string): boolean {
    const cleared = this.store.clearCooldown(key);
    if (cleared) this.log("cooldown.cleared", { key });
    return cleared;
  }

  broadcastServerStats(stats: ServerStatsInfo): void {
    for (const peer of this.peers.values()) {
      if (!peer.deviceId) continue;
      const device = this.store.getDevice(peer.deviceId);
      if (!device || device.status !== "approved") continue;
      this.send(peer, { type: "server.stats", stats });
    }
  }

  private sessionForPeer(peer: Peer): Session | undefined {
    return peer.sessionId ? this.sessions.get(peer.sessionId) : undefined;
  }

  private updateSessionStats(peer: Peer, stats: SessionStatsPayload): void {
    const session = this.sessionForPeer(peer);
    if (!session) return;
    if (!this.statsLimiter.hit(peer.ip)) return;
    session.telemetry = {
      ...stats,
      reporter: peer.id === session.host.peer.id ? "host" : "controller",
      updatedAt: this.now(),
    };
  }

  private recordSessionEvent(
    peer: Peer,
    kind: SessionEventKind,
    action: string,
    _detail: string | undefined,
  ): void {
    const session = this.sessionForPeer(peer);
    if (!session) return;
    if (!this.eventLimiter.hit(peer.ip)) return;
    if (kind !== "danger") return;
    const at = this.now();
    const last = session.dangerEvents[session.dangerEvents.length - 1];
    // Both ends may report the same shortcut; keep one record per occurrence.
    if (last && last.action === action && at - last.at < 2500) return;
    const event: SessionDangerEvent = {
      at,
      action,
      label: dangerActionLabel(action),
    };
    session.dangerEvents.push(event);
    if (session.dangerEvents.length > 50) {
      session.dangerEvents = session.dangerEvents.slice(-50);
    }
    this.log("session.danger", {
      sessionId: session.id,
      action,
      by: peer.id === session.host.peer.id ? "host" : "controller",
    });
  }

  private findAccessBlock(deviceId: string | null, ip: string): AccessBlockRecord | null {
    return this.store.findActiveBlock({ deviceId: deviceId ?? "", ip });
  }

  private blockMessage(record: AccessBlockRecord): string {
    if (record.expiresAt === null) {
      return "此设备已被服务器管理员拉黑，无法接入。";
    }
    const minutes = Math.max(1, Math.ceil((record.expiresAt - this.now()) / 60_000));
    return `此设备已被管理员冻结，约 ${minutes} 分钟后可重新接入。`;
  }

  private cooldownFor(peer: Peer): CooldownRecord | null {
    const keys: string[] = [];
    if (peer.deviceId) keys.push(`device:${peer.deviceId}`);
    keys.push(`ip:${peer.ip.toLowerCase()}`);
    return this.store.findCooldown(keys);
  }

  private cooldownMessage(record: CooldownRecord): string {
    const minutes = Math.max(1, Math.ceil((record.until - this.now()) / 60_000));
    return `本次远控已达到时长上限，请在 ${minutes} 分钟后重试。`;
  }

  private capacityFull(): boolean {
    const max = this.store.policy.maxSessions;
    return max > 0 && this.sessions.size >= max;
  }

  private fullMessage(): string {
    const max = this.store.policy.maxSessions;
    return `服务器当前远控人数已达上限（${max} 人），请等待他人结束后再试。`;
  }

  private denyBlocked(
    peer: Peer,
    requestId: string,
    record: AccessBlockRecord,
  ): void {
    const reason: ControlDenyReason =
      record.expiresAt === null ? "device-blocked" : "device-frozen";
    const message = this.blockMessage(record);
    this.denyControlRequest(peer, requestId, reason, message);
    this.store.audit(
      "access.denied",
      "system",
      `${record.kind === "device" ? "设备" : "IP"} ${record.value}：${message}`,
      peer.deviceId ?? undefined,
    );
    this.log("access.denied", {
      deviceId: peer.deviceId,
      ip: peer.ip,
      kind: record.kind,
      value: record.value,
    });
  }

  private denyCooldown(peer: Peer, requestId: string, record: CooldownRecord): void {
    const message = this.cooldownMessage(record);
    this.denyControlRequest(peer, requestId, "cooldown", message);
    this.store.audit(
      "access.denied",
      "system",
      `冷却期内发起远控被拒绝：${message}`,
      peer.deviceId ?? undefined,
    );
    this.log("access.cooldown-denied", { deviceId: peer.deviceId, until: record.until });
  }

  private denyIfRestricted(peer: Peer, requestId: string): boolean {
    const block = this.findAccessBlock(peer.deviceId, peer.ip);
    if (block) {
      this.denyBlocked(peer, requestId, block);
      return true;
    }
    const cooldown = this.cooldownFor(peer);
    if (cooldown) {
      this.denyCooldown(peer, requestId, cooldown);
      return true;
    }
    if (this.capacityFull()) {
      this.denyControlRequest(peer, requestId, "server-full", this.fullMessage());
      this.log("access.capacity-denied", {
        deviceId: peer.deviceId,
        sessions: this.sessions.size,
        maxSessions: this.store.policy.maxSessions,
      });
      return true;
    }
    return false;
  }

  private hello(
    peer: Peer,
    message: Extract<ClientMessage, { type: "client.hello" }>,
  ): void {
    if (peer.deviceId) {
      this.rejectClient(peer, "invalid-hello", "当前连接已完成客户端握手。");
      return;
    }
    if (!this.helloLimiter.hit(peer.ip)) {
      this.rejectClient(peer, "invalid-hello", "握手过于频繁，请稍后再试。");
      return;
    }

    const blocked = this.findAccessBlock(message.deviceId, peer.ip);
    if (blocked) {
      const messageText = this.blockMessage(blocked);
      this.rejectClient(
        peer,
        blocked.expiresAt === null ? "blocked" : "frozen",
        messageText,
      );
      this.store.audit(
        "access.denied",
        "system",
        `${blocked.kind === "device" ? "设备" : "IP"} ${blocked.value}：${messageText}`,
        message.deviceId,
      );
      this.log("access.login-denied", {
        deviceId: message.deviceId,
        ip: peer.ip,
        kind: blocked.kind,
        expiresAt: blocked.expiresAt,
      });
      return;
    }

    const mode = this.store.settings.registrationMode;
    const existing = this.store.getDevice(message.deviceId);
    let status: DeviceStatus;
    let inviteCode: string | null = existing?.inviteCode ?? null;

    if (existing) {
      status = existing.status;
      if (status === "blocked") {
        this.rejectClient(peer, "blocked", "此客户端已被管理员禁止远控。");
        return;
      }
    } else if (mode === "open") {
      status = "approved";
    } else if (mode === "approval" && !message.inviteCode) {
      status = "pending";
    } else {
      const check = this.store.consumeInvite(message.inviteCode, message.deviceId);
      if (!check.ok) {
        if (check.reason === "missing") {
          this.rejectClient(
            peer,
            "invite-required",
            "此服务器需要邀请码才能接入，请向管理员获取。",
          );
        } else {
          const detail =
            check.reason === "expired"
              ? "邀请码已过期，请向管理员获取新的邀请码。"
              : check.reason === "exhausted"
                ? "邀请码使用次数已用完，请向管理员获取新的邀请码。"
                : "邀请码无效，请核对后重试。";
          this.rejectClient(peer, "invite-invalid", detail);
        }
        return;
      }
      status = "approved";
      inviteCode = check.invite.code;
    }

    const device = this.store.registerDevice({
      id: message.deviceId,
      name: sanitizeName(message.deviceName, "远程客户端"),
      platform: message.platform ?? "unknown",
      version: message.version,
      status,
      ip: peer.ip,
      inviteCode,
    });
    peer.deviceId = device.id;
    this.log("client.hello", { deviceId: device.id, status: device.status });
    if (!existing) {
      this.store.audit(
        "device.registered",
        "system",
        inviteCode ? `使用邀请码 ${normalizeInviteCode(inviteCode)} 接入` : "首次接入",
        device.id,
      );
    }
    this.send(peer, {
      type: "client.welcome",
      device: { id: device.id, name: device.name, status: device.status },
      registrationMode: mode,
      serverName: this.store.settings.serverName,
      publicUrl: this.publicUrl,
      limits: this.limits(),
    });
    if (device.status === "approved") {
      this.sendCatalog(peer);
    }
  }

  private ensureDevice(peer: Peer, role: "host" | "controller"): boolean {
    if (!peer.deviceId) {
      if (role === "host") {
        this.sendError(peer, "hello-required", "请先完成客户端接入握手。");
      } else {
        this.reject(peer, "not-found", "客户端尚未完成接入，请升级到最新版本。");
      }
      return false;
    }
    const device = this.store.getDevice(peer.deviceId);
    if (!device) {
      if (role === "host") {
        this.sendError(peer, "device-unknown", "客户端记录不存在，请重新接入。");
      } else {
        this.reject(peer, "not-found", "客户端记录不存在，请重新接入。");
      }
      return false;
    }
    const block = this.findAccessBlock(peer.deviceId, peer.ip);
    if (block) {
      const frozen = block.expiresAt !== null;
      const message = this.blockMessage(block);
      if (role === "host") {
        this.sendError(peer, frozen ? "device-frozen" : "device-blocked", message);
      } else {
        this.reject(peer, frozen ? "device-frozen" : "device-blocked", message);
      }
      return false;
    }
    if (device.status === "pending" || device.status === "blocked") {
      if (role === "host") {
        this.sendError(
          peer,
          device.status === "pending" ? "device-pending" : "device-blocked",
          device.status === "pending"
            ? "此客户端正在等待管理员批准。"
            : "此客户端已被管理员禁止远控。",
        );
      } else {
        this.reject(
          peer,
          device.status === "pending" ? "device-pending" : "device-blocked",
          device.status === "pending"
            ? "此客户端正在等待管理员批准，暂不能发起远控。"
            : "此客户端已被管理员禁止远控。",
        );
      }
      return false;
    }
    return true;
  }

  private registerHost(
    peer: Peer,
    message: Extract<ClientMessage, { type: "host.register" }>,
  ): void {
    if (peer.role !== "pending" || this.hostsByPeerId.has(peer.id)) {
      this.sendError(peer, "already-registered", "This connection is already in use.");
      return;
    }
    if (!this.registerLimiter.hit(peer.ip)) {
      this.sendError(peer, "rate-limited", "Too many registration attempts. Try again later.");
      return;
    }

    const code = this.allocateCode(message.requestedCode);
    if (!code) {
      this.sendError(peer, "server-full", "Unable to allocate a remote code. Try again.");
      return;
    }

    const host: HostRecord = {
      peer,
      code,
      keySalt: message.keySalt,
      keyHash: message.keyHash,
      name: sanitizeName(message.deviceName, "Remote device"),
      platform: message.platform ?? "unknown",
      registeredAt: this.now(),
      session: null,
      published: false,
      note: "",
      publishedAt: null,
    };
    this.hostsByCode.set(code, host);
    this.hostsByPeerId.set(peer.id, host);
    if (peer.deviceId) this.hostsByDeviceId.set(peer.deviceId, host);
    peer.role = "host";
    peer.code = code;
    this.log("host.registered", { hostId: peer.id, deviceId: peer.deviceId });

    this.send(peer, {
      type: "host.registered",
      code,
      iceServers: buildIceServers(this.ice, `host-${code}`),
    });
  }

  private updateHostKey(
    peer: Peer,
    message: Extract<ClientMessage, { type: "host.update-key" }>,
  ): void {
    const host = this.hostsByPeerId.get(peer.id);
    if (!host) {
      this.sendError(peer, "not-a-host", "Register as a host first.");
      return;
    }
    host.keySalt = message.keySalt;
    host.keyHash = message.keyHash;
    if (host.session) {
      this.closeSession(host.session, "key-rotated", [peer]);
    }
    this.log("host.key-updated", { hostId: peer.id });
    this.send(peer, { type: "host.key-updated", code: host.code });
  }

  private unregisterHost(peer: Peer): void {
    const host = this.hostsByPeerId.get(peer.id);
    if (!host) {
      this.sendError(peer, "not-a-host", "Register as a host first.");
      return;
    }
    this.removeHost(host, "host-closed");
    peer.role = "pending";
    peer.code = null;
  }

  private publishHost(peer: Peer, published: boolean, note: string): void {
    const host = this.hostsByPeerId.get(peer.id);
    if (!host) {
      this.sendError(peer, "not-a-host", "Register as a host first.");
      return;
    }
    const changed = host.published !== published || (published && host.note !== note);
    host.published = published;
    if (published) {
      host.note = note;
      if (host.publishedAt === null) host.publishedAt = this.now();
    } else {
      host.publishedAt = null;
      this.cancelHostControls(host, "unpublished");
    }
    this.send(peer, {
      type: "host.publish-state",
      published: host.published,
      note: host.note,
    });
    if (changed) this.broadcastCatalog();
    this.log("host.publish", {
      hostId: peer.id,
      deviceId: peer.deviceId,
      published,
      note: host.note,
    });
  }

  private requestControl(peer: Peer, hostDeviceId: string): void {
    if (peer.role === "host") {
      this.denyControlRequest(peer, "", "self", "当前连接正在被控，无法同时申请控制其他设备。");
      return;
    }
    if (peer.sessionId) {
      this.denyControlRequest(peer, "", "already-session", "请先结束当前远控会话。");
      return;
    }
    if (this.requestByPeerId.has(peer.id)) {
      this.denyControlRequest(peer, "", "already-pending", "已有一条待处理的申请。");
      return;
    }
    if (!this.requestLimiter.hit(peer.ip)) {
      this.denyControlRequest(peer, "", "rate-limited", "申请过于频繁，请稍后再试。");
      return;
    }
    if (this.denyIfRestricted(peer, "")) return;
    const host = this.hostsByDeviceId.get(hostDeviceId);
    if (!host || !host.published) {
      this.denyControlRequest(
        peer,
        "",
        "not-published",
        "该设备当前没有发布共享，或已停止共享。",
      );
      return;
    }
    if (host.peer.deviceId === peer.deviceId) {
      this.denyControlRequest(peer, "", "self", "不能申请控制自己的设备。");
      return;
    }
    if (host.session) {
      this.denyControlRequest(peer, "", "busy", "该设备正在被控，请稍后再申请。");
      return;
    }
    if (this.hasApprovalToken(host)) {
      this.denyControlRequest(peer, "", "busy", "该设备正在等待其他连接，请稍后再试。");
      return;
    }
    const pendingCount = [...this.requests.values()].filter(
      (item) => item.host === host,
    ).length;
    if (pendingCount >= MAX_PENDING_REQUESTS_PER_HOST) {
      this.denyControlRequest(peer, "", "busy", "该设备待处理的申请过多，请稍后再试。");
      return;
    }

    const device = peer.deviceId ? this.store.getDevice(peer.deviceId) : null;
    const requestId = randomUUID();
    const expiresAt = this.now() + this.requestTtlMs;
    const request: ControlRequest = {
      id: requestId,
      host,
      peer,
      controllerName: sanitizeName(device?.name ?? "远程客户端", "远程客户端"),
      controllerPlatform: device?.platform ?? "unknown",
      createdAt: this.now(),
      expiresAt,
      timer: setTimeout(() => this.expireControlRequest(requestId), this.requestTtlMs),
    };
    request.timer.unref();
    this.requests.set(requestId, request);
    this.requestByPeerId.set(peer.id, requestId);
    peer.role = "controller";
    this.log("control.requested", { requestId, hostId: host.peer.id, deviceId: peer.deviceId });

    this.send(host.peer, {
      type: "host.control-request",
      request: this.controlRequestInfo(request),
    });
    this.send(peer, {
      type: "controller.request-sent",
      requestId,
      host: this.peerInfo(host),
      expiresAt,
    });
  }

  private decideControlRequest(peer: Peer, requestId: string, accept: boolean): void {
    const host = this.hostsByPeerId.get(peer.id);
    if (!host) {
      this.sendError(peer, "not-a-host", "Register as a host first.");
      return;
    }
    const request = this.requests.get(requestId);
    if (!request || request.host !== host) {
      this.sendError(peer, "request-not-found", "该申请已失效。");
      return;
    }
    if (this.now() >= request.expiresAt) {
      this.expireControlRequest(requestId);
      return;
    }
    if (!accept) {
      this.removeControlRequest(request);
      this.send(request.peer, {
        type: "controller.request-denied",
        requestId,
        reason: "denied",
        message: "主机拒绝了此次远控申请。",
      });
      this.send(peer, { type: "host.control-closed", requestId, reason: "denied" });
      this.log("control.denied", { requestId, hostId: peer.id });
      return;
    }
    if (host.session || this.hasApprovalToken(host)) {
      this.removeControlRequest(request);
      this.send(request.peer, {
        type: "controller.request-denied",
        requestId,
        reason: "busy",
        message: "主机正在处理其他连接，请稍后再申请。",
      });
      this.send(peer, { type: "host.control-closed", requestId, reason: "busy" });
      return;
    }
    if (this.denyIfRestricted(request.peer, requestId)) {
      this.removeControlRequest(request);
      this.send(peer, { type: "host.control-closed", requestId, reason: "cancelled" });
      return;
    }

    const others = [...this.requests.values()].filter(
      (item) => item.host === host && item.id !== requestId,
    );
    for (const other of others) {
      this.removeControlRequest(other);
      this.send(other.peer, {
        type: "controller.request-denied",
        requestId: other.id,
        reason: "busy",
        message: "主机已接受其他远控申请。",
      });
      this.send(peer, { type: "host.control-closed", requestId: other.id, reason: "busy" });
    }

    this.removeControlRequest(request);
    const token = randomBytes(32).toString("hex");
    const expiresAt = this.now() + this.tokenTtlMs;
    const approval: ApprovalToken = {
      token,
      host,
      controllerDeviceId: request.peer.deviceId ?? "",
      controllerName: request.controllerName,
      controllerPlatform: request.controllerPlatform,
      requestId,
      expiresAt,
      timer: setTimeout(() => this.expireApprovalToken(token), this.tokenTtlMs),
    };
    approval.timer.unref();
    this.tokens.set(token, approval);
    this.send(request.peer, {
      type: "controller.request-accepted",
      requestId,
      token,
      host: this.peerInfo(host),
      expiresAt,
    });
    this.send(peer, { type: "host.control-approved", requestId, expiresAt });
    this.broadcastCatalog();
    this.log("control.approved", { requestId, hostId: peer.id, expiresAt });
  }

  private connectWithToken(
    peer: Peer,
    tokenValue: string,
    controllerName: string,
    platform: Platform | undefined,
  ): void {
    if (peer.role === "host") {
      this.denyControlRequest(peer, "", "self", "当前连接正在被控，无法同时控制其他设备。");
      return;
    }
    if (peer.sessionId) {
      this.denyControlRequest(peer, "", "already-session", "请先结束当前远控会话。");
      return;
    }
    if (!this.connectLimiter.hit(peer.ip)) {
      this.denyControlRequest(peer, "", "rate-limited", "尝试过于频繁，请稍后再试。");
      return;
    }
    const approval = this.tokens.get(tokenValue);
    if (!approval) {
      this.denyControlRequest(peer, "", "token-invalid", "远控授权已失效，请重新申请。");
      return;
    }
    if (!peer.deviceId || approval.controllerDeviceId !== peer.deviceId) {
      this.denyControlRequest(peer, approval.requestId, "token-invalid", "远控授权不属于此设备。");
      return;
    }
    if (this.now() >= approval.expiresAt) {
      this.expireApprovalToken(tokenValue);
      this.denyControlRequest(peer, approval.requestId, "token-expired", "远控授权已过期，请重新申请。");
      return;
    }
    if (this.denyIfRestricted(peer, approval.requestId)) {
      this.removeApprovalToken(approval);
      this.send(approval.host.peer, {
        type: "host.control-closed",
        requestId: approval.requestId,
        reason: "cancelled",
      });
      return;
    }
    const host = approval.host;
    if (this.hostsByCode.get(host.code) !== host || !host.published) {
      this.removeApprovalToken(approval);
      this.denyControlRequest(
        peer,
        approval.requestId,
        "host-offline",
        "主机已下线或停止共享，请稍后重试。",
      );
      return;
    }
    if (host.session) {
      this.removeApprovalToken(approval);
      this.denyControlRequest(peer, approval.requestId, "busy", "主机正在被控，请稍后再试。");
      this.send(host.peer, {
        type: "host.control-closed",
        requestId: approval.requestId,
        reason: "busy",
      });
      return;
    }

    this.removeApprovalToken(approval);
    this.openSession(
      host,
      peer,
      approval.controllerName || controllerName,
      approval.controllerPlatform ?? platform ?? "unknown",
    );
    this.log("control.token-used", { requestId: approval.requestId, deviceId: peer.deviceId });
  }

  private openSession(
    host: HostRecord,
    controller: Peer,
    controllerName: string,
    controllerPlatform: Platform,
  ): void {
    const policy = this.store.policy;
    const limitMs = policy.sessionLimitMinutes > 0 ? policy.sessionLimitMinutes * 60_000 : 0;
    const createdAt = this.now();
    const session: Session = {
      id: randomUUID(),
      code: host.code,
      host,
      controller,
      controllerName: sanitizeName(controllerName, "Remote controller"),
      controllerPlatform,
      createdAt,
      endsAt: limitMs > 0 ? createdAt + limitMs : null,
      limitTimer: null,
      telemetry: null,
      dangerEvents: [],
    };
    if (session.endsAt !== null) {
      session.limitTimer = setTimeout(() => {
        this.enforceSessionLimit(session.id);
      }, Math.max(0, session.endsAt - this.now()));
      session.limitTimer.unref();
    }
    this.sessions.set(session.id, session);
    host.session = session;
    host.peer.sessionId = session.id;
    controller.role = "controller";
    controller.code = host.code;
    controller.sessionId = session.id;
    controller.lastSeen = this.now();
    this.broadcastCatalog();

    this.send(host.peer, {
      type: "host.paired",
      sessionId: session.id,
      controller: {
        name: session.controllerName,
        platform: session.controllerPlatform,
        ip: controller.ip,
      },
      iceServers: buildIceServers(this.ice, `host-${host.code}`),
      endsAt: session.endsAt,
    });
    this.send(controller, {
      type: "controller.paired",
      sessionId: session.id,
      host: this.peerInfo(host),
      iceServers: buildIceServers(this.ice, `controller-${controller.id}`),
      endsAt: session.endsAt,
    });
    this.log("session.opened", {
      sessionId: session.id,
      hostId: host.peer.id,
      endsAt: session.endsAt,
    });
  }

  private enforceSessionLimit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const policy = this.store.policy;
    let cooldownUntil: number | null = null;
    if (policy.cooldownMinutes > 0) {
      cooldownUntil = this.now() + policy.cooldownMinutes * 60_000;
      this.store.startCooldown({
        deviceId: session.controller.deviceId,
        ip: session.controller.ip,
        label: session.controllerName,
        until: cooldownUntil,
        reason: "time-limit",
      });
    }
    this.store.audit(
      "session.time-limit",
      "system",
      `会话达到 ${policy.sessionLimitMinutes} 分钟上限${
        cooldownUntil ? `，该用户需等待 ${policy.cooldownMinutes} 分钟` : ""
      }`,
      session.controller.deviceId ?? undefined,
    );
    this.log("session.time-limit", {
      sessionId,
      deviceId: session.controller.deviceId,
      cooldownUntil,
    });
    this.closeSession(session, "time-limit", [], { cooldownUntil });
  }

  private controlRequestInfo(request: ControlRequest): HostControlRequestInfo {
    return {
      id: request.id,
      controllerName: request.controllerName,
      platform: request.controllerPlatform,
      expiresAt: request.expiresAt,
    };
  }

  private removeControlRequest(request: ControlRequest): void {
    clearTimeout(request.timer);
    this.requests.delete(request.id);
    if (this.requestByPeerId.get(request.peer.id) === request.id) {
      this.requestByPeerId.delete(request.peer.id);
    }
  }

  private cancelRequestForPeer(peer: Peer, reason: ControlDenyReason): void {
    const requestId = this.requestByPeerId.get(peer.id);
    if (!requestId) return;
    const request = this.requests.get(requestId);
    if (!request) return;
    this.removeControlRequest(request);
    this.send(request.host.peer, {
      type: "host.control-closed",
      requestId: request.id,
      reason,
    });
    this.log("control.cancelled", { requestId, reason });
  }

  private expireControlRequest(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;
    this.removeControlRequest(request);
    this.send(request.peer, {
      type: "controller.request-denied",
      requestId,
      reason: "expired",
      message: "主机未在有效期内处理申请，请重新申请。",
    });
    this.send(request.host.peer, {
      type: "host.control-closed",
      requestId,
      reason: "expired",
    });
    this.log("control.expired", { requestId });
  }

  private removeApprovalToken(approval: ApprovalToken): void {
    clearTimeout(approval.timer);
    this.tokens.delete(approval.token);
  }

  private expireApprovalToken(token: string): void {
    const approval = this.tokens.get(token);
    if (!approval) return;
    this.removeApprovalToken(approval);
    this.send(approval.host.peer, {
      type: "host.control-closed",
      requestId: approval.requestId,
      reason: "timeout",
    });
    this.broadcastCatalog();
    this.log("control.token-expired", { requestId: approval.requestId });
  }

  private cancelHostControls(host: HostRecord, reason: ControlDenyReason): void {
    const message =
      reason === "unpublished"
        ? "主机已停止共享。"
        : reason === "host-offline"
          ? "主机已下线。"
          : "主机已取消此次连接。";
    for (const request of [...this.requests.values()]) {
      if (request.host !== host) continue;
      this.removeControlRequest(request);
      this.send(request.peer, {
        type: "controller.request-denied",
        requestId: request.id,
        reason,
        message,
      });
      this.send(host.peer, {
        type: "host.control-closed",
        requestId: request.id,
        reason,
      });
    }
    for (const approval of [...this.tokens.values()]) {
      if (approval.host !== host) continue;
      this.removeApprovalToken(approval);
      this.send(host.peer, {
        type: "host.control-closed",
        requestId: approval.requestId,
        reason,
      });
    }
  }

  private hasApprovalToken(host: HostRecord): boolean {
    for (const approval of this.tokens.values()) {
      if (approval.host === host) return true;
    }
    return false;
  }

  private catalogHosts(exceptDeviceId?: string): CatalogHost[] {
    const hosts: CatalogHost[] = [];
    for (const host of this.hostsByCode.values()) {
      if (!host.published || !host.peer.deviceId) continue;
      if (exceptDeviceId && host.peer.deviceId === exceptDeviceId) continue;
      hosts.push({
        deviceId: host.peer.deviceId,
        name: host.name,
        platform: host.platform,
        note: host.note,
        busy: Boolean(host.session) || this.hasApprovalToken(host),
        publishedAt: host.publishedAt ?? host.registeredAt,
      });
    }
    hosts.sort((a, b) => a.publishedAt - b.publishedAt || a.name.localeCompare(b.name));
    return hosts;
  }

  private sendCatalog(peer: Peer): void {
    this.send(peer, {
      type: "catalog.snapshot",
      hosts: this.catalogHosts(peer.deviceId ?? undefined),
    });
  }

  private broadcastCatalog(): void {
    for (const peer of this.peers.values()) {
      if (!peer.deviceId) continue;
      const device = this.store.getDevice(peer.deviceId);
      if (!device || device.status !== "approved") continue;
      this.send(peer, {
        type: "catalog.updated",
        hosts: this.catalogHosts(peer.deviceId),
      });
    }
  }

  private denyControlRequest(
    peer: Peer,
    requestId: string,
    reason: ControlDenyReason,
    message: string,
  ): void {
    this.send(peer, { type: "controller.request-denied", requestId, reason, message });
  }

  private lookup(peer: Peer, code: string): void {
    if (peer.role === "host") {
      this.reject(peer, "self", "A host cannot control another device on the same connection.");
      return;
    }
    if (peer.sessionId) {
      this.sendError(peer, "already-in-session", "Disconnect the current session first.");
      return;
    }
    if (!this.lookupLimiter.hit(peer.ip)) {
      this.reject(peer, "rate-limited", "Too many lookup attempts. Try again later.");
      return;
    }
    const block = this.findAccessBlock(peer.deviceId, peer.ip);
    if (block) {
      this.reject(
        peer,
        block.expiresAt === null ? "device-blocked" : "device-frozen",
        this.blockMessage(block),
      );
      return;
    }
    const cooldown = this.cooldownFor(peer);
    if (cooldown) {
      this.reject(peer, "cooldown", this.cooldownMessage(cooldown));
      return;
    }
    const host = this.hostsByCode.get(code);
    if (!host) {
      this.reject(peer, "not-found", "No device is online with this remote code.");
      return;
    }
    peer.role = "controller";
    peer.code = code;
    this.send(peer, {
      type: "controller.challenge",
      code,
      keySalt: host.keySalt,
      host: this.peerInfo(host),
    });
  }

  private connect(
    peer: Peer,
    code: string,
    keyHash: string,
    controllerName: string,
    platform: Platform | undefined,
  ): void {
    if (peer.role === "host") {
      this.reject(peer, "self", "A host cannot control another device on the same connection.");
      return;
    }
    if (peer.sessionId) {
      this.sendError(peer, "already-in-session", "Disconnect the current session first.");
      return;
    }
    if (!this.connectLimiter.hit(peer.ip) || !this.codeLimiter.hit(code)) {
      this.reject(peer, "rate-limited", "Too many attempts. Try again in a minute.");
      return;
    }
    const block = this.findAccessBlock(peer.deviceId, peer.ip);
    if (block) {
      this.reject(
        peer,
        block.expiresAt === null ? "device-blocked" : "device-frozen",
        this.blockMessage(block),
      );
      this.store.audit(
        "access.denied",
        "system",
        `连接被拒绝：${this.blockMessage(block)}`,
        peer.deviceId ?? undefined,
      );
      return;
    }
    const cooldown = this.cooldownFor(peer);
    if (cooldown) {
      this.reject(peer, "cooldown", this.cooldownMessage(cooldown));
      this.store.audit(
        "access.denied",
        "system",
        `冷却期内发起远控被拒绝：${this.cooldownMessage(cooldown)}`,
        peer.deviceId ?? undefined,
      );
      return;
    }
    if (this.capacityFull()) {
      this.reject(peer, "server-full", this.fullMessage());
      this.log("access.capacity-denied", {
        deviceId: peer.deviceId,
        sessions: this.sessions.size,
        maxSessions: this.store.policy.maxSessions,
      });
      return;
    }
    const host = this.hostsByCode.get(code);
    if (!host) {
      this.reject(peer, "not-found", "No device is online with this remote code.");
      return;
    }
    if (host.session) {
      this.reject(peer, "busy", "This device is already in a remote session.");
      return;
    }
    if (!timingSafeEqualHex(host.keyHash, keyHash)) {
      this.log("controller.rejected", { reason: "invalid-key" });
      this.reject(peer, "invalid-key", "The access key is incorrect.");
      return;
    }

    this.openSession(host, peer, controllerName, platform ?? "unknown");
  }

  private disconnectController(peer: Peer): void {
    this.cancelRequestForPeer(peer, "cancelled");
    if (!peer.sessionId) return;
    const session = this.sessions.get(peer.sessionId);
    if (session) {
      this.closeSession(session, "controller-left", [peer]);
    }
    peer.sessionId = null;
  }

  private relaySignal(peer: Peer, data: unknown): void {
    const session = peer.sessionId ? this.sessions.get(peer.sessionId) : undefined;
    if (!session) {
      this.sendError(peer, "not-in-session", "No active remote session on this connection.");
      return;
    }
    if (peer.id === session.host.peer.id) {
      this.send(session.controller, { type: "signal", data });
    } else if (peer.id === session.controller.id) {
      this.send(session.host.peer, { type: "signal", data });
    }
  }

  private removeHost(host: HostRecord, reason: string): void {
    const wasPublished = host.published;
    if (host.session) {
      this.closeSession(host.session, reason);
    }
    this.cancelHostControls(host, "host-offline");
    this.hostsByCode.delete(host.code);
    this.hostsByPeerId.delete(host.peer.id);
    if (
      host.peer.deviceId &&
      this.hostsByDeviceId.get(host.peer.deviceId) === host
    ) {
      this.hostsByDeviceId.delete(host.peer.deviceId);
    }
    host.published = false;
    host.publishedAt = null;
    host.peer.role = "pending";
    host.peer.code = null;
    if (wasPublished) this.broadcastCatalog();
    this.log("host.removed", { hostId: host.peer.id });
  }

  private closeSession(
    session: Session,
    reason: string,
    exclude: Peer[] = [],
    options: { cooldownUntil?: number | null } = {},
  ): void {
    if (!this.sessions.has(session.id)) return;
    if (session.limitTimer) {
      clearTimeout(session.limitTimer);
      session.limitTimer = null;
    }
    const endedAt = this.now();
    this.sessions.delete(session.id);
    if (session.host.session?.id === session.id) {
      session.host.session = null;
    }
    if (session.host.peer.sessionId === session.id) {
      session.host.peer.sessionId = null;
    }
    if (session.controller.sessionId === session.id) {
      session.controller.sessionId = null;
    }
    this.store.recordSession({
      id: session.id,
      code: session.code,
      startedAt: session.createdAt,
      endedAt,
      durationMs: Math.max(0, endedAt - session.createdAt),
      reason,
      host: {
        deviceId: session.host.peer.deviceId,
        name: session.host.name,
        ip: session.host.peer.ip,
      },
      controller: {
        deviceId: session.controller.deviceId,
        name: session.controllerName,
        ip: session.controller.ip,
      },
      telemetry: session.telemetry ? { ...session.telemetry } : null,
      dangerEvents: session.dangerEvents.map((event) => ({ ...event })),
    });
    this.log("session.closed", {
      sessionId: session.id,
      reason,
      durationMs: Math.max(0, endedAt - session.createdAt),
      dangerEvents: session.dangerEvents.length,
    });
    for (const peer of [session.host.peer, session.controller]) {
      if (exclude.some((item) => item.id === peer.id)) continue;
      this.send(peer, {
        type: "peer.left",
        reason,
        ...(options.cooldownUntil ? { cooldownUntil: options.cooldownUntil } : {}),
      });
    }
    if (this.hostsByPeerId.has(session.host.peer.id)) {
      this.broadcastCatalog();
    }
  }

  private kickDevice(
    deviceId: string,
    reason: ClientRejectReason,
    message: string,
  ): boolean {
    return this.kickMatching(
      (peer) => peer.deviceId === deviceId,
      reason,
      message,
    );
  }

  private kickMatching(
    predicate: (peer: Peer) => boolean,
    reason: ClientRejectReason,
    message: string,
  ): boolean {
    const targets = [...this.peers.values()].filter(predicate);
    if (targets.length === 0) return false;
    for (const peer of targets) {
      const host = this.hostsByPeerId.get(peer.id);
      if (host) this.removeHost(host, reason);
      if (peer.sessionId) {
        const session = this.sessions.get(peer.sessionId);
        if (session) this.closeSession(session, reason, [peer]);
      }
      this.send(peer, { type: "client.rejected", reason, message });
      try {
        peer.socket.close(4001, reason);
      } catch {
        // The socket may already be closed.
      }
    }
    return true;
  }

  private peerInfo(host: HostRecord): PeerInfo {
    return { name: host.name, platform: host.platform, ip: host.peer.ip };
  }

  private allocateCode(requested: string | undefined): string | null {
    if (requested && !this.hostsByCode.has(requested)) {
      return requested;
    }
    for (let i = 0; i < RETRY_ALLOCATIONS; i += 1) {
      const code = generateRemoteCode();
      if (!this.hostsByCode.has(code)) return code;
    }
    return null;
  }

  private reject(peer: Peer, reason: RejectReason, message: string): void {
    this.send(peer, { type: "controller.rejected", reason, message });
  }

  private rejectClient(peer: Peer, reason: ClientRejectReason, message: string): void {
    this.send(peer, { type: "client.rejected", reason, message });
  }

  private sendError(peer: Peer, code: string, message: string): void {
    this.send(peer, { type: "error", code, message });
  }

  private send(peer: Peer, message: ServerMessage): void {
    try {
      peer.socket.send(encodeMessage(message));
    } catch {
      // The socket may already be gone; disconnect handling owns cleanup.
    }
  }
}
