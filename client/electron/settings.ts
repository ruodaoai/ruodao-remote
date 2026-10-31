import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StoredSettings {
  serverUrl: string;
  deviceName: string;
  autoStartHost: boolean;
  preferredCode: string;
  hostKeyEncrypted: string | null;
  hostKeySalt: string;
  deviceId: string;
  inviteCode: string;
  adminSecretEncrypted: string | null;
  adminSecretUrl: string;
  localServerEnabled: boolean;
  localServerPort: number;
  localServerPublicUrl: string;
  localAdminSecretEncrypted: string | null;
  launchAtLogin: boolean;
  autoUpdate: boolean;
  knownHostKeys: Record<string, string>;
}

export interface PublicSettings {
  serverUrl: string;
  deviceName: string;
  autoStartHost: boolean;
  preferredCode: string;
  keyPersisted: boolean;
  deviceId: string;
  inviteCode: string;
  adminReady: boolean;
  adminServerUrl: string;
  localServerEnabled: boolean;
  localServerPort: number;
  localServerPublicUrl: string;
  launchAtLogin: boolean;
  autoUpdate: boolean;
}

export interface AdminAccess {
  password: string;
  adminPath: string;
  healthToken: string;
}

export type SettingsPatch = Partial<
  Pick<
    StoredSettings,
    | "serverUrl"
    | "deviceName"
    | "autoStartHost"
    | "preferredCode"
    | "inviteCode"
    | "localServerEnabled"
    | "localServerPort"
    | "localServerPublicUrl"
    | "launchAtLogin"
    | "autoUpdate"
  >
>;

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const DEFAULT_LOCAL_PORT = 8787;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

let cache: StoredSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultServerUrl(): string {
  const fromEnv = process.env.REMOTE_SERVER_URL?.trim();
  if (fromEnv) {
    try {
      return normalizeServerUrl(fromEnv);
    } catch {
      return DEFAULT_SERVER_URL;
    }
  }
  return DEFAULT_SERVER_URL;
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("服务器地址不能为空");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("服务器地址格式不正确");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("服务器地址必须以 http://、https://、ws:// 或 wss:// 开头");
  }
  if (url.username || url.password) {
    throw new Error("服务器地址不能包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("服务器地址不能包含查询参数");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

function normalizeOptionalServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return normalizeServerUrl(trimmed);
}

function normalizeDeviceName(input: string): string {
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return cleaned || os.hostname() || "我的电脑";
}

function normalizeCode(input: string | undefined): string {
  return /^\d{9}$/.test(input ?? "") ? String(input) : "";
}

export function normalizeInviteCode(input: string | undefined): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function normalizeDeviceId(input: string | undefined): string {
  return DEVICE_ID_RE.test(input ?? "") ? String(input) : randomUUID();
}

function normalizePort(input: number): number {
  if (!Number.isFinite(input)) return DEFAULT_LOCAL_PORT;
  const port = Math.floor(input);
  return port >= 1024 && port <= 65535 ? port : DEFAULT_LOCAL_PORT;
}

function normalizeKnownHosts(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && /^SHA256:[A-Za-z0-9+/=]+$/.test(value)) {
      result[key.slice(0, 200)] = value;
    }
  }
  return result;
}

function fallbackSettings(): StoredSettings {
  return {
    serverUrl: defaultServerUrl(),
    deviceName: normalizeDeviceName(os.hostname()),
    autoStartHost: false,
    preferredCode: "",
    hostKeyEncrypted: null,
    hostKeySalt: "",
    deviceId: randomUUID(),
    inviteCode: "",
    adminSecretEncrypted: null,
    adminSecretUrl: "",
    localServerEnabled: false,
    localServerPort: DEFAULT_LOCAL_PORT,
    localServerPublicUrl: "",
    localAdminSecretEncrypted: null,
    launchAtLogin: false,
    autoUpdate: true,
    knownHostKeys: {},
  };
}

function readFromDisk(): StoredSettings {
  const file = settingsPath();
  if (!existsSync(file)) return fallbackSettings();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSettings>;
    return {
      serverUrl: raw.serverUrl ? normalizeServerUrl(raw.serverUrl) : defaultServerUrl(),
      deviceName: normalizeDeviceName(raw.deviceName ?? os.hostname()),
      autoStartHost: Boolean(raw.autoStartHost),
      preferredCode: normalizeCode(raw.preferredCode),
      hostKeyEncrypted: typeof raw.hostKeyEncrypted === "string" ? raw.hostKeyEncrypted : null,
      hostKeySalt: /^[0-9a-f]{32}$/i.test(raw.hostKeySalt ?? "") ? String(raw.hostKeySalt) : "",
      deviceId: normalizeDeviceId(raw.deviceId),
      inviteCode: normalizeInviteCode(raw.inviteCode),
      adminSecretEncrypted:
        typeof raw.adminSecretEncrypted === "string" ? raw.adminSecretEncrypted : null,
      adminSecretUrl:
        typeof raw.adminSecretUrl === "string" && raw.adminSecretUrl
          ? normalizeServerUrl(raw.adminSecretUrl)
          : "",
      localServerEnabled: Boolean(raw.localServerEnabled),
      localServerPort: normalizePort(Number(raw.localServerPort)),
      localServerPublicUrl: raw.localServerPublicUrl
        ? normalizeOptionalServerUrl(raw.localServerPublicUrl)
        : "",
      localAdminSecretEncrypted:
        typeof raw.localAdminSecretEncrypted === "string"
          ? raw.localAdminSecretEncrypted
          : null,
      launchAtLogin: Boolean(raw.launchAtLogin),
      autoUpdate: raw.autoUpdate === undefined ? true : Boolean(raw.autoUpdate),
      knownHostKeys: normalizeKnownHosts(raw.knownHostKeys),
    };
  } catch {
    return fallbackSettings();
  }
}

function persist(settings: StoredSettings): void {
  const dir = path.dirname(settingsPath());
  mkdirSync(dir, { recursive: true });
  const tmp = `${settingsPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, settingsPath());
  } catch {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

function current(): StoredSettings {
  if (!cache) cache = readFromDisk();
  return cache;
}

export function initializeSettings(): void {
  const settings = current();
  let changed = false;
  if (!existsSync(settingsPath())) changed = true;
  if (!DEVICE_ID_RE.test(settings.deviceId)) {
    settings.deviceId = randomUUID();
    changed = true;
  }
  if (changed) persist(settings);
}

function hasAdminSecretFor(serverUrl: string): boolean {
  const settings = current();
  if (settings.adminSecretEncrypted && settings.adminSecretUrl === serverUrl) return true;
  return false;
}

export function publicSettings(): PublicSettings {
  const settings = current();
  return {
    serverUrl: settings.serverUrl,
    deviceName: settings.deviceName,
    autoStartHost: settings.autoStartHost,
    preferredCode: settings.preferredCode,
    keyPersisted: Boolean(settings.hostKeyEncrypted),
    deviceId: settings.deviceId,
    inviteCode: settings.inviteCode,
    adminReady: hasAdminSecretFor(settings.serverUrl),
    adminServerUrl: settings.adminSecretUrl,
    localServerEnabled: settings.localServerEnabled,
    localServerPort: settings.localServerPort,
    localServerPublicUrl: settings.localServerPublicUrl,
    launchAtLogin: settings.launchAtLogin,
    autoUpdate: settings.autoUpdate,
  };
}

export function updateSettings(patch: SettingsPatch): PublicSettings {
  const settings = { ...current() };
  if (patch.serverUrl !== undefined) settings.serverUrl = normalizeServerUrl(patch.serverUrl);
  if (patch.deviceName !== undefined) settings.deviceName = normalizeDeviceName(patch.deviceName);
  if (patch.autoStartHost !== undefined) settings.autoStartHost = Boolean(patch.autoStartHost);
  if (patch.preferredCode !== undefined) settings.preferredCode = normalizeCode(patch.preferredCode);
  if (patch.inviteCode !== undefined) settings.inviteCode = normalizeInviteCode(patch.inviteCode);
  if (patch.localServerEnabled !== undefined) {
    settings.localServerEnabled = Boolean(patch.localServerEnabled);
  }
  if (patch.localServerPort !== undefined) settings.localServerPort = normalizePort(Number(patch.localServerPort));
  if (patch.localServerPublicUrl !== undefined) {
    settings.localServerPublicUrl = normalizeOptionalServerUrl(patch.localServerPublicUrl);
  }
  if (patch.launchAtLogin !== undefined) settings.launchAtLogin = Boolean(patch.launchAtLogin);
  if (patch.autoUpdate !== undefined) settings.autoUpdate = Boolean(patch.autoUpdate);
  cache = settings;
  persist(settings);
  return publicSettings();
}

export function saveHostKey(value: { key: string; salt: string } | null): { persisted: boolean } {
  const settings = { ...current() };
  if (!value) {
    settings.hostKeyEncrypted = null;
    settings.hostKeySalt = "";
    cache = settings;
    persist(settings);
    return { persisted: false };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    settings.hostKeyEncrypted = null;
    settings.hostKeySalt = "";
    cache = settings;
    persist(settings);
    return { persisted: false };
  }
  settings.hostKeyEncrypted = safeStorage.encryptString(value.key).toString("base64");
  settings.hostKeySalt = value.salt;
  cache = settings;
  persist(settings);
  return { persisted: true };
}

export function loadHostKey(): { key: string; salt: string } | null {
  const settings = current();
  if (!settings.hostKeyEncrypted || !settings.hostKeySalt) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const key = safeStorage.decryptString(Buffer.from(settings.hostKeyEncrypted, "base64"));
    if (!/^[A-Z0-9]{10}$/.test(key)) return null;
    return { key, salt: settings.hostKeySalt };
  } catch {
    return null;
  }
}

function normalizeAdminPagePath(value: unknown): string {
  if (typeof value !== "string") return "/admin";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/admin") return "/admin";
  return /^\/[A-Za-z0-9][A-Za-z0-9._~-]{5,63}$/.test(trimmed) ? trimmed : "/admin";
}

function normalizeHealthToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(trimmed) ? trimmed : "";
}

function parseAdminAccess(plain: string): AdminAccess | null {
  if (plain.startsWith("{")) {
    try {
      const raw = JSON.parse(plain) as Record<string, unknown>;
      const password = typeof raw.password === "string" ? raw.password : "";
      if (password) {
        return {
          password,
          adminPath: normalizeAdminPagePath(raw.adminPath),
          healthToken: normalizeHealthToken(raw.healthToken),
        };
      }
    } catch {
      // Older versions stored the raw password; fall through.
    }
  }
  return plain ? { password: plain, adminPath: "/admin", healthToken: "" } : null;
}

export function saveAdminSecret(
  serverUrl: string,
  password: string,
  extra: { adminPath?: string; healthToken?: string } = {},
): { persisted: boolean } {
  const trimmed = password.trim();
  if (trimmed.length < 6 || trimmed.length > 128) {
    throw new Error("管理员密码长度需要在 6 到 128 位之间");
  }
  const normalizedUrl = normalizeServerUrl(serverUrl);
  const existing = loadAdminAccess(normalizedUrl);
  const access: AdminAccess = {
    password: trimmed,
    adminPath: normalizeAdminPagePath(extra.adminPath ?? existing?.adminPath),
    healthToken: normalizeHealthToken(extra.healthToken ?? existing?.healthToken),
  };
  const settings = { ...current() };
  settings.adminSecretUrl = normalizedUrl;
  if (safeStorage.isEncryptionAvailable()) {
    settings.adminSecretEncrypted = safeStorage
      .encryptString(JSON.stringify(access))
      .toString("base64");
    cache = settings;
    persist(settings);
    return { persisted: true };
  }
  settings.adminSecretEncrypted = null;
  cache = settings;
  persist(settings);
  return { persisted: false };
}

export function loadAdminAccess(serverUrl: string): AdminAccess | null {
  const settings = current();
  if (!settings.adminSecretEncrypted || !settings.adminSecretUrl) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    if (normalizeServerUrl(serverUrl) !== settings.adminSecretUrl) return null;
    const plain = safeStorage.decryptString(Buffer.from(settings.adminSecretEncrypted, "base64"));
    return parseAdminAccess(plain);
  } catch {
    return null;
  }
}

export function loadAdminSecret(serverUrl: string): string | null {
  return loadAdminAccess(serverUrl)?.password ?? null;
}

export function clearAdminSecret(): void {
  const settings = { ...current(), adminSecretEncrypted: null, adminSecretUrl: "" };
  cache = settings;
  persist(settings);
}

export function saveLocalAdminSecret(password: string): { persisted: boolean } {
  const settings = { ...current() };
  if (!safeStorage.isEncryptionAvailable()) {
    settings.localAdminSecretEncrypted = null;
    cache = settings;
    persist(settings);
    return { persisted: false };
  }
  settings.localAdminSecretEncrypted = safeStorage.encryptString(password).toString("base64");
  cache = settings;
  persist(settings);
  return { persisted: true };
}

export function loadLocalAdminSecret(): string | null {
  const settings = current();
  if (!settings.localAdminSecretEncrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(settings.localAdminSecretEncrypted, "base64"));
  } catch {
    return null;
  }
}

export function clearLocalAdminSecret(): void {
  const settings = { ...current(), localAdminSecretEncrypted: null };
  cache = settings;
  persist(settings);
}

export function getKnownHostKey(hostKey: string): string | null {
  return current().knownHostKeys[hostKey] ?? null;
}

export function rememberHostKey(hostKey: string, fingerprint: string): void {
  const settings = { ...current() };
  settings.knownHostKeys = { ...settings.knownHostKeys, [hostKey]: fingerprint };
  cache = settings;
  persist(settings);
}

export function getLocalServerPort(): number {
  return current().localServerPort;
}

export function getLocalServerUrl(): string {
  return `http://127.0.0.1:${current().localServerPort}`;
}
