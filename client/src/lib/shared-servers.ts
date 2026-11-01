import type { SharedServerInfo } from "../types";

export const MAX_EXPIRY_DAYS = 365;

const ACCESS_MODES: Record<string, { label: string; hint: string }> = {
  invite: { label: "邀请制", hint: "连接时需要填写发布者提供的邀请码" },
  approval: { label: "审核制", hint: "接入后需要服务器管理员批准" },
  open: { label: "开放接入", hint: "填好服务器地址即可直接接入" },
};

export function todayInputValue(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function maxExpiryInputValue(now = new Date()): string {
  const max = new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_EXPIRY_DAYS);
  return todayInputValue(max);
}

export function accessModeInfo(mode: string): { label: string; hint: string } {
  return ACCESS_MODES[mode] ?? { label: "接入方式未知", hint: "发布时没有返回接入方式" };
}

export function serverHealth(server: SharedServerInfo): {
  tone: "idle" | "busy" | "online" | "error";
  label: string;
} {
  if (server.healthStatus === "offline") return { tone: "error", label: "离线" };
  if (server.online) return { tone: "online", label: "在线" };
  return { tone: "idle", label: "等待检查" };
}

export function parseServerDate(value: string | null | undefined): Date | null {
  const text = String(value ?? "").trim();
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

export function formatExpiryDate(expiresAt: string | null | undefined): string {
  const date = parseServerDate(expiresAt);
  if (!date) return "未填写";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function expiryText(expiresAt: string | null | undefined): string {
  const days = expiresInDays(expiresAt);
  if (days === null) return "未填写有效期";
  if (days < 0) return "已过期";
  if (days === 0) return "今天到期";
  return `剩余 ${days} 天`;
}

export function formatInviteCode(code: string): string {
  const normalized = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (normalized.length !== 8) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function serverStatusLabel(
  server: SharedServerInfo | null,
  gone: boolean,
): { tone: "idle" | "busy" | "online" | "error"; label: string } {
  if (gone) return { tone: "idle", label: "已下架或过期" };
  if (!server) return { tone: "idle", label: "状态未知" };
  if (server.status === "hidden") return { tone: "error", label: "已隐藏" };
  const days = expiresInDays(server.expiresAt);
  if (days !== null && days < 0) return { tone: "idle", label: "已过期" };
  if (server.healthStatus === "offline") return { tone: "error", label: "离线" };
  if (server.online) return { tone: "online", label: "在线" };
  return { tone: "idle", label: "等待检查" };
}
