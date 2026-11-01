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

export interface ServerPolicy {
  /** 0 表示不限制并发远控人数 */
  maxSessions: number;
  /** 单次远控时长上限（分钟），0 表示不限制 */
  sessionLimitMinutes: number;
  /** 达到时长上限后需要等待的冷却时间（分钟） */
  cooldownMinutes: number;
  /** 冻结操作的默认时长（分钟） */
  freezeMinutes: number;
}

export const DEFAULT_SERVER_POLICY: ServerPolicy = {
  maxSessions: 0,
  sessionLimitMinutes: 0,
  cooldownMinutes: 5,
  freezeMinutes: 10,
};

export function normalizeServerPolicy(
  input: Partial<ServerPolicy> | undefined,
  fallback: ServerPolicy = DEFAULT_SERVER_POLICY,
): ServerPolicy {
  const read = (value: unknown, min: number, max: number, base: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return base;
    return Math.max(min, Math.min(max, Math.floor(value)));
  };
  return {
    maxSessions: read(input?.maxSessions, 0, 10000, fallback.maxSessions),
    sessionLimitMinutes: read(input?.sessionLimitMinutes, 0, 1440, fallback.sessionLimitMinutes),
    cooldownMinutes: read(input?.cooldownMinutes, 0, 1440, fallback.cooldownMinutes),
    freezeMinutes: read(input?.freezeMinutes, 1, 10080, fallback.freezeMinutes),
  };
}

export type AccessBlockKind = "device" | "ip";

export interface AccessBlockRecord {
  id: string;
  kind: AccessBlockKind;
  /** 设备 ID 或 IP 地址 */
  value: string;
  label: string;
  reason: string;
  createdAt: number;
  createdBy: string;
  /** null 表示永久拉黑，否则为冻结到期时间 */
  expiresAt: number | null;
}

export interface CooldownRecord {
  /** `device:<id>` 或 `ip:<ip>` */
  key: string;
  label: string;
  until: number;
  reason: string;
}

export function accessBlockKey(kind: AccessBlockKind, value: string): string {
  return `${kind}:${value}`;
}

function normalizeBlockValue(kind: AccessBlockKind, value: string): string {
  const trimmed = value.trim();
  return kind === "device" ? trimmed.slice(0, 64) : trimmed.toLowerCase().slice(0, 64);
}

function normalizeBlockRecord(input: Partial<AccessBlockRecord>): AccessBlockRecord | null {
  if (input.kind !== "device" && input.kind !== "ip") return null;
  if (typeof input.value !== "string" || !input.value.trim()) return null;
  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    kind: input.kind,
    value: normalizeBlockValue(input.kind, input.value),
    label: typeof input.label === "string" ? input.label.slice(0, 64) : "",
    reason: typeof input.reason === "string" ? input.reason.slice(0, 120) : "",
    createdAt: Number(input.createdAt) || Date.now(),
    createdBy: typeof input.createdBy === "string" ? input.createdBy.slice(0, 40) : "admin",
    expiresAt:
      typeof input.expiresAt === "number" && Number.isFinite(input.expiresAt)
        ? input.expiresAt
        : null,
  };
}

interface StateFile {
  version: 1;
  devices: DeviceRecord[];
  invites: InviteRecord[];
  audit: AuditRecord[];
  sessions: SessionLogRecord[];
  settings: ServerSettings;
  policy: ServerPolicy;
  blocks: AccessBlockRecord[];
  cooldowns: CooldownRecord[];
}

export interface StoreOptions {
  filePath?: string | null;
  now?: () => number;
  log?: (event: string, meta?: Record<string, unknown>) => void;
  registrationMode?: RegistrationMode;
  serverName?: string;
  policy?: Partial<ServerPolicy>;
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

  get policy(): ServerPolicy {
    return { ...this.data.policy };
  }

  updatePolicy(patch: Partial<ServerPolicy>): ServerPolicy {
    this.data.policy = normalizeServerPolicy(
      { ...this.data.policy, ...patch },
      this.data.policy,
    );
    this.persist();
    return this.policy;
  }

  listBlocks(): AccessBlockRecord[] {
    return this.data.blocks
      .map((block) => ({ ...block }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  findActiveBlock(
    matches: { deviceId: string; ip: string },
    at = this.now(),
  ): AccessBlockRecord | null {
    for (const block of this.data.blocks) {
      if (block.expiresAt !== null && block.expiresAt <= at) continue;
      if (block.kind === "device" && block.value === matches.deviceId) return { ...block };
      if (block.kind === "ip" && block.value === matches.ip.toLowerCase()) return { ...block };
    }
    return null;
  }

  addBlock(input: {
    kind: AccessBlockKind;
    value: string;
    label?: string;
    reason?: string;
    createdBy?: string;
    /** 冻结时长（毫秒），null 表示永久拉黑 */
    durationMs?: number | null;
  }): AccessBlockRecord {
    const now = this.now();
    const value = normalizeBlockValue(input.kind, input.value);
    this.data.blocks = this.data.blocks.filter(
      (block) => !(block.kind === input.kind && block.value === value),
    );
    const record: AccessBlockRecord = {
      id: randomUUID(),
      kind: input.kind,
      value,
      label: (input.label ?? "").trim().slice(0, 64) || value,
      reason: (input.reason ?? "").trim().slice(0, 120),
      createdAt: now,
      createdBy: (input.createdBy ?? "admin").slice(0, 40),
      expiresAt:
        typeof input.durationMs === "number" && input.durationMs > 0
          ? now + input.durationMs
          : null,
    };
    this.data.blocks.push(record);
    if (this.data.blocks.length > 500) {
      this.data.blocks = this.data.blocks.slice(-500);
    }
    this.persist();
    return { ...record };
  }

  removeBlock(id: string): AccessBlockRecord | null {
    const found = this.data.blocks.find((block) => block.id === id);
    if (!found) return null;
    this.data.blocks = this.data.blocks.filter((block) => block.id !== id);
    this.persist();
    return { ...found };
  }

  findCooldown(keys: string[], at = this.now()): CooldownRecord | null {
    for (const key of keys) {
      const found = this.data.cooldowns.find((item) => item.key === key && item.until > at);
      if (found) return { ...found };
    }
    return null;
  }

  listCooldowns(at = this.now()): CooldownRecord[] {
    return this.data.cooldowns
      .filter((item) => item.until > at)
      .map((item) => ({ ...item }))
      .sort((a, b) => a.until - b.until);
  }

  startCooldown(input: {
    deviceId?: string | null;
    ip?: string | null;
    label?: string;
    until: number;
    reason?: string;
  }): CooldownRecord[] {
    const now = this.now();
    const records: CooldownRecord[] = [];
    this.data.cooldowns = this.data.cooldowns.filter((item) => item.until > now);
    const push = (key: string) => {
      const record: CooldownRecord = {
        key,
        label: (input.label ?? key).slice(0, 64),
        until: input.until,
        reason: (input.reason ?? "").slice(0, 120),
      };
      this.data.cooldowns = this.data.cooldowns.filter((item) => item.key !== key);
      this.data.cooldowns.push(record);
      records.push({ ...record });
    };
    if (input.deviceId) push(`device:${input.deviceId}`);
    if (input.ip) push(`ip:${input.ip.toLowerCase()}`);
    if (records.length > 0) this.persist();
    return records;
  }

  clearCooldown(key: string): boolean {
    const before = this.data.cooldowns.length;
    this.data.cooldowns = this.data.cooldowns.filter((item) => item.key !== key);
    if (this.data.cooldowns.length === before) return false;
    this.persist();
    return true;
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
      policy: normalizeServerPolicy(options.policy),
      blocks: [],
      cooldowns: [],
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
      const blocks: AccessBlockRecord[] = Array.isArray(raw.blocks)
        ? raw.blocks
            .map((block) => normalizeBlockRecord(block as Partial<AccessBlockRecord>))
            .filter((block): block is AccessBlockRecord => block !== null)
            .slice(-500)
        : [];
      const now = this.now();
      const cooldowns: CooldownRecord[] = Array.isArray(raw.cooldowns)
        ? raw.cooldowns
            .filter(
              (item) =>
                item &&
                typeof item.key === "string" &&
                typeof item.until === "number" &&
                item.until > now,
            )
            .map((item) => ({
              key: String(item.key).slice(0, 80),
              label: String(item.label ?? "").slice(0, 64),
              until: Number(item.until),
              reason: String(item.reason ?? "").slice(0, 120),
            }))
        : [];
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
        policy: normalizeServerPolicy(raw.policy, fallback.policy),
        blocks,
        cooldowns,
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
