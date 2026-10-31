export type Platform = "win32" | "darwin" | "linux" | "unknown";
export type DeviceStatus = "pending" | "approved" | "blocked";

export interface PeerInfo {
  name: string;
  platform: Platform;
  ip: string;
}

export interface SessionStatsPayload {
  kbps: number;
  fps: number;
  width: number;
  height: number;
  rttMs: number;
  jitterMs: number;
  lossPct: number;
}

export interface SessionTelemetry extends SessionStatsPayload {
  reporter: "host" | "controller";
  updatedAt: number;
}

export type SessionEventKind = "danger" | "clipboard" | "info";

export interface SessionDangerEvent {
  at: number;
  action: string;
  label: string;
}

export interface ServerStatsInfo {
  at: number;
  bandwidthInKbps: number;
  bandwidthOutKbps: number;
  wsInKbps: number;
  wsOutKbps: number;
  sessions: number;
  peers: number;
  load1: number;
  cpuPct: number;
  lagMs: number;
  memoryPct: number;
  uptimeSeconds: number;
}

export const SESSION_DANGER_LABELS: Record<string, string> = {
  "ctrl-alt-del": "Ctrl+Alt+Delete 安全界面",
  "ctrl-shift-esc": "任务管理器",
  "alt-f4": "关闭前台窗口",
  "win-l": "锁定对方屏幕",
  "win-r": "运行命令框",
  "win-x": "系统快捷菜单",
  "win-u": "辅助功能中心",
  power: "电源相关操作",
};

export function dangerActionLabel(action: string): string {
  return SESSION_DANGER_LABELS[action] ?? action;
}

export interface CatalogHost {
  deviceId: string;
  name: string;
  platform: Platform;
  note: string;
  busy: boolean;
  publishedAt: number;
}

export interface HostControlRequestInfo {
  id: string;
  controllerName: string;
  platform: Platform;
  expiresAt: number;
}

export type ControlDenyReason =
  | "not-found"
  | "not-published"
  | "busy"
  | "self"
  | "rate-limited"
  | "device-pending"
  | "device-blocked"
  | "already-session"
  | "already-pending"
  | "expired"
  | "denied"
  | "unpublished"
  | "host-offline"
  | "token-invalid"
  | "token-expired"
  | "cancelled";

export type ClientMessage =
  | {
      type: "client.hello";
      deviceId: string;
      deviceName: string;
      platform?: Platform;
      version: string;
      inviteCode?: string;
    }
  | {
      type: "host.register";
      requestedCode?: string;
      keySalt: string;
      keyHash: string;
      deviceName: string;
      platform?: Platform;
    }
  | { type: "host.update-key"; keySalt: string; keyHash: string }
  | { type: "host.unregister" }
  | { type: "host.heartbeat" }
  | { type: "controller.lookup"; code: string }
  | {
      type: "controller.connect";
      code: string;
      keyHash: string;
      controllerName: string;
      platform?: Platform;
    }
  | { type: "controller.disconnect" }
  | { type: "host.publish"; published: boolean; note?: string }
  | { type: "host.control-decision"; requestId: string; accept: boolean }
  | { type: "controller.request"; hostDeviceId: string }
  | {
      type: "controller.connect-token";
      token: string;
      controllerName: string;
      platform?: Platform;
    }
  | { type: "session.stats"; stats: SessionStatsPayload }
  | {
      type: "session.event";
      kind: SessionEventKind;
      action: string;
      detail?: string;
    }
  | { type: "signal"; data: unknown }
  | { type: "ping" };

export type RejectReason =
  | "not-found"
  | "invalid-key"
  | "busy"
  | "rate-limited"
  | "self"
  | "host-offline"
  | "device-pending"
  | "device-blocked";

export type ClientRejectReason =
  | "invite-required"
  | "invite-invalid"
  | "blocked"
  | "device-pending"
  | "invalid-hello"
  | "admin-disconnect";

export type RegistrationMode = "invite" | "approval" | "open";

export type ServerMessage =
  | {
      type: "client.welcome";
      device: { id: string; name: string; status: DeviceStatus };
      registrationMode: RegistrationMode;
      serverName: string;
      publicUrl: string;
    }
  | {
      type: "client.rejected";
      reason: ClientRejectReason;
      message: string;
    }
  | { type: "host.registered"; code: string; iceServers: IceServer[] }
  | { type: "host.key-updated"; code: string }
  | {
      type: "host.paired";
      sessionId: string;
      controller: PeerInfo;
      iceServers: IceServer[];
    }
  | {
      type: "controller.challenge";
      code: string;
      keySalt: string;
      host: PeerInfo;
    }
  | {
      type: "controller.paired";
      sessionId: string;
      host: PeerInfo;
      iceServers: IceServer[];
    }
  | { type: "controller.rejected"; reason: RejectReason; message: string }
  | { type: "host.publish-state"; published: boolean; note: string }
  | { type: "catalog.snapshot"; hosts: CatalogHost[] }
  | { type: "catalog.updated"; hosts: CatalogHost[] }
  | { type: "host.control-request"; request: HostControlRequestInfo }
  | { type: "host.control-approved"; requestId: string; expiresAt: number }
  | { type: "host.control-closed"; requestId: string; reason: string }
  | {
      type: "controller.request-sent";
      requestId: string;
      host: PeerInfo;
      expiresAt: number;
    }
  | {
      type: "controller.request-accepted";
      requestId: string;
      token: string;
      host: PeerInfo;
      expiresAt: number;
    }
  | {
      type: "controller.request-denied";
      requestId: string;
      reason: ControlDenyReason;
      message: string;
    }
  | { type: "signal"; data: unknown }
  | { type: "peer.left"; reason: string }
  | { type: "server.stats"; stats: ServerStatsInfo }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string };

const CODE_RE = /^\d{9}$/;
const SALT_RE = /^[0-9a-f]{32}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const INVITE_RE = /^[A-Za-z0-9-]{4,32}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/i;
const ACTION_RE = /^[a-z0-9-]{1,32}$/;
const MAX_NAME_LENGTH = 64;
const MAX_NOTE_LENGTH = 120;
const MAX_SIGNAL_BYTES = 64 * 1024;
const SESSION_EVENT_KINDS: SessionEventKind[] = ["danger", "clipboard", "info"];

const PLATFORMS: Platform[] = ["win32", "darwin", "linux", "unknown"];

function readBoundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped * 10) / 10;
}

export function isRemoteCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

export function isKeySalt(value: unknown): value is string {
  return typeof value === "string" && SALT_RE.test(value);
}

export function isKeyHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function readPlatform(value: unknown): Platform {
  return PLATFORMS.includes(value as Platform) ? (value as Platform) : "unknown";
}

export function parseClientMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "invalid-message" };
  }

  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case "client.hello": {
      if (typeof msg.deviceId !== "string" || !DEVICE_ID_RE.test(msg.deviceId)) {
        return { ok: false, error: "invalid-device-id" };
      }
      const deviceName = readString(msg.deviceName, MAX_NAME_LENGTH);
      if (!deviceName) return { ok: false, error: "invalid-name" };
      if (typeof msg.version !== "string" || !CLIENT_VERSION_RE.test(msg.version)) {
        return { ok: false, error: "invalid-version" };
      }
      let inviteCode: string | undefined;
      if (msg.inviteCode !== undefined && msg.inviteCode !== "") {
        if (typeof msg.inviteCode !== "string" || !INVITE_RE.test(msg.inviteCode)) {
          return { ok: false, error: "invalid-invite" };
        }
        inviteCode = msg.inviteCode;
      }
      return {
        ok: true,
        message: {
          type: "client.hello",
          deviceId: msg.deviceId,
          deviceName,
          version: msg.version,
          platform: readPlatform(msg.platform),
          inviteCode,
        },
      };
    }
    case "host.register": {
      if (!isKeySalt(msg.keySalt)) return { ok: false, error: "invalid-salt" };
      if (!isKeyHash(msg.keyHash)) return { ok: false, error: "invalid-hash" };
      const deviceName = readString(msg.deviceName, MAX_NAME_LENGTH);
      if (!deviceName) return { ok: false, error: "invalid-name" };
      if (msg.requestedCode !== undefined && !isRemoteCode(msg.requestedCode)) {
        return { ok: false, error: "invalid-code" };
      }
      return {
        ok: true,
        message: {
          type: "host.register",
          requestedCode: msg.requestedCode as string | undefined,
          keySalt: String(msg.keySalt).toLowerCase(),
          keyHash: String(msg.keyHash).toLowerCase(),
          deviceName,
          platform: readPlatform(msg.platform),
        },
      };
    }
    case "host.update-key": {
      if (!isKeySalt(msg.keySalt)) return { ok: false, error: "invalid-salt" };
      if (!isKeyHash(msg.keyHash)) return { ok: false, error: "invalid-hash" };
      return {
        ok: true,
        message: {
          type: "host.update-key",
          keySalt: String(msg.keySalt).toLowerCase(),
          keyHash: String(msg.keyHash).toLowerCase(),
        },
      };
    }
    case "host.unregister":
    case "host.heartbeat":
    case "controller.disconnect":
    case "ping":
      return { ok: true, message: { type: msg.type } };
    case "host.publish": {
      if (typeof msg.published !== "boolean") {
        return { ok: false, error: "invalid-publish" };
      }
      if (msg.note !== undefined && typeof msg.note !== "string") {
        return { ok: false, error: "invalid-note" };
      }
      const note = typeof msg.note === "string" ? msg.note.trim() : "";
      if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: "invalid-note" };
      return {
        ok: true,
        message: { type: "host.publish", published: msg.published, note },
      };
    }
    case "host.control-decision": {
      if (typeof msg.requestId !== "string" || !REQUEST_ID_RE.test(msg.requestId)) {
        return { ok: false, error: "invalid-request-id" };
      }
      if (typeof msg.accept !== "boolean") {
        return { ok: false, error: "invalid-decision" };
      }
      return {
        ok: true,
        message: { type: "host.control-decision", requestId: msg.requestId, accept: msg.accept },
      };
    }
    case "controller.request": {
      if (typeof msg.hostDeviceId !== "string" || !DEVICE_ID_RE.test(msg.hostDeviceId)) {
        return { ok: false, error: "invalid-device-id" };
      }
      return {
        ok: true,
        message: { type: "controller.request", hostDeviceId: msg.hostDeviceId },
      };
    }
    case "controller.connect-token": {
      if (typeof msg.token !== "string" || !TOKEN_RE.test(msg.token)) {
        return { ok: false, error: "invalid-token" };
      }
      const controllerName = readString(msg.controllerName, MAX_NAME_LENGTH);
      if (!controllerName) return { ok: false, error: "invalid-name" };
      return {
        ok: true,
        message: {
          type: "controller.connect-token",
          token: msg.token.toLowerCase(),
          controllerName,
          platform: readPlatform(msg.platform),
        },
      };
    }
    case "controller.lookup": {
      if (!isRemoteCode(msg.code)) return { ok: false, error: "invalid-code" };
      return { ok: true, message: { type: "controller.lookup", code: msg.code } };
    }
    case "controller.connect": {
      if (!isRemoteCode(msg.code)) return { ok: false, error: "invalid-code" };
      if (!isKeyHash(msg.keyHash)) return { ok: false, error: "invalid-hash" };
      const controllerName = readString(msg.controllerName, MAX_NAME_LENGTH);
      if (!controllerName) return { ok: false, error: "invalid-name" };
      return {
        ok: true,
        message: {
          type: "controller.connect",
          code: msg.code,
          keyHash: String(msg.keyHash).toLowerCase(),
          controllerName,
          platform: readPlatform(msg.platform),
        },
      };
    }
    case "session.stats": {
      const source =
        typeof msg.stats === "object" && msg.stats !== null && !Array.isArray(msg.stats)
          ? (msg.stats as Record<string, unknown>)
          : null;
      if (!source) return { ok: false, error: "invalid-stats" };
      const kbps = readBoundedNumber(source.kbps, 0, 1_000_000);
      const fps = readBoundedNumber(source.fps, 0, 600);
      const width = readBoundedNumber(source.width, 0, 16_384);
      const height = readBoundedNumber(source.height, 0, 16_384);
      const rttMs = readBoundedNumber(source.rttMs, 0, 60_000);
      const jitterMs = readBoundedNumber(source.jitterMs, 0, 60_000);
      const lossPct = readBoundedNumber(source.lossPct, 0, 100);
      if (
        kbps === null ||
        fps === null ||
        width === null ||
        height === null ||
        rttMs === null ||
        jitterMs === null ||
        lossPct === null
      ) {
        return { ok: false, error: "invalid-stats" };
      }
      return {
        ok: true,
        message: {
          type: "session.stats",
          stats: { kbps, fps, width, height, rttMs, jitterMs, lossPct },
        },
      };
    }
    case "session.event": {
      if (!SESSION_EVENT_KINDS.includes(msg.kind as SessionEventKind)) {
        return { ok: false, error: "invalid-event-kind" };
      }
      if (typeof msg.action !== "string" || !ACTION_RE.test(msg.action)) {
        return { ok: false, error: "invalid-event-action" };
      }
      let detail: string | undefined;
      if (msg.detail !== undefined) {
        if (typeof msg.detail !== "string") return { ok: false, error: "invalid-event-detail" };
        const trimmed = msg.detail
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, MAX_NOTE_LENGTH);
        detail = trimmed || undefined;
      }
      return {
        ok: true,
        message: {
          type: "session.event",
          kind: msg.kind as SessionEventKind,
          action: msg.action,
          detail,
        },
      };
    }
    case "signal": {
      if (typeof msg.data !== "object" || msg.data === null || Array.isArray(msg.data)) {
        return { ok: false, error: "invalid-signal" };
      }
      if (Buffer.byteLength(JSON.stringify(msg.data), "utf8") > MAX_SIGNAL_BYTES) {
        return { ok: false, error: "signal-too-large" };
      }
      return { ok: true, message: { type: "signal", data: msg.data } };
    }
    default:
      return { ok: false, error: "unknown-type" };
  }
}

export function encodeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
