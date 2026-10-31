import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLocalServerPort,
  loadLocalAdminSecret,
  publicSettings,
  saveLocalAdminSecret,
} from "./settings";

export interface LocalServerStatus {
  running: boolean;
  starting: boolean;
  port: number;
  url: string;
  publicUrl: string;
  lanUrls: string[];
  adminPasswordReady: boolean;
  startedAt: number | null;
  error: string | null;
  dataDir: string;
}

const START_TIMEOUT_MS = 20_000;
const HEALTH_INTERVAL_MS = 250;

let child: ChildProcess | null = null;
let starting = false;
let running = false;
let activePort: number | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let transientPassword: string | null = null;
let stopping = false;
let logTail: string[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server", "server.cjs")
    : path.join(app.getAppPath(), "resources", "server", "server.cjs");
}

function dataDir(): string {
  return path.join(app.getPath("userData"), "local-server");
}

function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function ensurePassword(): { password: string; persisted: boolean } {
  const stored = loadLocalAdminSecret();
  if (stored) return { password: stored, persisted: true };
  if (transientPassword) return { password: transientPassword, persisted: false };
  const password = randomBytes(18).toString("base64url");
  const saved = saveLocalAdminSecret(password);
  if (!saved.persisted) transientPassword = password;
  return { password, persisted: saved.persisted };
}

function tailLine(): string {
  for (let index = logTail.length - 1; index >= 0; index -= 1) {
    const line = logTail[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const message = typeof parsed.message === "string" ? parsed.message : "";
      if (message) return message;
      const event = typeof parsed.event === "string" ? parsed.event : "";
      if (event) return event;
    } catch {
      return line.slice(0, 160);
    }
  }
  return "";
}

function trackLog(chunk: Buffer | string): void {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    logTail.push(line);
    if (logTail.length > 30) logTail.shift();
  }
}

async function readHealth(port: number): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function localServerStatus(): LocalServerStatus {
  const port = activePort ?? getLocalServerPort();
  const settings = publicSettings();
  return {
    running,
    starting,
    port,
    url: `http://127.0.0.1:${port}`,
    publicUrl: settings.localServerPublicUrl,
    lanUrls: running ? lanUrls(port) : [],
    adminPasswordReady: Boolean(loadLocalAdminSecret() || transientPassword),
    startedAt,
    error: lastError,
    dataDir: dataDir(),
  };
}

export async function startLocalServer(): Promise<LocalServerStatus> {
  if (running || starting) return localServerStatus();
  lastError = null;
  const port = getLocalServerPort();
  activePort = port;

  const occupied = await readHealth(port);
  if (occupied) {
    lastError =
      occupied.name === "ruodao-remote-server"
        ? `端口 ${port} 上已有若道远程服务在运行，请在设置中更换端口后重试。`
        : `端口 ${port} 已被其他程序占用，请在设置中更换端口后重试。`;
    activePort = null;
    return localServerStatus();
  }

  const entry = serverEntry();
  if (!existsSync(entry)) {
    lastError = "缺少内置服务端文件，请重新安装客户端。";
    activePort = null;
    return localServerStatus();
  }

  const { password } = ensurePassword();
  const settings = publicSettings();
  logTail = [];
  starting = true;

  let spawned: ChildProcess;
  try {
    spawned = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        HOST: "0.0.0.0",
        DATA_DIR: dataDir(),
        ADMIN_PASSWORD: password,
        SERVER_NAME: `${os.hostname() || "我的电脑"} 的若道远程`,
        REGISTRATION_MODE: "open",
        PUBLIC_URL: settings.localServerPublicUrl,
        // 本机服务端随客户端一起升级，不允许它自行替换文件。
        UPDATE_ENABLED: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    starting = false;
    activePort = null;
    lastError = `无法启动本机服务端：${error instanceof Error ? error.message : String(error)}`;
    return localServerStatus();
  }

  child = spawned;
  spawned.stdout?.on("data", trackLog);
  spawned.stderr?.on("data", trackLog);
  spawned.once("error", (error) => {
    if (child !== spawned) return;
    starting = false;
    running = false;
    lastError = `无法启动本机服务端：${error.message}`;
  });
  spawned.once("exit", (code, signal) => {
    if (child === spawned) child = null;
    const wasAlive = running || starting;
    running = false;
    starting = false;
    startedAt = null;
    if (stopping) {
      stopping = false;
      return;
    }
    if (wasAlive) {
      const detail = tailLine();
      lastError = `本机服务端已退出（${signal ?? code ?? "未知原因"}）${
        detail ? `：${detail}` : ""
      }`;
    }
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(HEALTH_INTERVAL_MS);
    if (spawned.exitCode !== null) {
      starting = false;
      running = false;
      activePort = null;
      if (!lastError) {
        const detail = tailLine();
        lastError = `本机服务端启动失败${detail ? `：${detail}` : ""}`;
      }
      return localServerStatus();
    }
    const health = await readHealth(port);
    if (health?.name === "ruodao-remote-server") {
      starting = false;
      running = true;
      startedAt = Date.now();
      lastError = null;
      return localServerStatus();
    }
  }

  starting = false;
  running = false;
  lastError = "本机服务端启动超时，请检查端口是否被占用。";
  try {
    spawned.kill();
  } catch {
    // already gone
  }
  if (child === spawned) child = null;
  activePort = null;
  return localServerStatus();
}

export async function stopLocalServer(): Promise<LocalServerStatus> {
  const current = child;
  if (!current) {
    running = false;
    starting = false;
    startedAt = null;
    activePort = null;
    return localServerStatus();
  }
  stopping = true;
  running = false;
  starting = false;
  startedAt = null;
  try {
    current.kill();
  } catch {
    // already gone
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && current.exitCode === null) {
    await delay(100);
  }
  if (current.exitCode === null && current.pid) {
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/pid", String(current.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        // best effort
      }
    } else {
      try {
        current.kill("SIGKILL");
      } catch {
        // best effort
      }
    }
  }
  if (child === current) child = null;
  stopping = false;
  activePort = null;
  return localServerStatus();
}

export async function autoStartLocalServer(): Promise<void> {
  if (!publicSettings().localServerEnabled) return;
  await startLocalServer();
}

export function shutdownLocalServer(): void {
  const current = child;
  child = null;
  running = false;
  starting = false;
  startedAt = null;
  if (current) {
    try {
      current.kill();
    } catch {
      // already gone
    }
  }
}

export function revealLocalServerPassword(): { password: string; persisted: boolean } {
  const stored = loadLocalAdminSecret();
  const password = stored ?? transientPassword;
  if (!password) throw new Error("还没有启动过本机服务端。");
  return { password, persisted: Boolean(stored) };
}
