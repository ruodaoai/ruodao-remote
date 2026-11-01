import { app, ipcMain, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  acquireAssistantLease,
  assistantApiBase,
  forceRefreshAssistantLease,
  peekAssistantLease,
} from "./assistant";
import { unwrapApiPayload } from "./assistant-protocol";
import {
  SHARED_SERVER_PAGE_SIZE,
  describeSharedServerError,
  parseSharedServerInfo,
  parseSharedServerPage,
  readReportInput,
  readSharedServerId,
  sanitizeSharedServerForm,
  type SharedServerInfo,
  type SharedServerSort,
} from "./shared-servers-protocol";

const API_BASE = assistantApiBase();
const API_PATH = "/api/remote/shared-servers";
const HTTP_TIMEOUT_MS = 20_000;
const MANAGE_TIMEOUT_MS = 40_000;
const MAX_STORED_ENTRIES = 50;
const REFRESH_CONCURRENCY = 4;
const PUBLISH_LOGIN_REQUIRED = "请先登录若道账号后再发布共享服务器。";
const MANAGE_LOGIN_REQUIRED = "请先登录若道账号后再管理共享服务器。";
const REPORT_LOGIN_REQUIRED = "请先登录若道账号后再报告问题。";

interface StoredMineEntry {
  id: string;
  token: string;
  addedAt: number;
  syncedAt: number;
  gone: boolean;
  server: SharedServerInfo | null;
}

interface StoreFile {
  apiBaseUrl: string;
  entries: StoredMineEntry[];
}

export interface SharedServerMineView {
  id: string;
  addedAt: number;
  syncedAt: number;
  gone: boolean;
  server: SharedServerInfo | null;
  error: string | null;
}

interface RawResponse {
  status: number;
  data: unknown;
}

let cache: StoreFile | null | undefined;
let registered = false;

function storePath(): string {
  return path.join(app.getPath("userData"), "shared-servers.json");
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStore(): StoreFile | null {
  if (cache !== undefined) return cache;
  if (!existsSync(storePath())) {
    cache = null;
    return cache;
  }
  try {
    const raw = recordOf(JSON.parse(readFileSync(storePath(), "utf8")));
    if (raw.apiBaseUrl !== API_BASE || !Array.isArray(raw.entries)) {
      cache = null;
      return cache;
    }
    const entries: StoredMineEntry[] = [];
    for (const item of raw.entries) {
      const record = recordOf(item);
      const id = textOf(record.id);
      const token = textOf(record.token);
      if (!id || !token) continue;
      entries.push({
        id,
        token,
        addedAt: Number(record.addedAt) || 0,
        syncedAt: Number(record.syncedAt) || 0,
        gone: record.gone === true,
        server: parseSharedServerInfo(record.server),
      });
    }
    cache = { apiBaseUrl: API_BASE, entries };
  } catch {
    cache = null;
  }
  return cache;
}

function persist(store: StoreFile): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(store, null, 2);
  writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, payload, { encoding: "utf8", mode: 0o600 });
  }
  cache = store;
}

function ensureStore(): StoreFile {
  const store = readStore();
  if (store) return { apiBaseUrl: API_BASE, entries: [...store.entries] };
  return { apiBaseUrl: API_BASE, entries: [] };
}

function encodeToken(token: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(token).toString("base64")}`;
    }
  } catch {
    // Fall back to a plain, file-permission-protected token.
  }
  return `plain:${token}`;
}

function decodeToken(stored: string): string | null {
  if (stored.startsWith("enc:")) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64")) || null;
    } catch {
      return null;
    }
  }
  if (stored.startsWith("plain:")) return stored.slice(6) || null;
  return null;
}

function mineViews(store: StoreFile, errors: Map<string, string> = new Map()): SharedServerMineView[] {
  return [...store.entries]
    .sort((left, right) => right.addedAt - left.addedAt)
    .map((entry) => ({
      id: entry.id,
      addedAt: entry.addedAt,
      syncedAt: entry.syncedAt,
      gone: entry.gone,
      server: entry.server,
      error: errors.get(entry.id) ?? null,
    }));
}

function allEntries(): StoreFile {
  return ensureStore();
}

function findEntry(id: string): { store: StoreFile; entry: StoredMineEntry } | null {
  const store = ensureStore();
  const entry = store.entries.find((item) => item.id === id);
  return entry ? { store, entry } : null;
}

function managedToken(id: string): string {
  const found = findEntry(id);
  if (!found) {
    throw new Error("本机没有这条共享记录的管理令牌，可能是在其他设备发布的。");
  }
  const token = decodeToken(found.entry.token);
  if (!token) {
    throw new Error("本机保存的管理令牌无法读取，请重新发布一条共享记录。");
  }
  return token;
}

function rememberCreated(server: SharedServerInfo, manageToken: string): void {
  const store = ensureStore();
  const now = Date.now();
  store.entries = store.entries.filter((entry) => entry.id !== server.id);
  store.entries.unshift({
    id: server.id,
    token: encodeToken(manageToken),
    addedAt: now,
    syncedAt: now,
    gone: false,
    server,
  });
  if (store.entries.length > MAX_STORED_ENTRIES) {
    store.entries = store.entries.slice(0, MAX_STORED_ENTRIES);
  }
  persist(store);
}

function forgetEntry(id: string): void {
  const store = ensureStore();
  const next = store.entries.filter((entry) => entry.id !== id);
  if (next.length === store.entries.length) return;
  store.entries = next;
  persist(store);
}

function updateSnapshot(id: string, server: SharedServerInfo): void {
  const found = findEntry(id);
  if (!found) return;
  found.entry.server = server;
  found.entry.syncedAt = Date.now();
  found.entry.gone = false;
  persist(found.store);
}

async function httpJson(
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    manageToken?: string;
    timeoutMs?: number;
  } = {},
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1_000, options.timeoutMs ?? HTTP_TIMEOUT_MS),
  );
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-ruodao-client": "desktop",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.manageToken) headers["x-manage-token"] = options.manageToken;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      redirect: "manual",
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
      throw new Error("连接若道服务超时，请检查网络后重试。");
    }
    throw new Error("无法连接若道服务，请检查网络后重试。");
  } finally {
    clearTimeout(timer);
  }
}

function ok(result: RawResponse): boolean {
  return result.status >= 200 && result.status < 300;
}

function readListInput(input: unknown): {
  q: string;
  sort: SharedServerSort;
  onlineOnly: boolean;
  page: number;
  size: number;
} {
  const record = recordOf(input);
  const q = typeof record.q === "string" ? record.q.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const sort: SharedServerSort =
    record.sort === "newest" || record.sort === "expiring" ? record.sort : "recommended";
  const rawPage = Math.round(Number(record.page));
  const rawSize = Math.round(Number(record.size));
  return {
    q,
    sort,
    onlineOnly: record.onlineOnly === true,
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 500 ? rawPage : 1,
    size: Number.isInteger(rawSize) && rawSize >= 1 ? Math.min(rawSize, 50) : SHARED_SERVER_PAGE_SIZE,
  };
}

async function listServers(input: unknown) {
  const { q, sort, onlineOnly, page, size } = readListInput(input);
  const params = new URLSearchParams({
    sort,
    onlineOnly: String(onlineOnly),
    page: String(page),
    size: String(size),
  });
  if (q) params.set("q", q);
  const pathname = `${API_PATH}?${params.toString()}`;
  const lease = peekAssistantLease();
  let result = await httpJson(pathname, { token: lease?.token });
  if (lease && result.status === 401) {
    try {
      const next = await forceRefreshAssistantLease();
      result = await httpJson(pathname, { token: next.token });
    } catch {
      // Expired sessions still see the public list, just without details.
      result = await httpJson(pathname);
    }
  }
  if (!ok(result)) {
    throw describeSharedServerError(result.status, result.data, "读取共享服务器列表失败，请稍后再试。");
  }
  return parseSharedServerPage(result.data);
}

async function withAssistantAuth(
  run: (token: string) => Promise<RawResponse>,
  loginRequired: string,
): Promise<RawResponse> {
  const lease = await acquireAssistantLease(loginRequired);
  let result = await run(lease.token);
  if (result.status === 401) {
    const next = await forceRefreshAssistantLease(loginRequired);
    result = await run(next.token);
  }
  return result;
}

async function createServer(input: unknown) {
  const form = sanitizeSharedServerForm(input);
  const result = await withAssistantAuth(
    (token) =>
      httpJson(API_PATH, {
        method: "POST",
        token,
        body: form,
        timeoutMs: MANAGE_TIMEOUT_MS,
      }),
    PUBLISH_LOGIN_REQUIRED,
  );
  if (!ok(result)) {
    throw describeSharedServerError(result.status, result.data, "发布共享服务器失败，请稍后再试。");
  }
  const payload = recordOf(unwrapApiPayload(result.data));
  const server = parseSharedServerInfo(payload.server);
  const manageToken = textOf(payload.manageToken);
  if (!server || !manageToken) {
    throw new Error("若道服务返回的数据不完整，请稍后再试。");
  }
  rememberCreated(server, manageToken);
  return { server };
}

async function updateServer(input: unknown) {
  const id = readSharedServerId(input);
  const form = sanitizeSharedServerForm(input);
  const token = managedToken(id);
  const result = await withAssistantAuth(
    (authToken) =>
      httpJson(`${API_PATH}/${encodeURIComponent(id)}`, {
        method: "PUT",
        token: authToken,
        body: form,
        manageToken: token,
        timeoutMs: MANAGE_TIMEOUT_MS,
      }),
    MANAGE_LOGIN_REQUIRED,
  );
  if (!ok(result)) {
    throw describeSharedServerError(result.status, result.data, "更新共享服务器失败，请稍后再试。");
  }
  const server = parseSharedServerInfo(unwrapApiPayload(result.data));
  if (!server) throw new Error("若道服务返回的数据不完整，请稍后再试。");
  updateSnapshot(server.id, server);
  return { server };
}

async function removeServer(input: unknown) {
  const id = readSharedServerId(input);
  const token = managedToken(id);
  const result = await withAssistantAuth(
    (authToken) =>
      httpJson(`${API_PATH}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token: authToken,
        manageToken: token,
      }),
    MANAGE_LOGIN_REQUIRED,
  );
  if (!ok(result)) {
    const message = textOf(recordOf(result.data).message);
    if (/不存在或已删除/.test(message)) {
      forgetEntry(id);
      return { removed: true, alreadyGone: true };
    }
    throw describeSharedServerError(result.status, result.data, "下架共享服务器失败，请稍后再试。");
  }
  forgetEntry(id);
  return { removed: true, alreadyGone: false };
}

async function reportServer(input: unknown) {
  const { id, reason } = readReportInput(input);
  const result = await withAssistantAuth(
    (token) =>
      httpJson(`${API_PATH}/${encodeURIComponent(id)}/report`, {
        method: "POST",
        token,
        body: { reason },
      }),
    REPORT_LOGIN_REQUIRED,
  );
  if (!ok(result)) {
    throw describeSharedServerError(result.status, result.data, "报告失败，请稍后再试。");
  }
  const payload = recordOf(unwrapApiPayload(result.data));
  return { reported: true, hidden: payload.hidden === true };
}

async function mineServers() {
  if (!peekAssistantLease()) throw new Error(MANAGE_LOGIN_REQUIRED);
  const store = allEntries();
  return { entries: mineViews(store), refreshedAt: null as number | null };
}

async function refreshMine() {
  const lease = await acquireAssistantLease(MANAGE_LOGIN_REQUIRED);
  const store = allEntries();
  const targets = store.entries.filter((entry) => !entry.gone && decodeToken(entry.token));
  const errors = new Map<string, string>();
  if (targets.length > 0) {
    const queue = [...targets];
    const workers = Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const token = decodeToken(entry.token);
        if (!token) continue;
        try {
          const result = await httpJson(`${API_PATH}/${encodeURIComponent(entry.id)}`, {
            token: lease.token,
            manageToken: token,
          });
          if (ok(result)) {
            const server = parseSharedServerInfo(unwrapApiPayload(result.data));
            if (server) updateSnapshot(entry.id, server);
            continue;
          }
          if (result.status === 400 || result.status === 404) {
            const current = findEntry(entry.id);
            if (current) {
              current.entry.gone = true;
              current.entry.syncedAt = Date.now();
              persist(current.store);
            }
            continue;
          }
          errors.set(
            entry.id,
            describeSharedServerError(result.status, result.data, "刷新失败").message,
          );
        } catch (error) {
          errors.set(entry.id, error instanceof Error ? error.message : "刷新失败");
        }
      }
    });
    await Promise.all(workers);
  }
  return { entries: mineViews(allEntries(), errors), refreshedAt: Date.now() };
}

export function registerSharedServersIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("shared-servers:list", (_event, input: unknown) => listServers(input));
  ipcMain.handle("shared-servers:mine", () => mineServers());
  ipcMain.handle("shared-servers:refresh", () => refreshMine());
  ipcMain.handle("shared-servers:create", (_event, input: unknown) => createServer(input));
  ipcMain.handle("shared-servers:update", (_event, input: unknown) => updateServer(input));
  ipcMain.handle("shared-servers:remove", (_event, input: unknown) => removeServer(input));
  ipcMain.handle("shared-servers:report", (_event, input: unknown) => reportServer(input));
}
