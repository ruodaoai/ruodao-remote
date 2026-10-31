import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  allowedDownloadHosts,
  buildManifestUrl,
  isAllowedDownloadUrl,
  isNewerVersion,
  parseReleasePayload,
  selectUpdateAsset,
  SERVER_PRODUCT,
  type UpdateAsset,
  type UpdateRelease,
} from "./update-manifest";

export type ServerUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "applying"
  | "up-to-date"
  | "error";

export interface ServerUpdateStatus {
  supported: boolean;
  enabled: boolean;
  reason: string | null;
  currentVersion: string;
  channel: string;
  phase: ServerUpdatePhase;
  latest: {
    version: string;
    notes: string;
    publishedAt: string | null;
    mandatory: boolean;
    size: number | null;
    assetName: string;
    kind: string;
  } | null;
  staged: { version: string; path: string; size: number | null; sha256: string } | null;
  lastCheckedAt: number | null;
  autoApply: boolean;
  applyMode: "auto" | "manual" | "system";
  systemUpdater: boolean;
  manualCommand: string | null;
  error: string | null;
}

export interface ServerUpdateOptions {
  currentVersion: string;
  enabled: boolean;
  baseUrl: string;
  manifestPath?: string;
  channel: string;
  platform: string;
  arch: string;
  entryFile: string;
  serviceName: string;
  stageDir: string;
  applyCommand: string | null;
  autoApply: boolean;
  systemUpdater?: boolean;
  checkIntervalMs: number;
  allowedHosts?: string[];
  fetchImpl?: typeof fetch;
  canApply?: () => boolean;
  log?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface ServerUpdateApplyResult {
  ok: boolean;
  mode: "auto" | "manual";
  command: string | null;
  message: string;
}

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const SERVER_ASSET_KINDS = ["server-cjs"];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function friendlyError(error: unknown): string {
  if (!(error instanceof Error)) return "更新失败，请稍后再试。";
  const message = error.message || "";
  if (/timeout|aborted|ETIMEDOUT/i.test(message)) return "连接更新服务超时，请检查服务器网络后重试。";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return "无法连接更新服务，请检查服务器网络或代理设置。";
  }
  return message || "更新失败，请稍后再试。";
}

export class ServerUpdateService {
  private readonly options: ServerUpdateOptions;
  private phase: ServerUpdatePhase = "idle";
  private latest: { release: UpdateRelease; asset: UpdateAsset } | null = null;
  private staged: { version: string; path: string; size: number | null; sha256: string } | null = null;
  private lastCheckedAt: number | null = null;
  private error: string | null = null;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;

  constructor(options: ServerUpdateOptions) {
    this.options = options;
    if (!options.enabled) this.phase = "idle";
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  start(): void {
    if (!this.options.enabled || this.options.checkIntervalMs <= 0) return;
    if (this.timer) return;
    // 启动后稍等片刻再检查，避免与进程启动、健康检查争抢资源。
    this.initialTimer = setTimeout(() => {
      void this.autoCheck();
    }, Math.min(30_000, this.options.checkIntervalMs));
    this.initialTimer.unref();
    this.timer = setInterval(() => {
      void this.autoCheck();
    }, this.options.checkIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  private log(event: string, meta?: Record<string, unknown>): void {
    this.options.log?.(event, meta);
  }

  private baseUrl(): string {
    return this.options.baseUrl;
  }

  private hosts(): string[] {
    return allowedDownloadHosts(this.baseUrl(), this.options.allowedHosts ?? []);
  }

  private allowHttp(): boolean {
    return this.baseUrl().startsWith("http://");
  }

  manualCommand(): string | null {
    if (!this.staged) return null;
    return [
      `sudo install -o root -g root -m 0644 ${shellQuote(this.staged.path)} ${shellQuote(this.options.entryFile)}`,
      `sudo systemctl restart ${shellQuote(this.options.serviceName)}`,
    ].join(" && ");
  }

  status(): ServerUpdateStatus {
    const latest = this.latest;
    return {
      supported: this.options.enabled,
      enabled: this.options.enabled,
      reason: this.options.enabled ? null : "当前部署未启用服务端更新。",
      currentVersion: this.options.currentVersion,
      channel: this.options.channel,
      phase: this.phase,
      latest: latest
        ? {
            version: latest.release.version,
            notes: latest.release.notes,
            publishedAt: latest.release.publishedAt,
            mandatory: latest.release.mandatory,
            size: latest.asset.size,
            assetName: latest.asset.name,
            kind: latest.asset.kind,
          }
        : null,
      staged: this.staged ? { ...this.staged } : null,
      lastCheckedAt: this.lastCheckedAt,
      autoApply: this.options.autoApply,
      applyMode: this.options.applyCommand
        ? "auto"
        : this.options.systemUpdater
          ? "system"
          : "manual",
      systemUpdater: this.options.systemUpdater === true,
      manualCommand: this.manualCommand(),
      error: this.error,
    };
  }

  async check(): Promise<ServerUpdateStatus> {
    if (!this.options.enabled) {
      throw new Error(this.status().reason ?? "服务端更新未启用");
    }
    if (this.busy) throw new Error("更新任务正在进行中，请稍后再试。");
    this.busy = true;
    this.phase = "checking";
    this.error = null;
    try {
      const url = buildManifestUrl(
        this.baseUrl(),
        {
          product: SERVER_PRODUCT,
          channel: this.options.channel,
          platform: this.options.platform,
          arch: this.options.arch,
          currentVersion: this.options.currentVersion,
        },
        this.options.manifestPath,
      );
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-ruodao-client": "server",
          "x-ruodao-product": SERVER_PRODUCT,
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
        channel: this.options.channel,
        baseUrl: this.baseUrl(),
      });
      if (!release) throw new Error("更新接口没有返回版本信息");
      const asset = selectUpdateAsset(release, {
        platform: this.options.platform,
        arch: this.options.arch,
        kinds: SERVER_ASSET_KINDS,
      });
      if (!asset) throw new Error("没有可用的服务端单文件更新包（server-cjs）");
      if (!isAllowedDownloadUrl(asset.url, this.hosts(), this.allowHttp())) {
        throw new Error("更新包地址不在允许的下载源内，已拒绝下载");
      }
      this.latest = { release, asset };
      this.staged = null;
      const available = isNewerVersion(release.version, this.options.currentVersion);
      this.phase = available ? "available" : "up-to-date";
      this.log("update.checked", {
        current: this.options.currentVersion,
        latest: release.version,
        available,
      });
      return this.status();
    } catch (error) {
      this.phase = "error";
      this.error = friendlyError(error);
      this.log("update.check-failed", { message: this.error });
      throw new Error(this.error);
    } finally {
      this.busy = false;
      this.lastCheckedAt = Date.now();
    }
  }

  async download(): Promise<ServerUpdateStatus> {
    if (!this.options.enabled) throw new Error(this.status().reason ?? "服务端更新未启用");
    if (this.busy) throw new Error("更新任务正在进行中，请稍后再试。");
    if (!this.latest) throw new Error("请先检查更新");
    const { release, asset } = this.latest;
    if (!asset.sha256) throw new Error("更新包缺少 SHA-256 校验值，已拒绝下载");
    if (asset.size !== null && asset.size > MAX_DOWNLOAD_BYTES) {
      throw new Error("更新包体积异常，已拒绝下载");
    }
    if (this.staged && this.staged.sha256 === asset.sha256 && this.staged.version === release.version) {
      this.phase = "ready";
      return this.status();
    }

    this.busy = true;
    this.phase = "downloading";
    this.error = null;
    const extension = asset.name.toLowerCase().endsWith(".js") ? ".js" : ".cjs";
    const target = path.join(
      this.options.stageDir,
      `server-${release.version.replace(/[^0-9A-Za-z._-]/g, "_")}${extension}`,
    );
    const partial = `${target}.part`;
    let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
    try {
      await fsp.mkdir(this.options.stageDir, { recursive: true, mode: 0o700 });
      await fsp.rm(partial, { force: true }).catch(() => {});
      handle = await fsp.open(partial, "w", 0o600);
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(asset.url, {
        method: "GET",
        headers: { accept: "application/octet-stream" },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`);
      if (!response.body) throw new Error("下载更新包失败：响应为空");
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let received = 0;
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
      }
      await handle.close();
      handle = null;
      if (asset.size !== null && received !== asset.size) {
        throw new Error(`更新包大小不一致（期望 ${asset.size} 字节，实际 ${received} 字节）`);
      }
      const digest = hash.digest("hex");
      if (digest !== asset.sha256) throw new Error("更新包校验失败，文件可能被篡改或下载不完整");
      await fsp.rm(target, { force: true }).catch(() => {});
      await fsp.rename(partial, target);
      this.staged = {
        version: release.version,
        path: target,
        size: received,
        sha256: digest,
      };
      this.phase = "ready";
      this.log("update.downloaded", { version: release.version, path: target, size: received });
      return this.status();
    } catch (error) {
      await handle?.close().catch(() => {});
      await fsp.rm(partial, { force: true }).catch(() => {});
      this.phase = "error";
      this.error = friendlyError(error);
      this.log("update.download-failed", { message: this.error });
      throw new Error(this.error);
    } finally {
      this.busy = false;
    }
  }

  async apply(): Promise<ServerUpdateApplyResult> {
    if (!this.options.enabled) throw new Error(this.status().reason ?? "服务端更新未启用");
    if (!this.staged) throw new Error("请先下载并校验更新包");
    const command = this.options.applyCommand;
    if (!command) {
      this.phase = "ready";
      return {
        ok: true,
        mode: "manual",
        command: this.manualCommand(),
        message: this.options.systemUpdater
          ? "更新包已校验并暂存，系统更新服务会在无远控会话时自动安装；也可执行下方命令立即更新。"
          : "更新包已校验并暂存，请用服务器管理员权限执行命令完成替换与重启。",
      };
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      RUODAO_UPDATE_FILE: this.staged.path,
      RUODAO_UPDATE_SHA256: this.staged.sha256,
      RUODAO_UPDATE_VERSION: this.staged.version,
      RUODAO_UPDATE_ENTRY: this.options.entryFile,
      RUODAO_UPDATE_SERVICE: this.options.serviceName,
    };
    const child = spawn(command, {
      shell: true,
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    this.phase = "applying";
    this.log("update.apply-started", { version: this.staged.version, command });
    return {
      ok: true,
      mode: "auto",
      command,
      message: "已交给更新助手执行，服务会在几秒内替换文件并重启。",
    };
  }

  private async autoCheck(): Promise<void> {
    if (!this.options.enabled || this.busy) return;
    try {
      await this.check();
      if (this.phase !== "available" || !this.options.autoApply) return;
      if (this.options.canApply && !this.options.canApply()) {
        this.log("update.deferred", { reason: "active-sessions" });
        return;
      }
      await this.download();
      if (this.status().phase === "ready") await this.apply();
    } catch (error) {
      this.log("update.auto-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createServerUpdateService(options: ServerUpdateOptions): ServerUpdateService {
  return new ServerUpdateService(options);
}
