import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Client, type SFTPWrapper } from "ssh2";

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  sudo?: boolean;
  timeoutMs?: number;
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
}

const OUTPUT_LIMIT = 400_000;

export class HostKeyMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super("服务器 SSH 指纹与上次记录不一致");
    this.name = "HostKeyMismatchError";
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function fingerprintDisplay(hex: string): string {
  const base64 = Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "");
  return `SHA256:${base64}`;
}

function friendlyError(error: Error): string {
  const code = (error as Error & { code?: string }).code ?? "";
  const message = error.message || String(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "无法解析服务器地址，请检查 IP 或域名。";
  if (code === "ECONNREFUSED") return "服务器拒绝了连接，请确认 SSH 端口开放且 sshd 正在运行。";
  if (code === "ETIMEDOUT") return "连接服务器超时，请检查安全组与防火墙是否放行 SSH 端口。";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "无法到达服务器，请检查网络。";
  if (/authentication methods failed/i.test(message)) return "SSH 用户名、密码或密钥不正确。";
  return message;
}

function connectClient(target: SshTarget, fingerprint: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let actual = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (actual && actual !== fingerprint) {
        reject(new HostKeyMismatchError(fingerprint, actual));
        return;
      }
      reject(new Error(friendlyError(error)));
    };
    const options: Parameters<Client["connect"]>[0] = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: 25_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 4,
      hostHash: "sha256",
      hostVerifier: (hash: string) => {
        actual = hash;
        return hash === fingerprint;
      },
    };
    if (target.privateKeyPath) {
      try {
        options.privateKey = readFileSync(target.privateKeyPath);
        if (target.passphrase) options.passphrase = target.passphrase;
      } catch (error) {
        reject(new Error(`无法读取 SSH 私钥：${error instanceof Error ? error.message : String(error)}`));
        return;
      }
    } else if (target.password) {
      options.password = target.password;
    }
    client.once("ready", () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });
    client.once("error", fail);
    try {
      client.connect(options);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function probeHostKey(
  target: SshTarget,
  timeoutMs = 20_000,
): Promise<{ hex: string; display: string }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let captured = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error("读取服务器指纹超时，请检查服务器地址与 SSH 端口。"));
    }, timeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end();
      if (captured) resolve({ hex: captured, display: fingerprintDisplay(captured) });
      else reject(new Error("无法读取服务器 SSH 指纹。"));
    };
    client.once("error", (error) => {
      if (captured) {
        finish();
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(friendlyError(error)));
    });
    client.once("close", () => {
      if (!captured && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("与服务器的连接被提前关闭。"));
        return;
      }
      finish();
    });
    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password || randomBytes(12).toString("hex"),
        readyTimeout: timeoutMs,
        hostHash: "sha256",
        hostVerifier: (hash: string) => {
          captured = hash;
          return false;
        },
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? new Error(friendlyError(error)) : new Error(String(error)));
    }
  });
}

export class SshSession {
  private sudoMode: "root" | "nopass" | "password" | "unchecked" = "unchecked";
  private closed = false;

  private constructor(
    private readonly client: Client,
    private readonly password: string,
    readonly fingerprint: string,
  ) {}

  static async open(
    target: SshTarget,
    fingerprint: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void,
  ): Promise<SshSession> {
    const client = await connectClient(target, fingerprint);
    const session = new SshSession(client, target.password ?? "", fingerprint);
    client.once("close", () => {
      session.closed = true;
    });
    try {
      await session.detectSudo(onLog);
    } catch (error) {
      session.close();
      throw error;
    }
    return session;
  }

  private async detectSudo(onLog?: ExecOptions["onLog"]): Promise<void> {
    const who = await this.exec("id -u", { timeoutMs: 12_000, onLog });
    if (who.code !== 0) throw new Error("无法确认登录账号权限。");
    if (who.stdout.trim() === "0") {
      this.sudoMode = "root";
      return;
    }
    const test = await this.exec("sudo -n true", { timeoutMs: 12_000, onLog });
    if (test.code === 0) {
      this.sudoMode = "nopass";
      return;
    }
    if (this.password) {
      this.sudoMode = "password";
      return;
    }
    throw new Error(
      "该账号需要 sudo 密码，但当前使用 SSH 私钥登录且没有提供密码。请改用 root 账号或密码登录。",
    );
  }

  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.closed) return Promise.reject(new Error("SSH 连接已断开。"));
    const timeoutMs = options.timeoutMs ?? 180_000;
    const seconds = Math.max(5, Math.ceil(timeoutMs / 1000));
    const needSudo = options.sudo === true && this.sudoMode !== "root";
    let prefix = "";
    if (needSudo) {
      if (this.sudoMode === "unchecked") {
        return Promise.reject(new Error("SSH 权限尚未就绪。"));
      }
      prefix = this.sudoMode === "nopass" ? "sudo -n " : "sudo -S -p '' ";
    }
    const script = `export DEBIAN_FRONTEND=noninteractive LANG=C; ${command}`;
    const remote = `${prefix}timeout ${seconds} bash -c ${shellQuote(script)}`;
    const onLog = options.onLog;

    return new Promise((resolve, reject) => {
      this.client.exec(remote, { pty: false }, (error, stream) => {
        if (error) {
          reject(new Error(friendlyError(error)));
          return;
        }
        let stdout = "";
        let stderr = "";
        let pending = "";
        let pendingError = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            stream.close();
          } catch {
            // channel already gone
          }
        }, timeoutMs + 5_000);

        const flush = (stream: "stdout" | "stderr") => {
          if (!onLog) return;
          const buffer = stream === "stdout" ? pending : pendingError;
          if (!buffer) return;
          for (const line of buffer.split(/\r?\n/)) {
            const text = line.trimEnd();
            if (text) onLog(text, stream);
          }
          if (stream === "stdout") pending = "";
          else pendingError = "";
        };

        stream.on("data", (chunk: Buffer) => {
          const text = String(chunk);
          if (stdout.length < OUTPUT_LIMIT) stdout += text;
          pending += text;
          const newline = pending.lastIndexOf("\n");
          if (newline >= 0) {
            const complete = pending.slice(0, newline + 1);
            pending = pending.slice(newline + 1);
            if (onLog) {
              for (const line of complete.split(/\r?\n/)) {
                const value = line.trimEnd();
                if (value) onLog(value, "stdout");
              }
            }
          }
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          const text = String(chunk);
          if (stderr.length < OUTPUT_LIMIT) stderr += text;
          pendingError += text;
          const newline = pendingError.lastIndexOf("\n");
          if (newline >= 0) {
            const complete = pendingError.slice(0, newline + 1);
            pendingError = pendingError.slice(newline + 1);
            if (onLog) {
              for (const line of complete.split(/\r?\n/)) {
                const value = line.trimEnd();
                if (value) onLog(value, "stderr");
              }
            }
          }
        });
        if (needSudo && this.sudoMode === "password") {
          stream.stdin.write(`${this.password}\n`);
        }
        stream.stdin.end();
        stream.on("close", (code: number | null, signal: string) => {
          clearTimeout(timer);
          flush("stdout");
          flush("stderr");
          if (timedOut) {
            reject(new Error(`远程命令执行超时（${Math.round(timeoutMs / 1000)} 秒）。`));
            return;
          }
          if (signal === "TERM" && code === 124) {
            reject(new Error("远程命令执行超时。"));
            return;
          }
          resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
        });
        stream.on("error", (streamError: Error) => {
          clearTimeout(timer);
          reject(new Error(friendlyError(streamError)));
        });
      });
    });
  }

  async uploadContent(content: string | Buffer, remotePath: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath, { mode: 0o600 });
      stream.once("close", () => resolve());
      stream.once("error", (error: Error) => {
        sftp.end();
        reject(error);
      });
      stream.end(content);
    });
    sftp.end();
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => {
        sftp.end();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) reject(new Error(`无法建立 SFTP 通道：${error.message}`));
        else resolve(sftp);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.client.end();
    } catch {
      // already closed
    }
  }
}
