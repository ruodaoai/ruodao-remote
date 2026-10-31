import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { publicSettings, updateSettings } from "./settings";
import {
  CLIENT_PRODUCT,
  allowedDownloadHosts,
  buildManifestUrl,
  isAllowedDownloadUrl,
  isNewerVersion,
  normalizeUpdateBaseUrl,
  parseReleasePayload,
  selectUpdateAsset,
  type UpdateAsset,
  type UpdateRelease,
} from "./update-protocol";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdateReleaseSummary {
  version: string;
  notes: string;
  publishedAt: string | null;
  mandatory: boolean;
  size: number | null;
  assetName: string;
  kind: string;
}

export interface UpdateStatus {
  supported: boolean;
  reason: string | null;
  phase: UpdatePhase;
  currentVersion: string;
  autoUpdate: boolean;
  lastCheckedAt: number | null;
  release: UpdateReleaseSummary | null;
  progress: { received: number; total: number; percent: number } | null;
  error: string | null;
  portable: boolean;
  readyToInstall: boolean;
  updateBaseUrl: string;
}

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 400 * 1024 * 1024;
const DEFAULT_INTERVAL_HOURS = 6;
const STARTUP_DELAY_MS = 12_000;
const PROGRESS_INTERVAL_MS = 250;

let status: UpdateStatus = {
  supported: false,
  reason: null,
  phase: "idle",
  currentVersion: "0.0.0",
  autoUpdate: true,
  lastCheckedAt: null,
  release: null,
  progress: null,
  error: null,
  portable: false,
  readyToInstall: false,
  updateBaseUrl: "",
};

let stagedFile: string | null = null;
let stagedRelease: UpdateRelease | null = null;
let installSpawned = false;
let started = false;
let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let activeDownload: AbortController | null = null;
let lastProgressAt = 0;

function updateBaseUrl(): string {
  return normalizeUpdateBaseUrl(
    process.env.RUODAO_UPDATE_BASE_URL?.trim() ||
      process.env.RUODAO_API_BASE_URL?.trim() ||
      (process.env.RUODAO_LOCAL_TEST === "1" ? "http://127.0.0.1:8080" : undefined),
  );
}

function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

function isSupported(): boolean {
  if (process.platform !== "win32") return false;
  return app.isPackaged || process.env.RUODAO_UPDATE_FORCE === "1";
}

function downloadHosts(): string[] {
  return allowedDownloadHosts(
    updateBaseUrl(),
    (process.env.RUODAO_UPDATE_HOSTS ?? "").split(",").filter(Boolean),
  );
}

function emit(): void {
  const snapshot = { ...status };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update:event", snapshot);
  }
}

function patch(next: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...next };
  emit();
  return { ...status };
}

function friendlyError(error: unknown): string {
  if (!(error instanceof Error)) return "更新失败，请稍后再试。";
  const message = error.message || "";
  if (/timed? ?out|ETIMEDOUT|aborted/i.test(message)) return "连接更新服务超时，请检查网络后重试。";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return "无法连接更新服务，请检查网络或代理设置。";
  }
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "") || "更新失败，请稍后再试。";
}

function releaseSummary(release: UpdateRelease, asset: UpdateAsset): UpdateReleaseSummary {
  return {
    version: release.version,
    notes: release.notes,
    publishedAt: release.publishedAt,
    mandatory: release.mandatory,
    size: asset.size,
    assetName: asset.name,
    kind: asset.kind,
  };
}

async function fetchLatest(): Promise<{ release: UpdateRelease; asset: UpdateAsset }> {
  const baseUrl = updateBaseUrl();
  const url = buildManifestUrl(
    baseUrl,
    {
      product: CLIENT_PRODUCT,
      channel: process.env.RUODAO_UPDATE_CHANNEL?.trim() || "stable",
      platform: process.platform,
      arch: process.arch,
      currentVersion: status.currentVersion,
    },
    process.env.RUODAO_UPDATE_PATH?.trim(),
  );
  const response = await net.fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-ruodao-client": "desktop",
      "x-ruodao-product": CLIENT_PRODUCT,
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`更新接口返回 HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("更新接口返回的不是有效 JSON");
  }
  const release = parseReleasePayload(payload, {
    product: CLIENT_PRODUCT,
    channel: process.env.RUODAO_UPDATE_CHANNEL?.trim() || "stable",
    baseUrl,
  });
  if (!release) throw new Error("更新接口没有返回版本信息");
  const asset = selectUpdateAsset(release, {
    platform: process.platform,
    arch: process.arch,
    kinds: ["nsis", "exe", "msi", "zip"],
  });
  if (!asset) throw new Error("没有找到适用于当前系统的安装包");
  if (!isAllowedDownloadUrl(asset.url, downloadHosts(), baseUrl.startsWith("http://"))) {
    throw new Error("安装包地址不在允许的下载源内，已拒绝下载");
  }
  return { release, asset };
}

function safeFileName(name: string, version: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
  const suffix = base || "update.exe";
  return `${version.replace(/[^A-Za-z0-9._-]/g, "_")}-${suffix}`;
}

async function downloadAsset(release: UpdateRelease, asset: UpdateAsset): Promise<string> {
  if (!asset.sha256) throw new Error("更新包缺少 SHA-256 校验值，已拒绝下载");
  const total = asset.size ?? 0;
  if (total > MAX_DOWNLOAD_BYTES) throw new Error("更新包体积异常，已拒绝下载");

  const directory = path.join(app.getPath("userData"), "updates", release.version);
  await fsp.mkdir(directory, { recursive: true });
  const target = path.join(directory, safeFileName(asset.name, release.version));
  const partial = `${target}.part`;
  await fsp.rm(partial, { force: true }).catch(() => {});

  const controller = new AbortController();
  activeDownload = controller;
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const handle = await fsp.open(partial, "w");
  const hash = createHash("sha256");
  let received = 0;
  let lastReported = 0;

  try {
    const response = await net.fetch(asset.url, {
      method: "GET",
      headers: { accept: "application/octet-stream" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    const expected = total || (Number.isFinite(declared) ? declared : 0);
    if (expected > MAX_DOWNLOAD_BYTES) throw new Error("更新包体积异常，已取消下载");
    if (!response.body) throw new Error("下载更新包失败：响应为空");

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("更新包超过大小上限，已取消下载");
      }
      hash.update(value);
      await handle.write(value);
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        lastReported = received;
        patch({
          phase: "downloading",
          progress: {
            received,
            total: expected,
            percent: expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0,
          },
        });
      }
    }
    if (total > 0 && received !== total) {
      throw new Error(`更新包大小不一致（期望 ${total} 字节，实际 ${received} 字节）`);
    }
    if (lastReported !== received) {
      patch({
        phase: "downloading",
        progress: {
          received,
          total: expected,
          percent: expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 100,
        },
      });
    }
    await handle.close();
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) {
      throw new Error("更新包校验失败，文件可能被篡改或下载不完整");
    }
    await fsp.rm(target, { force: true }).catch(() => {});
    await fsp.rename(partial, target);
    return target;
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    activeDownload = null;
  }
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!status.supported) return { ...status };
  if (status.phase === "downloading") return { ...status };
  if (!status.release) throw new Error("当前没有可下载的新版本");
  if (status.readyToInstall && stagedFile) return { ...status };
  const release = stagedRelease;
  if (!release) throw new Error("更新信息已过期，请重新检查更新");
  const asset = selectUpdateAsset(release, {
    platform: process.platform,
    arch: process.arch,
    kinds: ["nsis", "exe", "msi", "zip"],
  });
  if (!asset) throw new Error("没有找到适用于当前系统的安装包");
  patch({ phase: "downloading", error: null, progress: { received: 0, total: asset.size ?? 0, percent: 0 } });
  try {
    const file = await downloadAsset(release, asset);
    stagedFile = file;
    return patch({
      phase: "ready",
      progress: { received: asset.size ?? 0, total: asset.size ?? 0, percent: 100 },
      readyToInstall: true,
    });
  } catch (error) {
    stagedFile = null;
    return patch({ phase: "error", error: friendlyError(error), progress: null, readyToInstall: false });
  }
}

export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!status.supported) {
    if (manual) throw new Error(status.reason ?? "当前环境不支持自动更新");
    return { ...status };
  }
  if (status.phase === "downloading" || status.phase === "installing") return { ...status };
  if (status.phase === "checking") return { ...status };

  patch({ phase: "checking", error: null });
  try {
    const { release, asset } = await fetchLatest();
    const sameStaged =
      Boolean(stagedFile) &&
      existsSync(stagedFile as string) &&
      stagedRelease?.version === release.version;
    if (!sameStaged) {
      stagedFile = null;
      installSpawned = false;
    }
    stagedRelease = release;
    if (isNewerVersion(release.version, status.currentVersion)) {
      patch({
        phase: sameStaged ? "ready" : "available",
        release: releaseSummary(release, asset),
        progress: sameStaged
          ? { received: asset.size ?? 0, total: asset.size ?? 0, percent: 100 }
          : null,
        readyToInstall: sameStaged,
        lastCheckedAt: Date.now(),
      });
      if (!sameStaged && publicSettings().autoUpdate) await downloadUpdate();
      return { ...status };
    }
    return patch({
      phase: "up-to-date",
      release: null,
      progress: null,
      readyToInstall: false,
      lastCheckedAt: Date.now(),
    });
  } catch (error) {
    return patch({
      phase: "error",
      error: friendlyError(error),
      progress: null,
      lastCheckedAt: Date.now(),
    });
  }
}

function spawnInstaller(file: string, forceRun: boolean): boolean {
  if (installSpawned) return false;
  if (path.extname(file).toLowerCase() !== ".exe") return false;
  try {
    // electron-builder 的 NSIS 安装器识别 --updated / /S / --force-run：静默覆盖安装。
    const args = ["--updated", "/S"];
    if (forceRun) args.push("--force-run");
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    installSpawned = true;
    return true;
  } catch {
    return false;
  }
}

export async function installUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!stagedFile) return { ok: false, error: "还没有下载好的更新包。" };
  if (isPortable()) {
    shell.showItemInFolder(stagedFile);
    return {
      ok: false,
      error: "便携版无法自动覆盖正在运行的程序，已打开更新包所在目录，请退出后手动替换。",
    };
  }
  patch({ phase: "installing", error: null });
  if (!spawnInstaller(stagedFile, true)) {
    patch({ phase: "ready", error: "无法启动安装程序，请稍后重试。" });
    return { ok: false, error: "无法启动安装程序，请稍后重试。" };
  }
  setTimeout(() => app.quit(), 1200);
  return { ok: true };
}

/** 自动更新的收尾：下载完成后在退出时静默安装。 */
export function installOnQuit(): void {
  if (status.phase === "ready" && stagedFile && publicSettings().autoUpdate) {
    spawnInstaller(stagedFile, false);
  }
}

export function updaterStatus(): UpdateStatus {
  return { ...status };
}

export function setUpdaterAutoUpdate(enabled: boolean): UpdateStatus {
  updateSettings({ autoUpdate: enabled });
  patch({ autoUpdate: enabled });
  if (enabled && status.phase === "available") {
    void downloadUpdate();
  }
  return { ...status };
}

function registerIpc(): void {
  ipcMain.handle("update:status", () => updaterStatus());
  ipcMain.handle("update:check", () => checkForUpdates(true));
  ipcMain.handle("update:download", () => downloadUpdate());
  ipcMain.handle("update:install", () => installUpdate());
  ipcMain.handle("update:set-auto", (_event, value: unknown) => setUpdaterAutoUpdate(value === true));
  ipcMain.handle("update:open-folder", () => {
    if (!stagedFile) return false;
    shell.showItemInFolder(stagedFile);
    return true;
  });
}

export function initializeUpdater(): void {
  if (started) return;
  started = true;
  registerIpc();

  status.currentVersion = app.getVersion();
  status.autoUpdate = publicSettings().autoUpdate;
  status.portable = isPortable();
  status.updateBaseUrl = updateBaseUrl();

  if (!isSupported()) {
    status.supported = false;
    status.reason =
      process.platform !== "win32"
        ? "当前系统暂不支持客户端自动更新。"
        : "开发模式下不检查更新，打包后会按更新源自动检查。";
    return;
  }
  status.supported = true;

  const hours = Number(process.env.RUODAO_UPDATE_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  const intervalMs =
    (Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
  startupTimer = setTimeout(() => {
    void checkForUpdates(false);
  }, STARTUP_DELAY_MS);
  startupTimer.unref();
  intervalTimer = setInterval(() => {
    void checkForUpdates(false);
  }, intervalMs);
  intervalTimer.unref();
}

export function shutdownUpdater(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
  activeDownload?.abort();
  activeDownload = null;
}
