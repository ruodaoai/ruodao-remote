import { app } from "electron";
import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { saveAdminSecret, updateSettings } from "../settings";
import {
  buildCaddyfile,
  buildTurnserverConf,
  formatEntryUrl,
  needsGlibc217Node,
  nodeTarball,
  parsePortList,
  planDeployPorts,
  sslipHostname,
  type DeployPortPlan,
} from "./plan";
import {
  fingerprintDisplay,
  HostKeyMismatchError,
  probeHostKey,
  SshSession,
  type ExecResult,
  type SshTarget,
} from "./ssh";

export type DeployRegistrationMode = "invite" | "approval" | "open";
export type DeployStepId =
  | "connect"
  | "inspect"
  | "packages"
  | "turn"
  | "server"
  | "updates"
  | "proxy"
  | "firewall"
  | "defense"
  | "verify"
  | "finish";
export type DeployStepStatus = "pending" | "running" | "success" | "error" | "skipped";

export interface DeployConfig {
  host: string;
  sshPort: number;
  username: string;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  domain: string;
  registrationMode: DeployRegistrationMode;
  installTurn: boolean;
}

export interface DeployStep {
  id: DeployStepId;
  title: string;
  detail: string;
  status: DeployStepStatus;
  note: string;
}

export interface DeployResult {
  serverUrl: string;
  host: string;
  domain: string;
  adminPassword: string;
  adminPersisted: boolean;
  secure: boolean;
  turn: boolean;
  version: string;
  reusedPassword: boolean;
  inviteCode: string;
  registrationMode: DeployRegistrationMode;
  publicPort: number;
  redirectPort: number;
  internalPort: number;
  turnPort: number;
  relayMin: number;
  relayMax: number;
  adminPath: string;
}

export type DeployEvent =
  | { type: "step"; step: DeployStep }
  | { type: "log"; line: string; stream: "stdout" | "stderr" }
  | {
      type: "host-key";
      prompt: { host: string; port: number; fingerprint: string; previous: string | null };
    }
  | { type: "done"; result: DeployResult }
  | { type: "error"; message: string; step: DeployStepId | null; log: string[] }
  | { type: "cancelled" };

interface KnownHost {
  hex: string;
  display: string;
  addedAt: number;
}

const SERVICE = "ruodao-remote";
const ENV_FILE = "/etc/ruodao-remote.env";
const SERVER_DIR = "/opt/ruodao";
const DATA_DIR = "/var/lib/ruodao";
const UNIT_FILE = "/etc/systemd/system/ruodao-remote.service";
const UPDATE_UNIT = "/etc/systemd/system/ruodao-remote-update.service";
const UPDATE_TIMER = "/etc/systemd/system/ruodao-remote-update.timer";
const CADDY_DIR = "/etc/ruodao";
const CADDYFILE = `${CADDY_DIR}/Caddyfile`;
const CADDY_UNIT = "/etc/systemd/system/ruodao-caddy.service";
const CADDY_DATA_DIR = "/var/lib/ruodao-caddy";
const LEGACY_CADDYFILE = "/etc/caddy/Caddyfile";
const TURN_CONF = "/etc/turnserver.conf";
const SECURITY_LOG = `${DATA_DIR}/security.log`;
const SYSCTL_FILE = "/etc/sysctl.d/99-ruodao-remote.conf";
const FAIL2BAN_FILTER = "/etc/fail2ban/filter.d/ruodao-security.conf";
const FAIL2BAN_JAIL = "/etc/fail2ban/jail.d/ruodao-security.local";
const NODE_FALLBACK = "v22.11.0";
const NODE_COMPAT_FALLBACK = "v22.11.0";
const NODE_UNOFFICIAL_INDEX =
  "https://unofficial-builds.nodejs.org/download/release/index.json";

const STEP_LIST: { id: DeployStepId; title: string; detail: string }[] = [
  { id: "connect", title: "连接服务器", detail: "验证 SSH 指纹并使用账号登录" },
  { id: "inspect", title: "检查系统环境", detail: "确认发行版、磁盘，并规划不冲突的端口" },
  { id: "packages", title: "安装运行环境", detail: "准备 Node.js 与独立的 Caddy 入口" },
  { id: "turn", title: "配置 TURN 中转", detail: "为复杂网络准备音视频中继" },
  { id: "server", title: "部署信令服务", detail: "上传服务端并注册 systemd 服务" },
  { id: "updates", title: "启用自动更新", detail: "安装系统级更新检查，空闲时自动安装新版本" },
  { id: "proxy", title: "配置网站入口", detail: "由独立 Caddy 反向代理并自动申请 HTTPS" },
  { id: "firewall", title: "放行防火墙端口", detail: "只放行本次实际使用的端口" },
  { id: "defense", title: "加固入侵防护", detail: "启用 fail2ban、SSH 限速与内核防护" },
  { id: "verify", title: "验证公网访问", detail: "检查健康接口与管理员登录" },
  { id: "finish", title: "保存配置", detail: "把服务器地址与管理员密码写入本机" },
];

let activeRun: DeployRun | null = null;
let cachedNodeVersion: string | null = null;
let cachedCompatNodeVersion: string | null = null;

class CancelledError extends Error {
  constructor() {
    super("部署已取消");
    this.name = "CancelledError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function isPrivateIp(value: string): boolean {
  if (!isIp(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
}

function validateHost(value: string): string {
  const host = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!host) throw new Error("请填写服务器 IP 或域名。");
  if (host.length > 253 || !/^[A-Za-z0-9.:_-]+$/.test(host)) {
    throw new Error("服务器地址格式不正确，请填写 IPv4 地址或域名。");
  }
  return host;
}

function validateDomain(value: string): string {
  const raw = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!raw) return "";
  if (raw.length > 253 || !/^[A-Za-z0-9.-]+$/.test(raw) || !raw.includes(".")) {
    throw new Error("域名格式不正确，例如 remote.example.com。");
  }
  if (isIp(raw)) throw new Error("这里填写域名（如 remote.example.com），服务器 IP 请填在上方。");
  return raw.toLowerCase();
}

function adminApiPath(page: string): string {
  return page === "/admin" ? "/api/admin" : `${page}/api`;
}

function isCustomAdminPath(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/admin") return false;
  return /^\/[A-Za-z0-9][A-Za-z0-9._~-]{5,63}$/.test(trimmed);
}

function newAdminPath(): string {
  return `/manage-${randomBytes(6).toString("hex")}`;
}

function activeHealthToken(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(trimmed) ? trimmed : "";
}

function parseConfig(input: unknown): DeployConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("部署参数不合法。");
  }
  const raw = input as Record<string, unknown>;
  const host = validateHost(typeof raw.host === "string" ? raw.host : "");
  const sshPortRaw = Number(raw.sshPort ?? 22);
  if (!Number.isFinite(sshPortRaw) || sshPortRaw < 1 || sshPortRaw > 65535) {
    throw new Error("SSH 端口需要在 1 到 65535 之间。");
  }
  const username = (typeof raw.username === "string" ? raw.username.trim() : "") || "root";
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) {
    throw new Error("SSH 用户名格式不正确。");
  }
  const password = typeof raw.password === "string" ? raw.password : "";
  const privateKeyPath = typeof raw.privateKeyPath === "string" ? raw.privateKeyPath.trim() : "";
  const passphrase = typeof raw.passphrase === "string" ? raw.passphrase : "";
  if (!password && !privateKeyPath) throw new Error("请填写 SSH 密码，或选择 SSH 私钥。");
  const domain = validateDomain(typeof raw.domain === "string" ? raw.domain : "");
  const mode = raw.registrationMode;
  const registrationMode: DeployRegistrationMode =
    mode === "approval" || mode === "open" ? mode : "invite";
  return {
    host,
    sshPort: Math.floor(sshPortRaw),
    username,
    password,
    privateKeyPath,
    passphrase,
    domain,
    registrationMode,
    installTurn: raw.installTurn !== false,
  };
}

function knownHostsPath(): string {
  return path.join(app.getPath("userData"), "known-hosts.json");
}

function readKnownHosts(): Record<string, KnownHost> {
  try {
    const raw = JSON.parse(readFileSync(knownHostsPath(), "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return {};
    const result: Record<string, KnownHost> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const record = value as Partial<KnownHost>;
      if (typeof record?.hex === "string" && record.hex) {
        result[key] = {
          hex: record.hex,
          display: typeof record.display === "string" ? record.display : fingerprintDisplay(record.hex),
          addedAt: Number(record.addedAt) || 0,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveKnownHost(host: string, port: number, hex: string): void {
  const data = readKnownHosts();
  data[`${host}:${port}`] = { hex, display: fingerprintDisplay(hex), addedAt: Date.now() };
  const file = knownHostsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function forgetDeployHost(input: unknown): { ok: true } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  const port = Number(raw.port) || 22;
  if (!host) return { ok: true };
  const data = readKnownHosts();
  delete data[`${host}:${port}`];
  writeFileSync(knownHostsPath(), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return { ok: true };
}

function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[line.slice(0, index).trim()] = value;
  }
  return result;
}

function parseKeyValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function unitQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function systemdEnvLine(key: string, value: string): string {
  return `${key}=${unitQuote(value)}`;
}

async function resolveNodeVersion(arch: string): Promise<string> {
  if (cachedNodeVersion) return cachedNodeVersion;
  try {
    const response = await fetch("https://nodejs.org/dist/index.json", {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = (await response.json()) as Array<{ version?: string; lts?: unknown; files?: string[] }>;
      const match = data.find(
        (item) =>
          typeof item.version === "string" &&
          Boolean(item.lts) &&
          Array.isArray(item.files) &&
          item.files.includes(`linux-${arch}`),
      );
      if (match?.version) {
        cachedNodeVersion = match.version;
        return match.version;
      }
    }
  } catch {
    // fall through to pinned LTS
  }
  cachedNodeVersion = NODE_FALLBACK;
  return NODE_FALLBACK;
}

async function resolveCompatNodeVersion(): Promise<string> {
  if (cachedCompatNodeVersion) return cachedCompatNodeVersion;
  try {
    const response = await fetch(NODE_UNOFFICIAL_INDEX, {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = (await response.json()) as Array<{
        version?: string;
        lts?: unknown;
        files?: string[];
      }>;
      const candidates = data.filter(
        (item) =>
          typeof item.version === "string" &&
          Array.isArray(item.files) &&
          item.files.includes("linux-x64-glibc-217"),
      );
      const match = candidates.find((item) => Boolean(item.lts)) ?? candidates[0];
      if (match?.version) {
        cachedCompatNodeVersion = match.version;
        return match.version;
      }
    }
  } catch {
    // fall through to pinned LTS
  }
  cachedCompatNodeVersion = NODE_COMPAT_FALLBACK;
  return NODE_COMPAT_FALLBACK;
}

function friendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/timed out|超时/i.test(error.message)) return error.message;
    return error.message;
  }
  return String(error);
}

function nodeRuntimeError(detail: string): string {
  if (/libatomic/i.test(detail)) {
    return `Node.js 无法启动：系统缺少 libatomic 运行库（${detail}）。请手动安装 libatomic（Debian/Ubuntu 为 libatomic1）后重新部署，或改用 Ubuntu 22.04+/Debian 12+。`;
  }
  if (/GLIBC_\d/i.test(detail)) {
    return `Node.js 无法启动：服务器 glibc 版本过旧（${detail}）。请升级到 Ubuntu 22.04+/Debian 12+ 后重新部署。`;
  }
  return detail;
}

class DeployRun {
  readonly id = randomBytes(6).toString("hex");
  readonly config: DeployConfig;
  private readonly emitRaw: (event: DeployEvent) => void;
  private readonly steps: DeployStep[] = STEP_LIST.map((item) => ({
    ...item,
    status: "pending",
    note: "",
  }));
  private session: SshSession | null = null;
  private cancelled = false;
  private hostKeyResolver: ((accept: boolean) => void) | null = null;
  private currentStep: DeployStepId | null = null;
  private logQueue: { line: string; stream: "stdout" | "stderr" }[] = [];
  private logTimer: NodeJS.Timeout | null = null;
  private recent: string[] = [];
  private target: SshTarget;

  private arch = "x64";
  private glibc = "";
  private libatomic = false;
  private pkgManager: "apt" | "dnf" | "yum" | "none" = "none";
  private nodeBin = "/usr/local/bin/node";
  private nodeVersion = "";
  private caddyBin = "/usr/local/bin/caddy";
  private caddyVersion = "";
  private existingEnv: Record<string, string> = {};
  private adminPassword = "";
  private adminPath = "";
  private healthToken = "";
  private reusedPassword = false;
  private turnSecret = "";
  private turnReady = false;
  private localIp = "";
  private publicIp = "";
  private siteHost = "";
  private publicUrl = "";
  private secure = true;
  private remoteDir = "";
  private serverVersion = "";
  private inviteCode = "";
  private ports: DeployPortPlan = {
    secure: true,
    entryPort: 0,
    redirectPort: 0,
    internalPort: 0,
    turnPort: 0,
    relayMin: 0,
    relayMax: 0,
  };
  private turnForeign = false;
  private aptUpdated = false;

  constructor(config: DeployConfig, emit: (event: DeployEvent) => void) {
    this.config = config;
    this.emitRaw = emit;
    this.target = {
      host: config.host,
      port: config.sshPort,
      username: config.username,
      password: config.password || undefined,
      privateKeyPath: config.privateKeyPath || undefined,
      passphrase: config.passphrase || undefined,
    };
  }

  private emit(event: DeployEvent): void {
    this.emitRaw(event);
  }

  private flushLogs(): void {
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = null;
    }
    if (this.logQueue.length === 0) return;
    const queue = this.logQueue;
    this.logQueue = [];
    for (const entry of queue) this.emit({ type: "log", ...entry });
  }

  private log(line: string, stream: "stdout" | "stderr" = "stdout"): void {
    const text = line.slice(0, 600);
    this.recent.push(text);
    if (this.recent.length > 120) this.recent.shift();
    this.logQueue.push({ line: text, stream });
    if (this.logQueue.length > 300) this.logQueue.splice(0, this.logQueue.length - 300);
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => {
        this.logTimer = null;
        this.flushLogs();
      }, 140);
    }
  }

  private begin(id: DeployStepId): void {
    this.throwIfCancelled();
    this.currentStep = id;
    const step = this.steps.find((item) => item.id === id);
    if (step) {
      step.status = "running";
      step.note = "";
      this.emit({ type: "step", step: { ...step } });
    }
  }

  private complete(id: DeployStepId, note: string, status: DeployStepStatus = "success"): void {
    const step = this.steps.find((item) => item.id === id);
    if (!step) return;
    step.status = status;
    step.note = note;
    this.flushLogs();
    this.emit({ type: "step", step: { ...step } });
    if (this.currentStep === id) this.currentStep = null;
  }

  private failCurrent(message: string): void {
    const id = this.currentStep;
    if (!id) return;
    const step = this.steps.find((item) => item.id === id);
    if (!step) return;
    step.status = "error";
    step.note = message;
    this.emit({ type: "step", step: { ...step } });
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError();
  }

  private async exec(
    command: string,
    options: {
      label: string;
      sudo?: boolean;
      timeoutMs?: number;
      ignoreExit?: boolean;
      quiet?: boolean;
    },
  ): Promise<ExecResult> {
    this.throwIfCancelled();
    if (!this.session) throw new Error("SSH 连接尚未建立。");
    if (!options.quiet) this.log(`› ${options.label}`);
    const result = await this.session.exec(command, {
      sudo: options.sudo !== false,
      timeoutMs: options.timeoutMs ?? 180_000,
      onLog: (line, stream) => this.log(line, stream),
    });
    this.throwIfCancelled();
    if (result.code !== 0 && !options.ignoreExit) {
      const detail = result.stderr.trim().split(/\r?\n/).slice(-3).join(" ");
      throw new Error(
        `${options.label}失败（退出码 ${result.code}）${detail ? `：${detail}` : "。"}`,
      );
    }
    return result;
  }

  private async execOutput(
    command: string,
    options: { label: string; sudo?: boolean; timeoutMs?: number; ignoreExit?: boolean },
  ): Promise<string> {
    const result = await this.exec(command, { ...options, quiet: true });
    return result.stdout.trim();
  }

  private promptFingerprint(fingerprint: string, previous: string | null): Promise<boolean> {
    return new Promise((resolve) => {
      this.hostKeyResolver = resolve;
      this.emit({
        type: "host-key",
        prompt: {
          host: this.config.host,
          port: this.config.sshPort,
          fingerprint,
          previous,
        },
      });
    });
  }

  confirmHostKey(accept: boolean): void {
    const resolve = this.hostKeyResolver;
    this.hostKeyResolver = null;
    resolve?.(accept);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.hostKeyResolver?.(false);
    this.hostKeyResolver = null;
    this.session?.close();
    this.session = null;
    this.flushLogs();
    this.emit({ type: "cancelled" });
    if (activeRun === this) activeRun = null;
  }

  async run(): Promise<void> {
    try {
      await this.connect();
      await this.inspect();
      await this.installPackages();
      await this.setupTurn();
      await this.deployServer();
      await this.configureAutoUpdates();
      await this.configureProxy();
      await this.configureFirewall();
      await this.configureDefense();
      await this.verify();
      await this.finish();
    } catch (error) {
      if (this.cancelled || error instanceof CancelledError) {
        if (!this.cancelled) this.cancel();
        return;
      }
      const message = friendlyMessage(error);
      this.log(message, "stderr");
      this.failCurrent(message);
      this.flushLogs();
      this.emit({
        type: "error",
        message,
        step: this.currentStep,
        log: this.recent.slice(-25),
      });
    } finally {
      this.session?.close();
      this.session = null;
      if (activeRun === this) activeRun = null;
    }
  }

  private async connect(): Promise<void> {
    this.begin("connect");
    this.remoteDir = `/tmp/ruodao-deploy-${this.id}`;
    const known = readKnownHosts()[`${this.config.host}:${this.config.sshPort}`];
    let fingerprint = known?.hex ?? "";
    if (!fingerprint) {
      this.log("正在读取服务器 SSH 指纹…");
      const probe = await probeHostKey(this.target);
      this.throwIfCancelled();
      this.log(`服务器指纹：${probe.display}`);
      const accepted = await this.promptFingerprint(probe.display, null);
      this.throwIfCancelled();
      if (!accepted) throw new CancelledError();
      saveKnownHost(this.config.host, this.config.sshPort, probe.hex);
      fingerprint = probe.hex;
      this.log("已保存服务器指纹，后续部署会自动比对。");
    } else {
      this.log(`使用已保存的服务器指纹：${known?.display ?? fingerprintDisplay(fingerprint)}`);
    }
    try {
      this.session = await SshSession.open(this.target, fingerprint, (line, stream) =>
        this.log(line, stream),
      );
    } catch (error) {
      if (error instanceof HostKeyMismatchError) {
        throw new Error(
          `服务器 SSH 指纹与上次记录不一致（当前为 ${fingerprintDisplay(
            error.actual,
          )}）。如果刚刚重装过系统，请点击下方“清除已保存的服务器指纹”后重试；否则请警惕中间人攻击。`,
        );
      }
      throw error;
    }
    const identity = await this.execOutput("id -un", { label: "确认登录账号", sudo: false });
    this.complete("connect", `已以 ${identity || this.config.username} 身份登录`);
  }

  private async inspect(): Promise<void> {
    this.begin("inspect");
    const script = [
      ". /etc/os-release 2>/dev/null || true",
      'echo "os_id=${ID:-}"',
      'echo "os_like=${ID_LIKE:-}"',
      'echo "os_name=${PRETTY_NAME:-}"',
      'echo "arch=$(uname -m)"',
      'echo "systemd=$(command -v systemctl || true)"',
      'echo "ss_path=$(command -v ss || true)"',
      'echo "mem_kb=$(awk \'/MemTotal/{print $2}\' /proc/meminfo 2>/dev/null)"',
      'echo "disk_kb=$(df -Pk / | awk \'NR==2{print $4}\')"',
      'echo "node_path=$(command -v node || true)"',
      'echo "node_version=$(node -v 2>/dev/null || true)"',
      'echo "glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk \'{print $2}\')"',
      'echo "glibc_ldd=$(ldd --version 2>/dev/null | head -1 | awk \'{print $NF}\')"',
      'echo "libatomic=$(ls /usr/lib64/libatomic.so.1* /usr/lib/libatomic.so.1* /usr/lib/*-linux-gnu*/libatomic.so.1* /lib64/libatomic.so.1* /lib/*-linux-gnu*/libatomic.so.1* 2>/dev/null | head -n 1)"',
      'echo "public_ip=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"',
      "echo \"local_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\\\"src\\\") {print $(i+1); exit}}')\"",
      'echo "existing_env=$(test -f /etc/ruodao-remote.env && echo yes || echo no)"',
      'echo "existing_service=$(systemctl is-active ruodao-remote 2>/dev/null || true)"',
      'echo "ruodao_caddy_active=$(systemctl is-active ruodao-caddy 2>/dev/null || true)"',
      'echo "coturn_active=$(systemctl is-active coturn 2>/dev/null || true)"',
      'echo "pkg_apt=$(command -v apt-get || true)"',
      'echo "pkg_dnf=$(command -v dnf || true)"',
      'echo "pkg_yum=$(command -v yum || true)"',
      `echo "legacy_caddyfile=$(test -f ${LEGACY_CADDYFILE} && grep -q 'managed by ruodao-remote' ${LEGACY_CADDYFILE} && echo ours || (test -f ${LEGACY_CADDYFILE} && echo foreign || echo none))"`,
      `echo "turnconf=$(test -f ${TURN_CONF} && grep -q 'managed by ruodao-remote' ${TURN_CONF} && echo ours || (test -f ${TURN_CONF} && echo foreign || echo none))"`,
    ].join("; ");
    const output = await this.execOutput(script, { label: "采集系统信息" });
    const info = parseKeyValues(output);
    this.glibc = info.glibc || info.glibc_ldd || "";
    this.libatomic = Boolean(info.libatomic);
    if (!info.systemd) {
      throw new Error("当前系统没有 systemd，暂不支持自动部署。请在 Ubuntu、Debian 或 CentOS 等系统上使用。");
    }
    this.pkgManager = info.pkg_apt ? "apt" : info.pkg_dnf ? "dnf" : info.pkg_yum ? "yum" : "none";
    if (this.pkgManager === "none") {
      throw new Error("未找到 apt / dnf / yum 包管理器，暂不支持自动部署该系统。");
    }
    if (!info.ss_path) {
      this.log("服务器缺少 ss 命令，先安装端口检查工具…");
      if (this.pkgManager === "apt") {
        await this.exec("apt-get update -qq", { label: "更新软件源", timeoutMs: 300_000 });
        this.aptUpdated = true;
      }
      await this.installCommand(
        this.pkgManager === "apt" ? "iproute2" : "iproute",
        "安装端口检查工具",
        240_000,
      );
      const ssPath = await this.execOutput("command -v ss || true", { label: "确认 ss 命令" });
      if (!ssPath) throw new Error("服务器缺少 ss 命令，无法检查端口占用。请安装 iproute2 后重试。");
    }
    const archRaw = info.arch ?? "";
    const archMap: Record<string, string> = { x86_64: "x64", amd64: "x64", aarch64: "arm64", arm64: "arm64" };
    this.arch = archMap[archRaw] ?? "";
    if (!this.arch) throw new Error(`暂不支持该服务器架构（${archRaw || "未知"}），目前支持 x86_64 与 arm64。`);
    const diskKb = Number(info.disk_kb) || 0;
    if (diskKb > 0 && diskKb < 900_000) {
      throw new Error("服务器磁盘可用空间不足 1GB，无法完成安装。");
    }
    const memMb = Math.round((Number(info.mem_kb) || 0) / 1024);
    if (memMb > 0 && memMb < 380) {
      this.log(`提示：服务器内存约 ${memMb}MB，服务端占用很小，通常仍可运行。`, "stderr");
    }
    this.localIp = info.local_ip ?? "";
    this.publicIp = info.public_ip || (isIp(this.config.host) ? this.config.host : "");

    if (info.existing_env === "yes") {
      const envText = await this.execOutput(`cat ${ENV_FILE}`, { label: "读取已有部署配置" });
      this.existingEnv = parseEnvText(envText);
      if (this.existingEnv.ADMIN_PASSWORD) {
        this.adminPassword = this.existingEnv.ADMIN_PASSWORD;
        this.reusedPassword = true;
      }
      if (this.existingEnv.TURN_SECRET) this.turnSecret = this.existingEnv.TURN_SECRET;
      this.adminPath = isCustomAdminPath(this.existingEnv.ADMIN_PATH)
        ? this.existingEnv.ADMIN_PATH.trim()
        : newAdminPath();
      this.healthToken =
        activeHealthToken(this.existingEnv.HEALTH_TOKEN) || randomBytes(32).toString("hex");
      this.log("检测到已有若道远程服务，将复用数据目录与管理员密码。");
    } else {
      this.adminPath = newAdminPath();
      this.healthToken = randomBytes(32).toString("hex");
    }

    let siteHost = this.config.domain;
    let freeHosting = false;
    if (!siteHost) {
      if (isIp(this.config.host)) {
        const publicAddress = this.publicIp || this.config.host;
        if (!isIp(publicAddress)) {
          throw new Error("无法确定服务器公网 IPv4，无法自动申请免费 HTTPS。请填写已解析到该服务器的域名后重试。");
        }
        siteHost = sslipHostname(publicAddress);
        freeHosting = true;
        this.log(`未填写域名，将使用 ${siteHost}（sslip.io 免费动态解析）申请免费 HTTPS 证书。`);
        this.log("免费域名无需配置 DNS，证书由 Let's Encrypt 自动签发并在到期前自动续期。");
      } else if (this.config.host.includes(":")) {
        throw new Error("IPv6 服务器请填写已解析到该服务器的域名，才能自动申请免费 HTTPS。");
      } else {
        siteHost = this.config.host;
      }
    }
    this.siteHost = siteHost;
    if (!freeHosting) {
      this.log(`检查域名解析：${siteHost}`);
      let addresses: string[] = [];
      try {
        const records = await dns.lookup(siteHost, { all: true });
        addresses = records.map((item) => item.address);
      } catch {
        throw new Error(
          `域名 ${siteHost} 暂时无法解析。请先在域名服务商处添加 A 记录指向 ${this.config.host}，等待解析生效后再试。`,
        );
      }
      this.log(`域名解析结果：${addresses.join(", ") || "无"}`);
      if (isIp(this.config.host) && !addresses.includes(this.config.host)) {
        this.log(
          `注意：${siteHost} 当前解析到 ${addresses.join(", ")}，与服务器 ${this.config.host} 不同。如果使用了 CDN 或反向代理可以忽略，否则请检查 A 记录。`,
          "stderr",
        );
      }
    }

    if (info.legacy_caddyfile === "foreign") {
      this.log("检测到其他 Caddy 站点配置：本次使用独立的 Caddy 实例与配置，不会修改它。");
    }
    const legacyTurnOurs = info.turnconf === "ours";
    this.turnForeign =
      info.turnconf === "foreign" || (info.coturn_active === "active" && !legacyTurnOurs);
    if (this.config.installTurn && this.turnForeign) {
      this.log("检测到服务器上已有其他 TURN 配置或实例：本次不会修改它，将跳过 TURN 中转。", "stderr");
    }

    const stopCommands = [
      "systemctl stop ruodao-remote 2>/dev/null || true",
      "systemctl stop ruodao-caddy 2>/dev/null || true",
    ];
    if (info.legacy_caddyfile === "ours") {
      stopCommands.push(
        "systemctl stop caddy 2>/dev/null || true",
        "systemctl disable caddy >/dev/null 2>&1 || true",
      );
    }
    if (legacyTurnOurs) {
      stopCommands.push(
        "systemctl stop coturn 2>/dev/null || true",
        "systemctl disable coturn >/dev/null 2>&1 || true",
      );
    }
    await this.exec(stopCommands.join("; "), {
      label: "停止本工具此前部署的服务",
      ignoreExit: true,
    });
    const waitUnits = ["ruodao-remote", "ruodao-caddy"];
    if (info.legacy_caddyfile === "ours") waitUnits.push("caddy");
    if (legacyTurnOurs) waitUnits.push("coturn");
    const activeChecks = waitUnits.map((unit) => `systemctl is-active --quiet ${unit}`).join(" || ");
    await this.exec(
      `for i in $(seq 1 20); do if ! (${activeChecks}); then exit 0; fi; sleep 0.5; done; exit 1`,
      { label: "等待旧服务释放端口", ignoreExit: true },
    );
    const stillRunning = await this.execOutput(
      "systemctl is-active ruodao-remote 2>/dev/null || true",
      { label: "确认旧版服务已停止", ignoreExit: true },
    );
    if (stillRunning === "active") {
      throw new Error("旧版若道远程服务未能停止。请先手动停止 ruodao-remote 服务，再重新部署。");
    }
    await delay(300);

    const portScript = [
      `echo "tcp_used=$(ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | sed -n 's/.*:\\([0-9][0-9]*\\)$/\\1/p' | sort -n -u | tr '\\n' ' ')"`,
      `echo "udp_used=$(ss -lun 2>/dev/null | awk 'NR>1 {print $4}' | sed -n 's/.*:\\([0-9][0-9]*\\)$/\\1/p' | sort -n -u | tr '\\n' ' ')"`,
    ].join("; ");
    const portInfo = parseKeyValues(
      await this.execOutput(portScript, { label: "检查已占用的端口" }),
    );
    const tcpUsed = parsePortList(portInfo.tcp_used ?? "");
    const udpUsed = parsePortList(portInfo.udp_used ?? "");
    const busyWellKnown = [80, 443, 3478].filter(
      (port) => tcpUsed.includes(port) || udpUsed.includes(port),
    );
    if (busyWellKnown.length > 0) {
      this.log(`检测到已占用端口：${busyWellKnown.join(", ")}；这些端口会被自动避开。`);
    }

    this.ports = planDeployPorts({
      sshPort: this.config.sshPort,
      installTurn: this.config.installTurn && !this.turnForeign,
      tcpUsed,
      udpUsed,
    });
    this.secure = true;
    this.publicUrl = formatEntryUrl(siteHost, true, this.ports.entryPort);

    this.log(`公网入口：${this.publicUrl}（HTTPS · TCP ${this.ports.entryPort}）`);
    this.log(`本机信令：127.0.0.1:${this.ports.internalPort}（仅本机监听，不对外暴露）`);
    this.log(`管理入口：${this.publicUrl}${this.adminPath}（已隐藏默认 /admin）`);
    if (this.ports.redirectPort) {
      this.log(
        `TCP 80 仅用于 Let's Encrypt 证书验证并跳转到 HTTPS，业务入口在非标准端口 TCP ${this.ports.entryPort}。`,
      );
    } else {
      this.log(
        "80 已被其他服务占用，本次 HTTPS 监听 443 并通过 TLS-ALPN 验证免费证书，不接管 80。",
        "stderr",
      );
    }
    this.log(
      `请在云安全组放行 TCP ${this.ports.entryPort}${this.ports.redirectPort ? " 与 TCP 80" : ""}；不会停止或修改现有网站服务。`,
      "stderr",
    );
    if (this.config.installTurn && !this.turnForeign) {
      if (this.ports.turnPort > 0) {
        this.log(
          `TURN：TCP/UDP ${this.ports.turnPort}，中继 ${this.ports.relayMin}-${this.ports.relayMax}/UDP`,
        );
      } else {
        this.log("没有找到可用的 TURN 端口，本次将跳过 TURN；直连与 STUN 仍可工作。", "stderr");
      }
    }

    const summary = `${info.os_name || info.os_id || "Linux"} · ${archRaw} · ${memMb || "?"}MB 内存`;
    this.complete(
      "inspect",
      `${summary} · HTTPS TCP ${this.ports.entryPort}${this.ports.entryPort !== 443 ? "（非标准端口）" : ""}`,
    );
  }

  private installCommand(packages: string, label: string, timeoutMs = 420_000): Promise<ExecResult> {
    if (this.pkgManager === "apt") {
      return this.exec(`apt-get install -y --no-install-recommends ${packages}`, {
        label,
        timeoutMs,
      });
    }
    if (this.pkgManager === "dnf") {
      return this.exec(`dnf install -y ${packages}`, { label, timeoutMs });
    }
    return this.exec(`yum install -y ${packages}`, { label, timeoutMs });
  }

  private libatomicPackage(): string {
    return this.pkgManager === "apt" ? "libatomic1" : "libatomic";
  }

  private async ensureLibatomic(): Promise<void> {
    if (this.libatomic) return;
    this.log("服务器缺少 libatomic 运行库，Node.js 启动需要它，正在安装…");
    try {
      await this.installCommand(this.libatomicPackage(), "安装 libatomic", 240_000);
      this.libatomic = true;
    } catch (error) {
      this.log(`libatomic 安装失败：${friendlyMessage(error)}`, "stderr");
    }
  }

  private async installNode(compat: boolean): Promise<void> {
    const version = compat ? await resolveCompatNodeVersion() : await resolveNodeVersion(this.arch);
    const { dirName, url } = nodeTarball(version, this.arch, compat);
    this.log(
      compat
        ? `服务器 glibc ${this.glibc || "较旧"}，改用 glibc-217 兼容构建安装 Node.js ${version}…`
        : `安装 Node.js ${version}…`,
    );
    await this.exec(
      [
        "rm -rf /tmp/ruodao-node && mkdir -p /tmp/ruodao-node",
        `curl -fsSL --retry 3 ${url} -o /tmp/ruodao-node/node.tar.gz`,
        "tar -xzf /tmp/ruodao-node/node.tar.gz -C /tmp/ruodao-node",
        "rm -rf /usr/local/lib/nodejs",
        "mkdir -p /usr/local/lib",
        `mv /tmp/ruodao-node/${dirName} /usr/local/lib/nodejs`,
        "ln -sfn /usr/local/lib/nodejs/bin/node /usr/local/bin/node",
        "ln -sfn /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm",
        "ln -sfn /usr/local/lib/nodejs/bin/npx /usr/local/bin/npx",
        "/usr/local/bin/node -v",
        "rm -rf /tmp/ruodao-node",
      ].join(" && "),
      { label: "安装 Node.js", timeoutMs: 480_000 },
    );
    this.nodeBin = "/usr/local/bin/node";
    this.nodeVersion = await this.execOutput(`${this.nodeBin} -v`, { label: "确认 Node.js 版本" });
  }

  private async installNodeRuntime(): Promise<void> {
    const compat = needsGlibc217Node(this.glibc, this.arch);
    try {
      await this.installNode(compat);
      return;
    } catch (error) {
      const detail = friendlyMessage(error);
      if (!compat && this.arch === "x64" && /GLIBC_\d/i.test(detail)) {
        this.log("官方 Node.js 与当前系统 glibc 不兼容，改用 glibc-217 兼容构建重试…", "stderr");
        try {
          await this.installNode(true);
          return;
        } catch (retryError) {
          throw new Error(nodeRuntimeError(friendlyMessage(retryError)));
        }
      }
      throw new Error(nodeRuntimeError(detail));
    }
  }

  private async installPackages(): Promise<void> {
    this.begin("packages");
    if (this.pkgManager === "apt" && !this.aptUpdated) {
      await this.exec("apt-get update -qq", { label: "更新软件源", timeoutMs: 300_000 });
      this.aptUpdated = true;
    }
    await this.installCommand("ca-certificates curl tar", "安装基础工具", 300_000);

    const nodeExisting = await this.execOutput(
      "command -v node >/dev/null 2>&1 && node -v || true",
      { label: "检查 Node.js", sudo: false },
    );
    const major = Number(nodeExisting.replace(/^v/, "").split(".")[0]) || 0;
    if (major >= 20) {
      this.nodeBin = "/usr/bin/env node";
      this.nodeVersion = nodeExisting;
      const nodePath = await this.execOutput("command -v node", { label: "定位 Node.js", sudo: false });
      if (nodePath) this.nodeBin = nodePath;
      this.log(`已检测到 ${nodeExisting}，直接复用。`);
    } else {
      await this.ensureLibatomic();
      await this.installNodeRuntime();
    }

    const caddyExisting = await this.execOutput(
      "command -v caddy >/dev/null 2>&1 && caddy version 2>/dev/null | head -1 || true",
      { label: "检查 Caddy", sudo: false },
    );
    if (caddyExisting) {
      this.caddyVersion = caddyExisting.split(/\s+/)[0];
      const caddyPath = await this.execOutput("command -v caddy", { label: "定位 Caddy", sudo: false });
      if (caddyPath) this.caddyBin = caddyPath;
      if (caddyPath !== "/usr/local/bin/caddy") {
        this.log(`服务器已有 Caddy（${caddyExisting}），直接复用。`);
      }
    } else {
      this.log("下载 Caddy 静态程序…");
      const arch = this.arch === "arm64" ? "arm64" : "amd64";
      await this.exec(
        [
          `curl -fsSL --retry 3 "https://caddyserver.com/api/download?os=linux&arch=${arch}" -o /tmp/caddy-download`,
          "install -m 0755 /tmp/caddy-download /usr/local/bin/caddy",
          "rm -f /tmp/caddy-download",
          "/usr/local/bin/caddy version",
        ].join(" && "),
        { label: "安装 Caddy", timeoutMs: 300_000 },
      );
      this.caddyVersion = await this.execOutput(
        "caddy version | head -1 | awk '{print $1}'",
        { label: "确认 Caddy 版本" },
      );
    }

    await this.exec(
      [
        "getent group caddy >/dev/null 2>&1 || groupadd --system caddy",
        `id caddy >/dev/null 2>&1 || useradd --system --gid caddy --home-dir ${CADDY_DATA_DIR} --shell "$(command -v nologin || echo /bin/false)" caddy`,
        `mkdir -p ${CADDY_DIR} ${CADDY_DATA_DIR}`,
        `chown -R caddy:caddy ${CADDY_DATA_DIR}`,
        `chmod 750 ${CADDY_DATA_DIR}`,
      ].join(" && "),
      { label: "准备独立 Caddy 运行账号" },
    );

    this.complete("packages", `Node ${this.nodeVersion || "已就绪"} · Caddy ${this.caddyVersion || "已就绪"}`);
  }

  private async setupTurn(): Promise<void> {
    this.begin("turn");
    if (!this.config.installTurn) {
      this.complete("turn", "已按设置跳过；直连与 STUN 仍可工作", "skipped");
      return;
    }
    if (this.turnForeign) {
      this.complete(
        "turn",
        "服务器已有其他 TURN 配置或实例，本次未做任何修改；直连与 STUN 仍可工作",
        "skipped",
      );
      return;
    }
    if (!this.ports.turnPort) {
      this.complete("turn", "没有可用的 TURN 端口，本次已跳过；直连与 STUN 仍可工作", "skipped");
      return;
    }
    try {
      await this.installCommand("coturn", "安装 coturn", 420_000);
    } catch (error) {
      this.log(`coturn 安装失败：${friendlyMessage(error)}`, "stderr");
      this.complete("turn", "软件源中没有 coturn，已跳过；跨运营商复杂网络可能无法建立连接", "skipped");
      return;
    }
    this.turnSecret = this.turnSecret || randomBytes(24).toString("hex");
    const external =
      this.publicIp && this.localIp && this.publicIp !== this.localIp && isPrivateIp(this.localIp)
        ? `${this.publicIp}/${this.localIp}`
        : "";
    const conf = buildTurnserverConf({
      listenPort: this.ports.turnPort,
      relayMin: this.ports.relayMin,
      relayMax: this.ports.relayMax,
      secret: this.turnSecret,
      realm: this.siteHost || this.config.host,
      serverName: this.siteHost || "ruodao-remote",
      externalIp: external,
      denyPrivatePeers: !isPrivateIp(this.publicIp),
    });
    const tmp = `${this.remoteDir}/turnserver.conf`;
    await this.uploadContent(conf, tmp);
    const verify = [
      "sleep 1",
      "systemctl is-active coturn",
      "for i in $(seq 1 10); do",
      `  if ss -lntu 2>/dev/null | grep -Eq "[:.]${this.ports.turnPort}[[:space:]]"; then exit 0; fi`,
      "  sleep 1",
      "done",
      "exit 1",
    ].join("\n");
    try {
      await this.exec(
        [
          `install -o root -g root -m 0600 ${tmp} ${TURN_CONF}`,
          "if [ -f /etc/default/coturn ]; then sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn; fi",
          "systemctl enable coturn >/dev/null 2>&1 || true",
          "systemctl restart coturn",
          verify,
        ].join(" && "),
        { label: "启动 TURN 中转", timeoutMs: 120_000 },
      );
    } catch (error) {
      this.log(`TURN 启动失败：${friendlyMessage(error)}`, "stderr");
      const logs = await this.execOutput("journalctl -u coturn -n 25 --no-pager 2>/dev/null || true", {
        label: "读取 coturn 日志",
        ignoreExit: true,
      }).catch(() => "");
      if (logs) this.log(logs, "stderr");
      await this.exec("systemctl stop coturn 2>/dev/null || true", {
        label: "停止未就绪的 TURN",
        ignoreExit: true,
      }).catch(() => undefined);
      this.complete("turn", "TURN 未能启动，已跳过；直连与 STUN 仍可工作", "skipped");
      return;
    }
    this.turnReady = true;
    const note = `TURN 已启动 · TCP/UDP ${this.ports.turnPort} · 中继 ${this.ports.relayMin}-${this.ports.relayMax}/UDP${
      external ? ` · 公网 ${this.publicIp}` : ""
    }`;
    this.complete("turn", note);
  }

  private async ensureRemoteDir(): Promise<void> {
    await this.exec(`mkdir -p ${this.remoteDir} && chmod 700 ${this.remoteDir}`, {
      label: "创建临时目录",
      sudo: false,
    });
  }

  private async uploadContent(content: string, remotePath: string): Promise<void> {
    if (!this.session) throw new Error("SSH 连接尚未建立。");
    await this.ensureRemoteDir();
    await this.session.uploadContent(content, remotePath);
  }

  private async deployServer(): Promise<void> {
    this.begin("server");
    const bundle = app.isPackaged
      ? path.join(process.resourcesPath, "server", "server.cjs")
      : path.join(app.getAppPath(), "resources", "server", "server.cjs");
    if (!existsSync(bundle)) {
      throw new Error("客户端缺少内置服务端文件，请重新安装客户端后再试。");
    }
    if (!this.adminPassword) {
      this.adminPassword = randomBytes(18).toString("base64url");
    }
    await this.exec(
      [
        "getent group ruodao >/dev/null 2>&1 || groupadd --system ruodao",
        "id ruodao >/dev/null 2>&1 || useradd --system --gid ruodao --home-dir /var/lib/ruodao --shell \"$(command -v nologin || echo /bin/false)\" ruodao",
        `mkdir -p ${SERVER_DIR} ${DATA_DIR}`,
        "chown -R ruodao:ruodao /var/lib/ruodao",
        `chmod 750 ${DATA_DIR}`,
      ].join(" && "),
      { label: "创建服务账号与目录" },
    );
    if (!this.session) throw new Error("SSH 连接尚未建立。");
    await this.ensureRemoteDir();
    this.log("上传服务端程序（约 240KB）…");
    const remoteBundle = `${this.remoteDir}/server.cjs`;
    await this.session.uploadFile(bundle, remoteBundle);
    await this.exec(
      `install -o root -g root -m 0644 ${remoteBundle} ${SERVER_DIR}/server.cjs`,
      { label: "安装服务端程序" },
    );

    const turnUrls =
      this.turnReady && this.ports.turnPort > 0
        ? `turn:${this.siteHost}:${this.ports.turnPort}?transport=udp,turn:${this.siteHost}:${this.ports.turnPort}?transport=tcp`
        : "";
    const stunUrls =
      this.turnReady && this.ports.turnPort > 0
        ? `stun:${this.siteHost}:${this.ports.turnPort},stun:stun.l.google.com:19302`
        : "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302";
    const serverName = `${this.siteHost} 的若道远程`;
    const envLines = [
      "# 由若道远程客户端生成，重新部署会覆盖此文件",
      "NODE_ENV=production",
      `PORT=${this.ports.internalPort}`,
      "HOST=127.0.0.1",
      `DATA_DIR=${DATA_DIR}`,
      systemdEnvLine("PUBLIC_URL", this.publicUrl),
      systemdEnvLine("SERVER_NAME", serverName),
      `REGISTRATION_MODE=${this.config.registrationMode}`,
      "TRUST_PROXY=1",
      "ADMIN_SESSION_HOURS=12",
      systemdEnvLine("ADMIN_PASSWORD", this.adminPassword),
      systemdEnvLine("ADMIN_PATH", this.adminPath),
      systemdEnvLine("HEALTH_TOKEN", this.healthToken),
      systemdEnvLine("SECURITY_LOG_FILE", SECURITY_LOG),
      systemdEnvLine("STUN_URLS", stunUrls),
      ...(turnUrls
        ? [systemdEnvLine("TURN_URLS", turnUrls), `TURN_SECRET=${this.turnSecret}`]
        : []),
      "TURN_TTL_SECONDS=3600",
      "MAX_ATTEMPTS_PER_MINUTE=8",
      "MAX_CONNECTIONS_PER_IP=6",
      "MAX_TOTAL_CONNECTIONS=300",
      "MESSAGE_LIMIT_PER_10S=120",
      "HTTP_REQUESTS_PER_MINUTE=360",
      "UPDATE_ENABLED=1",
      "UPDATE_SYSTEM_UPDATER=1",
      "UPDATE_REQUIRE_IDLE=1",
      "UPDATE_CHECK_HOURS=6",
      `UPDATE_STAGE_DIR=${DATA_DIR}/updates`,
      `UPDATE_ENTRY_FILE=${SERVER_DIR}/server.cjs`,
      `UPDATE_SERVICE_NAME=${SERVICE}`,
      "",
    ];
    const envTmp = `${this.remoteDir}/ruodao.env`;
    await this.uploadContent(envLines.join("\n"), envTmp);
    await this.exec(`install -o root -g root -m 0600 ${envTmp} ${ENV_FILE}`, {
      label: "写入服务配置",
    });

    const unit = [
      "[Unit]",
      "Description=Ruodao Remote signaling server",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "User=ruodao",
      "Group=ruodao",
      `WorkingDirectory=${SERVER_DIR}`,
      `EnvironmentFile=${ENV_FILE}`,
      `ExecStart=${this.nodeBin} ${SERVER_DIR}/server.cjs`,
      "Restart=always",
      "RestartSec=2",
      "NoNewPrivileges=yes",
      "PrivateTmp=yes",
      "PrivateDevices=yes",
      "ProtectSystem=full",
      "ProtectHome=yes",
      "ProtectKernelTunables=yes",
      "ProtectKernelModules=yes",
      "ProtectKernelLogs=yes",
      "ProtectControlGroups=yes",
      "ProtectClock=yes",
      "ProtectHostname=yes",
      "RestrictSUIDSGID=yes",
      "RestrictRealtime=yes",
      "LockPersonality=yes",
      "UMask=0077",
      "CapabilityBoundingSet=",
      `ReadWritePaths=${DATA_DIR}`,
      "LimitNOFILE=65536",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
    ].join("\n");
    const unitTmp = `${this.remoteDir}/ruodao-remote.service`;
    await this.uploadContent(unit, unitTmp);
    await this.exec(`install -o root -g root -m 0644 ${unitTmp} ${UNIT_FILE}`, {
      label: "注册 systemd 服务",
    });
    await this.exec(
      "systemctl daemon-reload && systemctl enable ruodao-remote >/dev/null 2>&1 && systemctl restart ruodao-remote",
      { label: "启动信令服务", timeoutMs: 120_000 },
    );
    const health = await this.execOutput(
      [
        "for i in $(seq 1 30); do",
        `  if curl -fsS --max-time 2 -H "x-ruodao-health: ${this.healthToken}" http://127.0.0.1:${this.ports.internalPort}/health > /tmp/ruodao-health.json 2>/dev/null; then`,
        "    cat /tmp/ruodao-health.json; exit 0;",
        "  fi",
        "  sleep 1",
        "done",
        "journalctl -u ruodao-remote -n 40 --no-pager 2>/dev/null || true",
        "exit 1",
      ].join("\n"),
      { label: "等待服务端就绪", timeoutMs: 60_000, ignoreExit: true },
    ).catch((error) => {
      throw new Error(`信令服务未能启动：${friendlyMessage(error)}`);
    });
    let healthData: Record<string, unknown> = {};
    try {
      healthData = JSON.parse(health) as Record<string, unknown>;
    } catch {
      // journal output on failure is already in the log
    }
    if (healthData.name !== "ruodao-remote-server") {
      throw new Error("信令服务启动后健康检查未通过，请查看下方日志。");
    }
    this.serverVersion = String(healthData.version ?? "");
    this.complete(
      "server",
      `服务已运行${this.serverVersion ? ` · v${this.serverVersion}` : ""} · 数据目录 ${DATA_DIR}`,
    );
  }

  private async configureAutoUpdates(): Promise<void> {
    this.begin("updates");
    if (!this.nodeBin) throw new Error("尚未确定 Node.js 路径，无法配置自动更新。");
    const service = [
      "[Unit]",
      "Description=Ruodao Remote automatic update",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=oneshot",
      "User=root",
      "Group=root",
      `EnvironmentFile=${ENV_FILE}`,
      `ExecStart=${this.nodeBin} ${SERVER_DIR}/server.cjs --self-update`,
      "Nice=10",
      "IOSchedulingClass=idle",
      "TimeoutStartSec=900",
      "ProtectSystem=full",
      "PrivateTmp=yes",
      "ProtectHome=yes",
      "NoNewPrivileges=yes",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
    ].join("\n");
    const timer = [
      "[Unit]",
      "Description=Periodic Ruodao Remote update check",
      "",
      "[Timer]",
      "OnActiveSec=10min",
      "OnUnitActiveSec=1h",
      "RandomizedDelaySec=5min",
      "Persistent=true",
      "Unit=ruodao-remote-update.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n");
    const serviceTmp = `${this.remoteDir}/ruodao-remote-update.service`;
    const timerTmp = `${this.remoteDir}/ruodao-remote-update.timer`;
    await this.uploadContent(service, serviceTmp);
    await this.uploadContent(timer, timerTmp);
    await this.exec(
      [
        `install -o root -g root -m 0644 ${serviceTmp} ${UPDATE_UNIT}`,
        `install -o root -g root -m 0644 ${timerTmp} ${UPDATE_TIMER}`,
        "systemctl daemon-reload",
      ].join(" && "),
      { label: "写入自动更新单元" },
    );
    const output = await this.execOutput(
      [
        "systemctl enable ruodao-remote-update.timer >/dev/null 2>&1",
        "systemctl restart ruodao-remote-update.timer",
        "systemctl is-active ruodao-remote-update.timer",
      ].join(" && "),
      { label: "启动自动更新定时器", ignoreExit: true },
    );
    if (!output.includes("active")) {
      throw new Error(
        "自动更新定时器未能启动。请运行 systemctl status ruodao-remote-update.timer 查看原因。",
      );
    }
    this.log("自动更新已启用：每小时检查一次，有远控会话时延后，安装失败会自动回滚。");
    this.complete("updates", "每小时检查新版本；无远控会话时自动安装，失败自动回滚");
  }

  private async configureProxy(): Promise<void> {
    this.begin("proxy");
    const caddyfile = buildCaddyfile({
      siteHost: this.siteHost,
      entryPort: this.ports.entryPort,
      redirectPort: this.ports.redirectPort,
      internalPort: this.ports.internalPort,
      storageDir: CADDY_DATA_DIR,
    });
    const tmp = `${this.remoteDir}/Caddyfile`;
    await this.uploadContent(caddyfile, tmp);
    await this.exec(`install -o root -g root -m 0644 ${tmp} ${CADDYFILE}`, {
      label: "写入独立 Caddy 配置",
    });
    await this.exec(`${this.caddyBin} validate --config ${CADDYFILE}`, {
      label: "校验 Caddy 配置",
    });

    const unitTmp = `${this.remoteDir}/ruodao-caddy.service`;
    const unit = [
      "[Unit]",
      "Description=Ruodao Remote entry (Caddy)",
      "Documentation=https://caddyserver.com/docs/",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=notify",
      "User=caddy",
      "Group=caddy",
      `Environment=HOME=${CADDY_DATA_DIR}`,
      `Environment=XDG_DATA_HOME=${CADDY_DATA_DIR}`,
      `Environment=XDG_CONFIG_HOME=${CADDY_DATA_DIR}`,
      `ExecStart=${this.caddyBin} run --environ --config ${CADDYFILE}`,
      "TimeoutStopSec=5s",
      "LimitNOFILE=1048576",
      "PrivateTmp=true",
      "ProtectSystem=full",
      "ProtectHome=true",
      "ProtectKernelTunables=yes",
      "ProtectKernelModules=yes",
      "ProtectKernelLogs=yes",
      "ProtectControlGroups=yes",
      "ProtectClock=yes",
      "RestrictSUIDSGID=yes",
      "RestrictRealtime=yes",
      "LockPersonality=yes",
      "UMask=0027",
      `ReadWritePaths=${CADDY_DATA_DIR}`,
      "AmbientCapabilities=CAP_NET_BIND_SERVICE",
      "CapabilityBoundingSet=CAP_NET_BIND_SERVICE",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
    ].join("\n");
    await this.uploadContent(unit, unitTmp);
    await this.exec(`install -o root -g root -m 0644 ${unitTmp} ${CADDY_UNIT}`, {
      label: "注册独立 Caddy 服务",
    });
    await this.exec(
      "systemctl daemon-reload && systemctl enable ruodao-caddy >/dev/null 2>&1 && systemctl restart ruodao-caddy && sleep 1 && systemctl is-active ruodao-caddy",
      { label: "启动网站入口", timeoutMs: 120_000 },
    ).catch(async () => {
      const logs = await this.execOutput(
        "journalctl -u ruodao-caddy -n 30 --no-pager 2>/dev/null || true",
        { label: "读取 Caddy 日志", ignoreExit: true },
      );
      if (logs) this.log(logs, "stderr");
      const ports = [this.ports.entryPort, this.ports.redirectPort].filter(Boolean).join("/");
      throw new Error(
        `独立 Caddy 启动失败。请检查 TCP ${ports} 是否刚刚被其他程序占用，以及 ${CADDYFILE} 是否有效。`,
      );
    });
    const route = `${this.publicUrl} → 127.0.0.1:${this.ports.internalPort}`;
    this.complete(
      "proxy",
      `${route} · 免费证书自动申请${this.ports.redirectPort ? ` · 80 跳转到 TCP ${this.ports.entryPort}` : " · 443 TLS-ALPN"}`,
    );
  }

  private async configureFirewall(): Promise<void> {
    this.begin("firewall");
    const serviceTcpPorts = Array.from(
      new Set([this.ports.entryPort, this.ports.redirectPort].filter(Boolean)),
    );
    const tcpPorts = Array.from(new Set([this.config.sshPort, ...serviceTcpPorts]));
    const udpPorts = this.turnReady && this.ports.turnPort > 0 ? [this.ports.turnPort] : [];
    const relay = this.turnReady && this.ports.relayMin > 0 && this.ports.relayMax > 0;
    const ufwRules = [
      `  ufw limit ${this.config.sshPort}/tcp >/dev/null 2>&1 || true`,
      ...serviceTcpPorts.map((port) => `  ufw allow ${port}/tcp >/dev/null 2>&1 || true`),
      ...udpPorts.map((port) => `  ufw allow ${port}/udp >/dev/null 2>&1 || true`),
      ...(relay
        ? [
            `  ufw allow ${this.ports.turnPort}/tcp >/dev/null 2>&1 || true`,
            `  ufw allow ${this.ports.relayMin}:${this.ports.relayMax}/udp >/dev/null 2>&1 || true`,
          ]
        : []),
    ];
    const firewalldRules = [
      ...tcpPorts.map(
        (port) => `  firewall-cmd --permanent --add-port=${port}/tcp >/dev/null 2>&1 || true`,
      ),
      ...udpPorts.map(
        (port) => `  firewall-cmd --permanent --add-port=${port}/udp >/dev/null 2>&1 || true`,
      ),
      ...(relay
        ? [
            `  firewall-cmd --permanent --add-port=${this.ports.turnPort}/tcp >/dev/null 2>&1 || true`,
            `  firewall-cmd --permanent --add-port=${this.ports.relayMin}-${this.ports.relayMax}/udp >/dev/null 2>&1 || true`,
          ]
        : []),
    ];
    const script = [
      "changed=0",
      'if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then',
      ...ufwRules,
      '  echo "ufw=updated"; changed=1',
      "fi",
      'if systemctl is-active firewalld >/dev/null 2>&1; then',
      ...firewalldRules,
      "  firewall-cmd --reload >/dev/null 2>&1 || true",
      '  echo "firewalld=updated"; changed=1',
      "fi",
      'echo "changed=$changed"',
    ].join("\n");
    const output = await this.execOutput(script, { label: "配置防火墙规则" });
    const changed = output.includes("changed=1");
    const tcpLabel = tcpPorts.join("、");
    const turnLabel =
      this.turnReady && this.ports.turnPort > 0
        ? `、TCP/UDP ${this.ports.turnPort}${relay ? `、UDP ${this.ports.relayMin}-${this.ports.relayMax}` : ""}`
        : "";
    this.complete(
      "firewall",
      changed
        ? `已放行 TCP ${tcpLabel}${turnLabel}，SSH 已启用连接频率限制 · 云安全组仍需放行同样端口`
        : `未检测到启用的本机防火墙 · 请确认云安全组放行 TCP ${tcpLabel}${turnLabel}`,
    );
  }

  private async configureDefense(): Promise<void> {
    this.begin("defense");
    const sysctl = [
      "# managed by ruodao-remote",
      "net.ipv4.tcp_syncookies = 1",
      "net.ipv4.conf.all.rp_filter = 1",
      "net.ipv4.conf.all.accept_redirects = 0",
      "net.ipv4.conf.all.send_redirects = 0",
      "net.ipv6.conf.all.accept_redirects = 0",
      "net.ipv4.icmp_echo_ignore_broadcasts = 1",
      "net.ipv4.conf.all.log_martians = 1",
      "net.ipv4.tcp_max_syn_backlog = 4096",
      "net.core.somaxconn = 4096",
      "kernel.kptr_restrict = 2",
      "kernel.dmesg_restrict = 1",
      "fs.protected_hardlinks = 1",
      "fs.protected_symlinks = 1",
      "",
    ].join("\n");
    const sysctlTmp = `${this.remoteDir}/99-ruodao-remote.conf`;
    await this.uploadContent(sysctl, sysctlTmp);
    await this.exec(
      [
        `install -o root -g root -m 0644 ${sysctlTmp} ${SYSCTL_FILE}`,
        `sysctl -p ${SYSCTL_FILE} >/dev/null 2>&1 || true`,
        `install -d -o ruodao -g ruodao -m 0750 ${DATA_DIR}`,
        `touch ${SECURITY_LOG}`,
        `chown ruodao:ruodao ${SECURITY_LOG}`,
        `chmod 0640 ${SECURITY_LOG}`,
      ].join(" && "),
      { label: "应用内核网络防护", ignoreExit: true },
    );

    let fail2banReady = false;
    const existing = await this.execOutput("command -v fail2ban-client || true", {
      label: "检查 fail2ban",
      sudo: false,
    });
    if (existing) {
      fail2banReady = true;
    } else {
      try {
        await this.installCommand("fail2ban", "安装 fail2ban", 300_000);
        fail2banReady = true;
      } catch (error) {
        this.log(`fail2ban 安装失败：${friendlyMessage(error)}`, "stderr");
      }
    }

    if (fail2banReady) {
      const filter = [
        "# managed by ruodao-remote",
        "[Definition]",
        'failregex = ^\\{"ts":"[^"]+","event":"security\\.(?:admin-login-failed|admin-login-locked|admin-login-rate-limited|http-rate-limit|origin-rejected|ban)","ip":"<HOST>"',
        "ignoreregex =",
        "",
      ].join("\n");
      const jail = [
        "# managed by ruodao-remote",
        "[ruodao-security]",
        "enabled = true",
        "filter = ruodao-security",
        `logpath = ${SECURITY_LOG}`,
        "backend = auto",
        "maxretry = 6",
        "findtime = 10m",
        "bantime = 1h",
        "bantime.increment = true",
        "bantime.factor = 2",
        "bantime.maxtime = 1w",
        "ignoreip = 127.0.0.1/8 ::1",
        "",
      ].join("\n");
      const filterTmp = `${this.remoteDir}/ruodao-security.conf`;
      const jailTmp = `${this.remoteDir}/ruodao-security.local`;
      await this.uploadContent(filter, filterTmp);
      await this.uploadContent(jail, jailTmp);
      const output = await this.execOutput(
        [
          `install -o root -g root -m 0644 ${filterTmp} ${FAIL2BAN_FILTER}`,
          `install -o root -g root -m 0644 ${jailTmp} ${FAIL2BAN_JAIL}`,
          "if fail2ban-client -t >/tmp/ruodao-f2b-test 2>&1; then",
          "  systemctl enable fail2ban >/dev/null 2>&1 || true",
          "  systemctl restart fail2ban",
          "  sleep 1",
          "  systemctl is-active --quiet fail2ban && echo 'fail2ban=active' || echo 'fail2ban=inactive'",
          "else",
          `  rm -f ${FAIL2BAN_FILTER} ${FAIL2BAN_JAIL}`,
          "  systemctl restart fail2ban >/dev/null 2>&1 || true",
          "  cat /tmp/ruodao-f2b-test",
          "  echo 'fail2ban=invalid'",
          "fi",
        ].join("\n"),
        { label: "启用 fail2ban 自动封禁", timeoutMs: 180_000, ignoreExit: true },
      );
      if (!output.includes("fail2ban=active")) {
        fail2banReady = false;
        this.log("fail2ban 配置未通过校验，已回退到原有配置；连接防护仍由服务端限流与 ufw 限速提供。", "stderr");
      }
    }

    this.complete(
      "defense",
      `内核网络防护已启用 · SSH 连接限速${
        fail2banReady ? " · fail2ban 已自动封禁暴力破解 IP" : " · fail2ban 不可用"
      }`,
    );
  }

  private async waitPublicHealth(): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 180_000;
    let attempt = 0;
    let lastError = "";
    while (Date.now() < deadline) {
      this.throwIfCancelled();
      attempt += 1;
      try {
        const response = await fetch(`${this.publicUrl}/health`, {
          headers: { "x-ruodao-health": this.healthToken },
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          if (data.name === "ruodao-remote-server") return data;
          lastError = "健康接口返回了未知服务";
        } else {
          lastError = `HTTP ${response.status}`;
        }
      } catch (error) {
        lastError = friendlyMessage(error);
      }
      if (attempt === 1 || attempt % 5 === 0) {
        this.log(`等待 HTTPS 证书与公网访问就绪…（${lastError || "正在申请证书"}）`, "stderr");
      }
      await delay(3000);
    }
    const publicPorts = [this.ports.entryPort, this.ports.redirectPort]
      .filter((port) => port > 0)
      .join(" 与 ");
    if (!this.ports.redirectPort) {
      throw new Error(
        `HTTPS 地址 ${this.publicUrl} 访问失败。请检查：1) 域名 ${this.siteHost} 是否解析到本服务器；2) 云安全组是否放行 TCP 443；3) 443 是否能被公网访问（80 属于其他服务，证书只能通过 TLS-ALPN 验证）。`,
      );
    }
    throw new Error(
      `HTTPS 地址 ${this.publicUrl} 访问失败。请检查：1) 域名解析是否正确；2) 云安全组是否放行 TCP ${publicPorts}；3) 端口是否能被公网访问。`,
    );
  }

  private async verify(): Promise<void> {
    this.begin("verify");
    const health = await this.waitPublicHealth();
    this.throwIfCancelled();
    this.log(`公网健康检查通过：${JSON.stringify(health)}`);
    const adminApi = adminApiPath(this.adminPath);
    let loginResponse: Response;
    try {
      loginResponse = await fetch(`${this.publicUrl}${adminApi}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: this.adminPassword }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new Error(`管理员登录请求失败：${friendlyMessage(error)}`);
    }
    if (loginResponse.status !== 200) {
      throw new Error("服务已上线，但管理员密码校验失败。请重新部署以修复配置。");
    }
    const loginData = (await loginResponse.json()) as Record<string, unknown>;
    const token = typeof loginData.token === "string" ? loginData.token : "";
    if (!token) throw new Error("管理员登录接口未返回令牌。");
    if (!this.reusedPassword && this.config.registrationMode === "invite") {
      try {
        const inviteResponse = await fetch(`${this.publicUrl}${adminApi}/invites`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ label: "部署默认邀请码", maxUses: 20, expiresInDays: 7 }),
          signal: AbortSignal.timeout(12_000),
        });
        if (inviteResponse.ok) {
          const inviteData = (await inviteResponse.json()) as {
            invite?: { code?: string };
          };
          if (inviteData.invite?.code) {
            this.inviteCode = inviteData.invite.code;
            this.log(`已创建默认邀请码：${this.inviteCode}`);
          }
        }
      } catch {
        // Invite creation is a convenience, not a requirement.
      }
    }
    this.complete(
      "verify",
      `HTTPS（TCP ${this.ports.entryPort}）、隐藏管理入口与免费证书均已验证`,
    );
  }

  private async finish(): Promise<void> {
    this.begin("finish");
    updateSettings({
      serverUrl: this.publicUrl,
      ...(this.inviteCode ? { inviteCode: this.inviteCode } : {}),
    });
    const saved = saveAdminSecret(this.publicUrl, this.adminPassword, {
      adminPath: this.adminPath,
      healthToken: this.healthToken,
    });
    this.complete(
      "finish",
      saved.persisted
        ? "服务器地址、隐藏管理入口与管理员密码已写入本机加密存储"
        : "服务器地址已保存（系统加密存储不可用，密码未保存）",
    );
    this.flushLogs();
    this.emit({
      type: "done",
      result: {
        serverUrl: this.publicUrl,
        host: this.config.host,
        domain: this.siteHost,
        adminPassword: this.adminPassword,
        adminPersisted: saved.persisted,
        secure: this.secure,
        turn: this.turnReady,
        version: this.serverVersion,
        reusedPassword: this.reusedPassword,
        inviteCode: this.inviteCode,
        registrationMode: this.config.registrationMode,
        publicPort: this.ports.entryPort,
        redirectPort: this.ports.redirectPort,
        internalPort: this.ports.internalPort,
        turnPort: this.ports.turnPort,
        relayMin: this.ports.relayMin,
        relayMax: this.ports.relayMax,
        adminPath: this.adminPath,
      },
    });
  }
}

export function startDeploy(
  input: unknown,
  emit: (event: DeployEvent) => void,
): { runId: string } {
  if (activeRun) throw new Error("已有部署任务正在进行，请等待完成或取消。");
  const config = parseConfig(input);
  const run = new DeployRun(config, emit);
  activeRun = run;
  void run.run().catch((error: unknown) => {
    // Defensive: run() handles its own failures.
    emit({ type: "error", message: friendlyMessage(error), step: null, log: [] });
  });
  return { runId: run.id };
}

export function confirmDeployHostKey(input: unknown): { ok: true } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const runId = typeof raw.runId === "string" ? raw.runId : "";
  if (activeRun && activeRun.id === runId) {
    activeRun.confirmHostKey(raw.accept === true);
  }
  return { ok: true };
}

export function cancelDeploy(input: unknown): { ok: true } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const runId = typeof raw.runId === "string" ? raw.runId : "";
  if (activeRun && activeRun.id === runId) activeRun.cancel();
  return { ok: true };
}

export function shutdownDeploy(): void {
  if (activeRun) activeRun.cancel();
}
