import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createServerUpdateService } from "./update";

const execFileAsync = promisify(execFile);

export type SelfUpdateStatus = "disabled" | "up-to-date" | "deferred" | "updated" | "failed";

export interface SelfUpdateResult {
  status: SelfUpdateStatus;
  currentVersion: string;
  targetVersion: string | null;
  message: string;
}

export interface SelfUpdateOptions {
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
  allowedHosts?: string[];
  requireIdle: boolean;
  healthUrl: string;
  healthToken?: string | null;
  restartTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  commandRunner?: (command: string, args: string[]) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, meta?: Record<string, unknown>) => void;
}

interface ServiceHealth {
  version: string | null;
  sessions: number | null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readHealth(options: SelfUpdateOptions): Promise<ServiceHealth | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.healthUrl, {
      method: "GET",
      headers: options.healthToken ? { "x-ruodao-health": options.healthToken } : undefined,
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return {
      version: typeof body.version === "string" ? body.version : null,
      sessions: typeof body.sessions === "number" ? body.sessions : null,
    };
  } catch {
    return null;
  }
}

async function waitForVersion(
  options: SelfUpdateOptions,
  expected: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const timeout = options.healthTimeoutMs ?? 45_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(1_500);
    const health = await readHealth(options);
    if (health?.version === expected) return true;
  }
  return false;
}

async function replaceEntryFile(entryFile: string, stagedFile: string): Promise<string | null> {
  const directory = path.dirname(entryFile);
  const backup = `${entryFile}.bak`;
  let backupCreated = false;
  try {
    await fsp.copyFile(entryFile, backup);
    await fsp.chmod(backup, 0o600);
    backupCreated = true;
  } catch {
    // 首次安装或文件不存在时没有可备份的旧文件。
  }
  const temporary = path.join(directory, `.${path.basename(entryFile)}.${process.pid}.new`);
  try {
    await fsp.copyFile(stagedFile, temporary);
    await fsp.chmod(temporary, 0o644);
    await fsp.rename(temporary, entryFile);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return backupCreated ? backup : null;
}

async function restoreEntryFile(entryFile: string, backup: string | null): Promise<void> {
  if (!backup) return;
  const temporary = path.join(path.dirname(entryFile), `.${path.basename(entryFile)}.restore`);
  await fsp.copyFile(backup, temporary);
  await fsp.chmod(temporary, 0o644);
  await fsp.rename(temporary, entryFile);
}

/**
 * 以 root 身份运行的一次性自更新：仅由 systemd timer 调用，不依赖正在运行的信令进程。
 * 有任何远控会话时延迟到下一次检查；替换后验证新版本健康状态，失败自动回滚。
 */
export async function runSelfUpdate(options: SelfUpdateOptions): Promise<SelfUpdateResult> {
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? defaultSleep;
  const fail = (message: string, targetVersion: string | null = null): SelfUpdateResult => {
    log("self-update.failed", { message, targetVersion });
    return { status: "failed", currentVersion: options.currentVersion, targetVersion, message };
  };

  if (!options.enabled) {
    return {
      status: "disabled",
      currentVersion: options.currentVersion,
      targetVersion: null,
      message: "服务端更新未启用。",
    };
  }

  log("self-update.started", { currentVersion: options.currentVersion });
  const service = createServerUpdateService({
    currentVersion: options.currentVersion,
    enabled: true,
    baseUrl: options.baseUrl,
    manifestPath: options.manifestPath,
    channel: options.channel,
    platform: options.platform,
    arch: options.arch,
    entryFile: options.entryFile,
    serviceName: options.serviceName,
    stageDir: options.stageDir,
    applyCommand: null,
    autoApply: false,
    systemUpdater: true,
    checkIntervalMs: 0,
    allowedHosts: options.allowedHosts,
    fetchImpl: options.fetchImpl,
    log,
  });

  let targetVersion: string | null = null;
  try {
    const checked = await service.check();
    if (checked.phase !== "available" || !checked.latest) {
      const message =
        checked.phase === "up-to-date"
          ? `当前 v${options.currentVersion} 已是最新版本。`
          : "没有可用的服务端更新。";
      log("self-update.up-to-date", { currentVersion: options.currentVersion });
      return {
        status: "up-to-date",
        currentVersion: options.currentVersion,
        targetVersion: null,
        message,
      };
    }
    targetVersion = checked.latest.version;

    if (options.requireIdle) {
      const health = await readHealth(options);
      if (health?.sessions && health.sessions > 0) {
        const message = `当前有 ${health.sessions} 个远控会话，更新已推迟到下一次检查。`;
        log("self-update.deferred", { sessions: health.sessions, targetVersion });
        return {
          status: "deferred",
          currentVersion: options.currentVersion,
          targetVersion,
          message,
        };
      }
      if (!health) log("self-update.health-unavailable", { phase: "before-download" });
    }

    const downloaded = await service.download();
    const staged = downloaded.staged;
    if (!staged) return fail("更新包下载后未找到暂存文件。", targetVersion);

    if (options.requireIdle) {
      const health = await readHealth(options);
      if (health?.sessions && health.sessions > 0) {
        const message = `更新包已校验，但当前有 ${health.sessions} 个远控会话，安装已推迟。`;
        log("self-update.deferred", { sessions: health.sessions, targetVersion, phase: "before-install" });
        return {
          status: "deferred",
          currentVersion: options.currentVersion,
          targetVersion,
          message,
        };
      }
    }

    log("self-update.installing", { from: options.currentVersion, to: targetVersion });
    const backup = await replaceEntryFile(options.entryFile, staged.path);
    const runner =
      options.commandRunner ??
      (async (command: string, args: string[]) => {
        await execFileAsync(command, args, { timeout: options.restartTimeoutMs ?? 120_000 });
      });
    try {
      await runner("systemctl", ["restart", options.serviceName]);
      if (!(await waitForVersion(options, targetVersion, sleep))) {
        throw new Error(`服务重启后未报告新版本 v${targetVersion}`);
      }
      await fsp.rm(staged.path, { force: true }).catch(() => {});
      const message = `服务端已从 v${options.currentVersion} 更新到 v${targetVersion}。`;
      log("self-update.updated", { from: options.currentVersion, to: targetVersion });
      return {
        status: "updated",
        currentVersion: options.currentVersion,
        targetVersion,
        message,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log("self-update.rollback", { targetVersion, reason, hasBackup: Boolean(backup) });
      try {
        await restoreEntryFile(options.entryFile, backup);
        await runner("systemctl", ["restart", options.serviceName]);
        await waitForVersion(options, options.currentVersion, sleep);
        return fail(`${reason}；已回滚到 v${options.currentVersion}。`, targetVersion);
      } catch (rollbackError) {
        const detail =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        return fail(`${reason}；回滚失败：${detail}，请手动检查服务端。`, targetVersion);
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), targetVersion);
  }
}
