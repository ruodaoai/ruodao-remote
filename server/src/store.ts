import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  DeviceStatus,
  Platform,
  RegistrationMode,
  SessionDangerEvent,
  SessionTelemetry,
} from "./protocol";

export type { RegistrationMode } from "./protocol";

export interface DeviceRecord {
  id: string;
  name: string;
  platform: Platform;
  version: string;
  status: DeviceStatus;
  firstSeen: number;
  lastSeen: number;
  lastIp: string;
  inviteCode: string | null;
}

export interface InviteRecord {
  code: string;
  label: string;
  createdAt: number;
  createdBy: string;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  usedBy: string[];
}

export interface AuditRecord {
  id: string;
  at: number;
  action: string;
  actor: string;
  deviceId?: string;
  detail?: string;
}

export interface SessionLogRecord {
  id: string;
  code: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reason: string;
  host: { deviceId: string | null; name: string; ip: string };
  controller: { deviceId: string | null; name: string; ip: string };
  telemetry: SessionTelemetry | null;
  dangerEvents: SessionDangerEvent[];
}

export interface ServerSettings {
  registrationMode: RegistrationMode;
  serverName: string;
}

interface StateFile {
  version: 1;
  devices: DeviceRecord[];
  invites: InviteRecord[];
  audit: AuditRecord[];
  sessions: SessionLogRecord[];
  settings: ServerSettings;
}

export interface StoreOptions {
  filePath?: string | null;
  now?: () => number;
  log?: (event: string, meta?: Record<string, unknown>) => void;
  registrationMode?: RegistrationMode;
  serverName?: string;
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_LENGTH = 8;
const MAX_AUDIT = 800;
const MAX_SESSION_LOGS = 1000;

export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_LENGTH; i += 1) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  if (normalized.length !== INVITE_LENGTH) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export type InviteCheck =
  | { ok: true; invite: InviteRecord }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "exhausted" };

export class StateStore {
  private data: StateFile;
  private readonly filePath: string | null;
  private readonly now: () => number;
  private readonly log: (event: string, meta?: Record<string, unknown>) => void;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options: StoreOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.data = this.load(options);
  }

  get settings(): ServerSettings {
    return { ...this.data.settings };
  }

  updateSettings(patch: Partial<ServerSettings>): ServerSettings {
    if (patch.registrationMode) this.data.settings.registrationMode = patch.registrationMode;
    if (patch.serverName) this.data.settings.serverName = patch.serverName.slice(0, 64);
    this.persist();
    return this.settings;
  }

  listDevices(): DeviceRecord[] {
    return this.data.devices.map((device) => ({ ...device }));
  }

  getDevice(deviceId: string): DeviceRecord | undefined {
    const found = this.data.devices.find((device) => device.id === deviceId);
    return found ? { ...found } : undefined;
  }

  registerDevice(input: {
    id: string;
    name: string;
    platform: Platform;
    version: string;
    status: DeviceStatus;
    ip: string;
    inviteCode?: string | null;
  }): DeviceRecord {
    const now = this.now();
    const existing = this.data.devices.find((device) => device.id === input.id);
    if (existing) {
      existing.name = input.name;
      existing.platform = input.platform;
      existing.version = input.version;
      existing.lastSeen = now;
      existing.lastIp = input.ip;
      this.persist();
      return { ...existing };
    }
    const device: DeviceRecord = {
      id: input.id,
      name: input.name,
      platform: input.platform,
      version: input.version,
      status: input.status,
      firstSeen: now,
      lastSeen: now,
      lastIp: input.ip,
      inviteCode: input.inviteCode ?? null,
    };
    this.data.devices.push(device);
    this.persist();
    return { ...device };
  }

  touchDevice(deviceId: string, patch: { ip?: string; at?: number } = {}): void {
    const device = this.data.devices.find((item) => item.id === deviceId);
    if (!device) return;
    device.lastSeen = patch.at ?? this.now();
    if (patch.ip) device.lastIp = patch.ip;
    this.persist();
  }

  setDeviceStatus(deviceId: string, status: DeviceStatus): DeviceRecord | null {
    const device = this.data.devices.find((item) => item.id === deviceId);
    if (!device) return null;
    device.status = status;
    device.lastSeen = this.now();
    this.persist();
    return { ...device };
  }

  removeDevice(deviceId: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((device) => device.id !== deviceId);
    if (this.data.devices.length === before) return false;
    this.persist();
    return true;
  }

  listInvites(): InviteRecord[] {
    return this.data.invites
      .map((invite) => ({ ...invite, usedBy: [...invite.usedBy] }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  findInvite(code: string): InviteRecord | undefined {
    const normalized = normalizeInviteCode(code);
    const found = this.data.invites.find((invite) => invite.code === normalized);
    return found ? { ...found, usedBy: [...found.usedBy] } : undefined;
  }

  createInvite(input: {
    label?: string;
    createdBy: string;
    maxUses?: number;
    expiresInMs?: number | null;
  }): InviteRecord {
    const now = this.now();
    let code = generateInviteCode();
    while (this.data.invites.some((invite) => invite.code === code)) {
      code = generateInviteCode();
    }
    const invite: InviteRecord = {
      code,
      label: (input.label ?? "").trim().slice(0, 40) || "未命名邀请码",
      createdAt: now,
      createdBy: input.createdBy.slice(0, 40),
      expiresAt:
        typeof input.expiresInMs === "number" && input.expiresInMs > 0
          ? now + input.expiresInMs
          : null,
      maxUses: Math.max(0, Math.floor(input.maxUses ?? 0)),
      uses: 0,
      lastUsedAt: null,
      revokedAt: null,
      usedBy: [],
    };
    this.data.invites.push(invite);
    this.persist();
    return { ...invite, usedBy: [] };
  }

  consumeInvite(code: string | undefined, deviceId: string): InviteCheck {
    if (!code || !normalizeInviteCode(code)) return { ok: false, reason: "missing" };
    const normalized = normalizeInviteCode(code);
    const invite = this.data.invites.find((item) => item.code === normalized);
    if (!invite || invite.revokedAt) return { ok: false, reason: "invalid" };
    if (invite.expiresAt !== null && invite.expiresAt <= this.now()) {
      return { ok: false, reason: "expired" };
    }
    if (invite.usedBy.includes(deviceId)) {
      return { ok: true, invite: { ...invite, usedBy: [...invite.usedBy] } };
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return { ok: false, reason: "exhausted" };
    }
    invite.uses += 1;
    invite.lastUsedAt = this.now();
    invite.usedBy.push(deviceId);
    this.persist();
    return { ok: true, invite: { ...invite, usedBy: [...invite.usedBy] } };
  }

  revokeInvite(code: string): InviteRecord | null {
    const normalized = normalizeInviteCode(code);
    const invite = this.data.invites.find((item) => item.code === normalized);
    if (!invite) return null;
    invite.revokedAt = this.now();
    this.persist();
    return { ...invite, usedBy: [...invite.usedBy] };
  }

  removeInvite(code: string): boolean {
    const normalized = normalizeInviteCode(code);
    const before = this.data.invites.length;
    this.data.invites = this.data.invites.filter((invite) => invite.code !== normalized);
    if (this.data.invites.length === before) return false;
    this.persist();
    return true;
  }

  audit(
    action: string,
    actor: string,
    detail?: string,
    deviceId?: string,
  ): AuditRecord {
    const record: AuditRecord = {
      id: randomUUID(),
      at: this.now(),
      action,
      actor,
      deviceId,
      detail,
    };
    this.data.audit.push(record);
    if (this.data.audit.length > MAX_AUDIT) {
      this.data.audit = this.data.audit.slice(-MAX_AUDIT);
    }
    this.persist();
    return record;
  }

  listAudit(limit = 100): AuditRecord[] {
    const size = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.data.audit.slice(-size).reverse().map((entry) => ({ ...entry }));
  }

  recordSession(record: SessionLogRecord): void {
    this.data.sessions.push({
      ...record,
      host: { ...record.host },
      controller: { ...record.controller },
      telemetry: record.telemetry ? { ...record.telemetry } : null,
      dangerEvents: record.dangerEvents.map((event) => ({ ...event })),
    });
    if (this.data.sessions.length > MAX_SESSION_LOGS) {
      this.data.sessions = this.data.sessions.slice(-MAX_SESSION_LOGS);
    }
    this.persist();
  }

  listSessionLogs(limit = 100): SessionLogRecord[] {
    const size = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.data.sessions
      .slice(-size)
      .reverse()
      .map((entry) => ({
        ...entry,
        host: { ...entry.host },
        controller: { ...entry.controller },
        telemetry: entry.telemetry ? { ...entry.telemetry } : null,
        dangerEvents: entry.dangerEvents.map((event) => ({ ...event })),
      }));
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.write();
  }

  close(): void {
    this.flush();
  }

  private load(options: StoreOptions): StateFile {
    const fallback: StateFile = {
      version: 1,
      devices: [],
      invites: [],
      audit: [],
      sessions: [],
      settings: {
        registrationMode: options.registrationMode ?? "invite",
        serverName: options.serverName?.trim().slice(0, 64) || "若道远程服务",
      },
    };
    if (!this.filePath || !existsSync(this.filePath)) return fallback;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StateFile>;
      const devices = Array.isArray(raw.devices)
        ? raw.devices.filter((item) => item && typeof item.id === "string")
        : [];
      const invites = Array.isArray(raw.invites)
        ? raw.invites.filter((item) => item && typeof item.code === "string")
        : [];
      const audit = Array.isArray(raw.audit) ? raw.audit : [];
      const sessions: SessionLogRecord[] = Array.isArray(raw.sessions)
        ? raw.sessions
            .filter((item) => item && typeof item.id === "string")
            .slice(-MAX_SESSION_LOGS)
            .map((item) => ({
              id: item.id,
              code: String(item.code ?? ""),
              startedAt: Number(item.startedAt) || 0,
              endedAt: Number(item.endedAt) || 0,
              durationMs: Number(item.durationMs) || 0,
              reason: String(item.reason ?? "unknown"),
              host: {
                deviceId: item.host?.deviceId ?? null,
                name: String(item.host?.name ?? "远程设备"),
                ip: String(item.host?.ip ?? ""),
              },
              controller: {
                deviceId: item.controller?.deviceId ?? null,
                name: String(item.controller?.name ?? "远程控制端"),
                ip: String(item.controller?.ip ?? ""),
              },
              telemetry: item.telemetry ?? null,
              dangerEvents: Array.isArray(item.dangerEvents)
                ? item.dangerEvents.slice(-50)
                : [],
            }))
        : [];
      const mode = raw.settings?.registrationMode;
      return {
        version: 1,
        devices: devices.map((device) => ({
          ...device,
          status:
            device.status === "approved" || device.status === "blocked"
              ? device.status
              : "pending",
          inviteCode: device.inviteCode ?? null,
        })),
        invites: invites.map((invite) => ({
          ...invite,
          maxUses: Number.isFinite(invite.maxUses) ? Number(invite.maxUses) : 0,
          uses: Number.isFinite(invite.uses) ? Number(invite.uses) : 0,
          usedBy: Array.isArray(invite.usedBy) ? invite.usedBy : [],
          revokedAt: invite.revokedAt ?? null,
          expiresAt: invite.expiresAt ?? null,
          lastUsedAt: invite.lastUsedAt ?? null,
        })),
        audit: audit.map((entry) => ({
          ...entry,
          id: entry.id ?? randomUUID(),
          at: Number(entry.at) || Date.now(),
          action: String(entry.action ?? "unknown"),
          actor: String(entry.actor ?? "system"),
        })),
        sessions,
        settings: {
          registrationMode:
            mode === "approval" || mode === "open" || mode === "invite"
              ? mode
              : fallback.settings.registrationMode,
          serverName:
            typeof raw.settings?.serverName === "string" && raw.settings.serverName.trim()
              ? raw.settings.serverName.trim().slice(0, 64)
              : fallback.settings.serverName,
        },
      };
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        renameSync(this.filePath, backup);
      } catch {
        // Keep the original file if it cannot be moved aside.
      }
      this.log("store.load-failed", {
        message: error instanceof Error ? error.message : String(error),
        backup,
      });
      return fallback;
    }
  }

  private persist(): void {
    if (!this.filePath || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.write();
    }, 200);
    this.flushTimer.unref();
  }

  private write(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const payload = JSON.stringify(this.data, null, 2);
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
      try {
        renameSync(tmp, this.filePath);
      } catch {
        writeFileSync(this.filePath, payload, { encoding: "utf8", mode: 0o600 });
      }
    } catch (error) {
      this.log("store.write-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function generateSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
