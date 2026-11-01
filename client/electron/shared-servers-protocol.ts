/** 若道共享服务器列表的纯协议层：不依赖 Electron，便于单元测试。 */

import { unwrapApiPayload } from "./assistant-protocol";

export const SHARED_SERVER_PAGE_SIZE = 8;
export const SHARED_SERVER_MAX_EXPIRY_DAYS = 365;
export const SHARED_SERVER_REPORT_LIMIT = 200;

export type SharedServerSort = "recommended" | "newest" | "expiring";

export interface SharedServerInfo {
  id: string;
  name: string;
  address: string;
  host: string;
  region: string;
  specs: string;
  maxDevices: number | null;
  inviteCode: string;
  note: string;
  expiresAt: string;
  status: string;
  online: boolean;
  healthStatus: string;
  serverVersion: string;
  registrationMode: string;
  peers: number | null;
  sessions: number | null;
  lastCheckedAt: string | null;
  createdAt: string | null;
}

export interface SharedServerPage {
  items: SharedServerInfo[];
  total: number;
  page: number;
  size: number;
}

export interface SharedServerForm {
  name: string;
  address: string;
  region: string;
  specs: string;
  maxDevices: number | null;
  inviteCode: string;
  note: string;
  expiresAt: string;
}

export interface SharedServerApiError extends Error {
  status: number;
  code: string;
}

function apiError(message: string, status = 0, code = "shared-server-error"): SharedServerApiError {
  const error = new Error(message) as SharedServerApiError;
  error.status = status;
  error.code = code;
  return error;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value: unknown): number | null {
  const parsed = numberOf(value);
  return parsed === null ? null : Math.round(parsed);
}

export function parseSharedServerInfo(value: unknown): SharedServerInfo | null {
  const record = recordOf(value);
  const id = textOf(record.id);
  if (!id) return null;
  return {
    id,
    name: textOf(record.name) || "未命名服务器",
    address: textOf(record.address),
    host: textOf(record.host),
    region: textOf(record.region),
    specs: textOf(record.specs),
    maxDevices: intOrNull(record.maxDevices),
    inviteCode: textOf(record.inviteCode),
    note: textOf(record.note),
    expiresAt: textOf(record.expiresAt),
    status: textOf(record.status) || "active",
    online: record.online === true,
    healthStatus: textOf(record.healthStatus) || "unknown",
    serverVersion: textOf(record.serverVersion),
    registrationMode: textOf(record.registrationMode),
    peers: intOrNull(record.peers),
    sessions: intOrNull(record.sessions),
    lastCheckedAt: textOf(record.lastCheckedAt) || null,
    createdAt: textOf(record.createdAt) || null,
  };
}

export function parseSharedServerPage(payload: unknown): SharedServerPage {
  const value = unwrapApiPayload(payload);
  const record = recordOf(value);
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(record.items)
      ? record.items
      : [];
  const items = raw
    .map((item) => parseSharedServerInfo(item))
    .filter((item): item is SharedServerInfo => item !== null);
  return {
    items,
    total: Math.max(0, Math.round(numberOf(record.total) ?? items.length)),
    page: Math.max(1, Math.round(numberOf(record.page) ?? 1)),
    size: Math.max(1, Math.round(numberOf(record.size) ?? SHARED_SERVER_PAGE_SIZE)),
  };
}

export function normalizeSharedServerAddress(value: unknown): string {
  let input = String(value ?? "").trim();
  if (!input) throw apiError("请填写服务器地址。", 400, "invalid-address");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) input = `https://${input}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw apiError("服务器地址格式不正确，例如 https://remote.example.com。", 400, "invalid-address");
  }
  if (url.protocol !== "https:") {
    throw apiError("共享服务器必须使用 HTTPS 地址，例如 https://remote.example.com。", 400, "https-required");
  }
  if (url.username || url.password) {
    throw apiError("服务器地址不能包含用户名或密码。", 400, "invalid-address");
  }
  if (url.search || url.hash) {
    throw apiError("服务器地址不能包含查询参数或锚点。", 400, "invalid-address");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw apiError("服务器地址只需填写协议、域名和端口，不要带路径。", 400, "invalid-address");
  }
  if (!url.hostname) throw apiError("服务器地址缺少域名或 IP。", 400, "invalid-address");
  if (url.port === "0") throw apiError("服务器端口无效。", 400, "invalid-address");
  return `https://${url.host}`;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limited(value: unknown, max: number, label: string): string {
  const text = cleanText(value);
  if (text.length > max) throw apiError(`${label}最多 ${max} 个字符。`, 400, "too-long");
  return text;
}

export function dateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function maxExpiryDateValue(date = new Date()): string {
  const max = new Date(date.getFullYear(), date.getMonth(), date.getDate() + SHARED_SERVER_MAX_EXPIRY_DAYS);
  return dateInputValue(max);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function sanitizeExpiry(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw apiError("请选择有效期。", 400, "invalid-expiry");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw apiError("有效期日期无效。", 400, "invalid-expiry");
  }
  if (date.getTime() < startOfToday().getTime()) {
    throw apiError("有效期不能早于今天。", 400, "invalid-expiry");
  }
  const newest = new Date(
    startOfToday().getFullYear(),
    startOfToday().getMonth(),
    startOfToday().getDate() + SHARED_SERVER_MAX_EXPIRY_DAYS,
  );
  if (date.getTime() > newest.getTime()) {
    throw apiError(`有效期最长 ${SHARED_SERVER_MAX_EXPIRY_DAYS} 天。`, 400, "invalid-expiry");
  }
  return text;
}

function sanitizeInviteCode(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return "";
  if (code.length < 4 || code.length > 32) {
    throw apiError("邀请码需要 4-32 位字母或数字。", 400, "invalid-invite");
  }
  return code;
}

export function sanitizeSharedServerForm(input: unknown): SharedServerForm {
  const record = recordOf(input);
  const name = cleanText(record.name);
  if (name.length < 2) throw apiError("请填写至少 2 个字符的显示名称。", 400, "invalid-name");
  if (name.length > 40) throw apiError("显示名称最多 40 个字符。", 400, "invalid-name");

  let maxDevices: number | null = null;
  const rawDevices = cleanText(record.maxDevices);
  if (rawDevices) {
    const parsed = Number(rawDevices);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
      throw apiError("可接入设备数需要是 1-10000 的整数。", 400, "invalid-devices");
    }
    maxDevices = parsed;
  }

  return {
    name,
    address: normalizeSharedServerAddress(record.address),
    region: limited(record.region, 32, "地区"),
    specs: limited(record.specs, 80, "配置说明"),
    maxDevices,
    inviteCode: sanitizeInviteCode(record.inviteCode),
    note: limited(record.note, 200, "补充说明"),
    expiresAt: sanitizeExpiry(record.expiresAt),
  };
}

export function readSharedServerId(input: unknown): string {
  const value = typeof input === "string" ? input : textOf(recordOf(input).id);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(value)) {
    throw apiError("共享记录标识不合法，请刷新后再试。", 400, "invalid-id");
  }
  return value;
}

export function readReportInput(input: unknown): { id: string; reason: string } {
  const record = recordOf(input);
  const id = readSharedServerId(record);
  const reason = cleanText(record.reason);
  if (reason.length > SHARED_SERVER_REPORT_LIMIT) {
    throw apiError(`问题描述最多 ${SHARED_SERVER_REPORT_LIMIT} 个字符。`, 400, "too-long");
  }
  return { id, reason };
}

function readableServerMessage(value: unknown): string {
  const text = textOf(value).replace(/\s+/g, " ");
  if (!text || /^(internal (server )?error|error|forbidden|unauthorized|bad request)$/i.test(text)) {
    return "";
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function describeSharedServerError(
  status: number,
  payload: unknown,
  fallback: string,
): SharedServerApiError {
  const message = readableServerMessage(recordOf(payload).message);
  if (status === 401) {
    return apiError("请先登录若道账号后再操作共享服务器。", 401, "unauthorized");
  }
  if (status === 403) {
    return apiError(message || "没有权限执行该操作。", 403, "forbidden");
  }
  if (status === 404) {
    return apiError(message || "共享记录不存在或已下架。", 404, "not-found");
  }
  if (status === 429) {
    return apiError("操作过于频繁，请稍后再试。", 429, "rate-limited");
  }
  if (status >= 500) {
    return apiError(
      message ? `若道服务返回错误：${message}` : "若道服务暂时不可用，请稍后再试。",
      status,
      "server-error",
    );
  }
  return apiError(message || fallback, status, "http-error");
}

/** 后端 LocalDateTime 没有时区，按本地时间展示；解析失败时返回 null。 */
export function parseServerDate(value: string | null | undefined): Date | null {
  const text = textOf(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function expiresInDays(expiresAt: string | null | undefined, now = new Date()): number | null {
  const date = parseServerDate(expiresAt);
  if (!date) return null;
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}
