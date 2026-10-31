import { shell } from "electron";
import {
  clearAdminSecret,
  clearLocalAdminSecret,
  getLocalServerUrl,
  loadAdminAccess,
  loadAdminSecret,
  loadLocalAdminSecret,
  publicSettings,
  saveAdminSecret,
  saveLocalAdminSecret,
} from "./settings";

export type AdminTarget = "remote" | "local";

interface AdminSession {
  target: AdminTarget;
  serverUrl: string;
  token: string;
  expiresAt: number;
}

export interface AdminStatus {
  target: AdminTarget;
  serverUrl: string;
  configured: boolean;
  session: boolean;
  expiresAt: number | null;
}

export interface AdminResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

const TOKEN_SAFETY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const ADMIN_REST_RE = /^\/[A-Za-z0-9/_-]*(?:\?[^\s#]*)?$/;
const AUTO_LOGIN_BASE_DELAY_MS = 15_000;
const AUTO_LOGIN_SLOW_DELAY_MS = 5 * 60_000;

let session: AdminSession | null = null;
let autoLoginFailedAt = 0;
let autoLoginFailures = 0;

function autoLoginDelay(): number {
  if (autoLoginFailures === 0) return 0;
  return autoLoginFailures === 1 ? AUTO_LOGIN_BASE_DELAY_MS : AUTO_LOGIN_SLOW_DELAY_MS;
}

function parseTarget(value: unknown): AdminTarget {
  return value === "local" ? "local" : "remote";
}

function serverUrlFor(target: AdminTarget): string {
  return target === "local" ? getLocalServerUrl() : publicSettings().serverUrl;
}

function adminPagePath(target: AdminTarget): string {
  if (target === "local") return "/admin";
  return loadAdminAccess(serverUrlFor(target))?.adminPath || "/admin";
}

function adminApiPath(target: AdminTarget): string {
  const page = adminPagePath(target);
  return page === "/admin" ? "/api/admin" : `${page}/api`;
}

function mapAdminPath(path: string, apiBase: string): string | null {
  const canonical = "/api/admin";
  let rest = "";
  if (path === canonical || path.startsWith(`${canonical}/`) || path.startsWith(`${canonical}?`)) {
    rest = path.slice(canonical.length);
  } else if (path === apiBase || path.startsWith(`${apiBase}/`) || path.startsWith(`${apiBase}?`)) {
    rest = path.slice(apiBase.length);
  } else {
    return null;
  }
  if (!ADMIN_REST_RE.test(rest || "/")) return null;
  return `${apiBase}${rest}`;
}

function secretFor(target: AdminTarget, serverUrl: string): string | null {
  return target === "local" ? loadLocalAdminSecret() : loadAdminSecret(serverUrl);
}

function errorText(data: unknown, fallback: string): string {
  const record =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const code = typeof record.error === "string" ? record.error : "";
  switch (code) {
    case "invalid-password":
      return "管理员密码不正确。";
    case "admin-not-configured":
      return "服务端未配置管理员密码，请重新部署或设置 ADMIN_PASSWORD。";
    case "rate-limited":
      return "尝试过于频繁，请一分钟后再试。";
    case "unauthorized":
      return "管理员登录已过期，请重新登录。";
    default:
      break;
  }
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (code) return fallback;
  return fallback;
}

interface RawResponse {
  status: number;
  data: unknown;
}

async function httpJson(
  url: string,
  init: { method: string; token?: string; body?: unknown },
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      redirect: "error",
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接服务器超时，请检查网络后重试。");
    }
    throw new Error("无法连接服务器，请检查服务器地址与网络。");
  } finally {
    clearTimeout(timer);
  }
}

function sessionValid(target: AdminTarget, serverUrl: string): boolean {
  return Boolean(
    session &&
      session.target === target &&
      session.serverUrl === serverUrl &&
      session.expiresAt - Date.now() > TOKEN_SAFETY_MS,
  );
}

async function loginWithPassword(
  target: AdminTarget,
  serverUrl: string,
  password: string,
): Promise<AdminSession> {
  const result = await httpJson(`${serverUrl}${adminApiPath(target)}/login`, {
    method: "POST",
    body: { password },
  });
  const data =
    typeof result.data === "object" && result.data !== null
      ? (result.data as Record<string, unknown>)
      : {};
  if (result.status !== 200 || typeof data.token !== "string" || !data.token) {
    throw new Error(errorText(result.data, "管理员登录失败，请稍后再试。"));
  }
  const expiresAt = Number(data.expiresAt);
  session = {
    target,
    serverUrl,
    token: data.token,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + 12 * 3600_000,
  };
  return session;
}

async function ensureSession(target: AdminTarget): Promise<AdminSession | null> {
  const serverUrl = serverUrlFor(target);
  if (sessionValid(target, serverUrl)) return session;
  session = null;
  if (Date.now() - autoLoginFailedAt < autoLoginDelay()) return null;
  const password = secretFor(target, serverUrl);
  if (!password) return null;
  try {
    const next = await loginWithPassword(target, serverUrl, password);
    autoLoginFailures = 0;
    autoLoginFailedAt = 0;
    return next;
  } catch {
    autoLoginFailures = Math.min(autoLoginFailures + 1, 5);
    autoLoginFailedAt = Date.now();
    return null;
  }
}

export async function adminStatus(input: unknown): Promise<AdminStatus> {
  const target = parseTarget(input);
  const serverUrl = serverUrlFor(target);
  const live = sessionValid(target, serverUrl) ? session : null;
  return {
    target,
    serverUrl,
    configured: Boolean(secretFor(target, serverUrl)),
    session: Boolean(live),
    expiresAt: live?.expiresAt ?? null,
  };
}

export async function adminLogin(input: unknown): Promise<{
  ok: true;
  expiresAt: number;
  server: unknown;
}> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("登录参数不合法");
  }
  const raw = input as Record<string, unknown>;
  const target = parseTarget(raw.target);
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!password) throw new Error("请输入管理员密码");
  if (password.length > 256) throw new Error("管理员密码过长");
  const serverUrl = serverUrlFor(target);
  const current = await loginWithPassword(target, serverUrl, password);
  autoLoginFailedAt = 0;
  autoLoginFailures = 0;
  if (raw.remember === true) {
    if (target === "local") saveLocalAdminSecret(password);
    else saveAdminSecret(serverUrl, password);
  }
  let server: unknown = null;
  try {
    const me = await httpJson(`${serverUrl}${adminApiPath(target)}/me`, {
      method: "GET",
      token: current.token,
    });
    server =
      typeof me.data === "object" && me.data !== null
        ? (me.data as Record<string, unknown>).server ?? null
        : null;
  } catch {
    // Login succeeded; server details are optional.
  }
  return { ok: true, expiresAt: current.expiresAt, server };
}

export async function adminLogout(input: unknown): Promise<{ ok: true }> {
  const target = parseTarget(input);
  const current = session && session.target === target ? session : null;
  const serverUrl = serverUrlFor(target);
  if (current && current.serverUrl === serverUrl) {
    try {
      await httpJson(`${serverUrl}${adminApiPath(target)}/logout`, {
        method: "POST",
        token: current.token,
      });
    } catch {
      // Local logout still clears the cached token.
    }
  }
  if (!session || session.target === target) session = null;
  const raw =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  if (raw.forget === true) {
    if (target === "local") clearLocalAdminSecret();
    else clearAdminSecret();
  }
  return { ok: true };
}

export async function adminRequest(input: unknown): Promise<AdminResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, status: 400, data: null, error: "请求参数不合法" };
  }
  const raw = input as Record<string, unknown>;
  const target = parseTarget(raw.target);
  const method =
    raw.method === "POST" || raw.method === "PATCH" || raw.method === "DELETE"
      ? raw.method
      : "GET";
  const path = typeof raw.path === "string" ? raw.path : "";
  const apiBase = adminApiPath(target);
  const targetPath = mapAdminPath(path, apiBase);
  if (!targetPath) {
    return { ok: false, status: 400, data: null, error: "请求路径不合法" };
  }
  const serverUrl = serverUrlFor(target);
  const current = await ensureSession(target);
  if (!current) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: "需要管理员密码登录后才能管理服务端。",
    };
  }
  try {
    let result = await httpJson(`${serverUrl}${targetPath}`, {
      method,
      token: current.token,
      body: raw.body,
    });
    if (result.status === 401) {
      session = null;
      const retry = await ensureSession(target);
      if (!retry) {
        return {
          ok: false,
          status: 401,
          data: result.data,
          error: "管理员登录已过期，请重新登录。",
        };
      }
      result = await httpJson(`${serverUrl}${targetPath}`, {
        method,
        token: retry.token,
        body: raw.body,
      });
    }
    const ok = result.status >= 200 && result.status < 300;
    return {
      ok,
      status: result.status,
      data: result.data,
      error: ok ? undefined : errorText(result.data, "服务端请求失败，请稍后再试。"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "无法连接服务器。",
    };
  }
}

export async function openAdminConsole(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const target = parseTarget(input);
  const current = await ensureSession(target);
  if (!current) {
    return { ok: false, error: "请先登录管理员账号，再打开网页管理后台。" };
  }
  const url = `${current.serverUrl}${adminPagePath(target)}#token=${encodeURIComponent(current.token)}`;
  await shell.openExternal(url);
  return { ok: true };
}
