export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface PeerProfile {
  name: string;
  platform: string;
  ip?: string;
}

export interface SessionStatsPayload {
  kbps: number;
  fps: number;
  width: number;
  height: number;
  rttMs: number;
  jitterMs: number;
  lossPct: number;
}

export type SessionEventKind = "danger" | "clipboard" | "info";

export interface ServerStatsInfo {
  at: number;
  bandwidthInKbps: number;
  bandwidthOutKbps: number;
  wsInKbps: number;
  wsOutKbps: number;
  sessions: number;
  peers: number;
  load1: number;
  cpuPct: number;
  lagMs: number;
  memoryPct: number;
  uptimeSeconds: number;
}

export interface CatalogHost {
  deviceId: string;
  name: string;
  platform: string;
  note: string;
  busy: boolean;
  publishedAt: number;
}

export interface HostControlRequestInfo {
  id: string;
  controllerName: string;
  platform: string;
  expiresAt: number;
}

export type ControlDenyReason =
  | "not-found"
  | "not-published"
  | "busy"
  | "self"
  | "rate-limited"
  | "device-pending"
  | "device-blocked"
  | "already-session"
  | "already-pending"
  | "expired"
  | "denied"
  | "unpublished"
  | "host-offline"
  | "token-invalid"
  | "token-expired"
  | "cancelled";

export type DeviceStatus = "pending" | "approved" | "blocked";

export type RegistrationMode = "invite" | "approval" | "open";

export type ClientRejectReason =
  | "invite-required"
  | "invite-invalid"
  | "blocked"
  | "device-pending"
  | "invalid-hello"
  | "admin-disconnect";

export interface ClientHelloInput {
  deviceId: string;
  deviceName: string;
  version: string;
  platform: string;
  inviteCode?: string;
}

export interface WelcomeInfo {
  type: "client.welcome";
  device: { id: string; name: string; status: DeviceStatus };
  registrationMode: RegistrationMode;
  serverName: string;
  publicUrl: string;
}

export type ClientMessage =
  | {
      type: "client.hello";
      deviceId: string;
      deviceName: string;
      version: string;
      platform: string;
      inviteCode?: string;
    }
  | {
      type: "host.register";
      requestedCode?: string;
      keySalt: string;
      keyHash: string;
      deviceName: string;
      platform: string;
    }
  | { type: "host.update-key"; keySalt: string; keyHash: string }
  | { type: "host.unregister" }
  | { type: "host.heartbeat" }
  | { type: "controller.lookup"; code: string }
  | {
      type: "controller.connect";
      code: string;
      keyHash: string;
      controllerName: string;
      platform: string;
    }
  | { type: "controller.disconnect" }
  | { type: "host.publish"; published: boolean; note?: string }
  | { type: "host.control-decision"; requestId: string; accept: boolean }
  | { type: "controller.request"; hostDeviceId: string }
  | {
      type: "controller.connect-token";
      token: string;
      controllerName: string;
      platform: string;
    }
  | { type: "session.stats"; stats: SessionStatsPayload }
  | { type: "session.event"; kind: SessionEventKind; action: string; detail?: string }
  | { type: "signal"; data: unknown };

export type RejectReason =
  | "not-found"
  | "invalid-key"
  | "busy"
  | "rate-limited"
  | "self"
  | "host-offline"
  | "device-pending"
  | "device-blocked";

export type ServerMessage =
  | WelcomeInfo
  | { type: "client.rejected"; reason: ClientRejectReason; message: string }
  | { type: "host.registered"; code: string; iceServers: IceServer[] }
  | { type: "host.key-updated"; code: string }
  | {
      type: "host.paired";
      sessionId: string;
      controller: PeerProfile;
      iceServers: IceServer[];
    }
  | {
      type: "controller.challenge";
      code: string;
      keySalt: string;
      host: PeerProfile;
    }
  | {
      type: "controller.paired";
      sessionId: string;
      host: PeerProfile;
      iceServers: IceServer[];
    }
  | { type: "controller.rejected"; reason: RejectReason; message: string }
  | { type: "host.publish-state"; published: boolean; note: string }
  | { type: "catalog.snapshot"; hosts: CatalogHost[] }
  | { type: "catalog.updated"; hosts: CatalogHost[] }
  | { type: "host.control-request"; request: HostControlRequestInfo }
  | { type: "host.control-approved"; requestId: string; expiresAt: number }
  | { type: "host.control-closed"; requestId: string; reason: string }
  | {
      type: "controller.request-sent";
      requestId: string;
      host: PeerProfile;
      expiresAt: number;
    }
  | {
      type: "controller.request-accepted";
      requestId: string;
      token: string;
      host: PeerProfile;
      expiresAt: number;
    }
  | {
      type: "controller.request-denied";
      requestId: string;
      reason: ControlDenyReason;
      message: string;
    }
  | { type: "signal"; data: unknown }
  | { type: "peer.left"; reason: string }
  | { type: "server.stats"; stats: ServerStatsInfo }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export function signalUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("服务器地址格式不正确");
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("服务器地址协议不支持");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = !pathname || pathname === "/ws" ? "/ws" : `${pathname}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/i.test(ua)) return "darwin";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

export interface SignalingHandlers {
  onMessage: (message: ServerMessage) => void;
  onClose: (reason: string) => void;
}

export type AccessRejectReason = ClientRejectReason | "network";

export class ServerAccessError extends Error {
  constructor(
    readonly reason: AccessRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "ServerAccessError";
  }
}

interface AuthWaiter {
  resolve: (welcome: WelcomeInfo) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private opened = false;
  private disposed = false;
  private authWaiter: AuthWaiter | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: SignalingHandlers,
  ) {}

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  open(timeoutMs = 8000): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    this.disposed = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch {
        reject(new Error("无法连接远控服务器"));
        return;
      }
      this.socket = ws;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("连接服务器超时"));
      }, timeoutMs);

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error(message));
      };

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.opened = true;
        resolve();
      };
      ws.onerror = () => fail("无法连接远控服务器");
      ws.onclose = (event) => {
        window.clearTimeout(timer);
        const wasOpen = this.opened;
        this.opened = false;
        this.socket = null;
        if (!settled) {
          settled = true;
          reject(new Error("无法连接远控服务器"));
          return;
        }
        const waiter = this.authWaiter;
        if (waiter) {
          this.authWaiter = null;
          window.clearTimeout(waiter.timer);
          waiter.reject(new ServerAccessError("network", "与服务器的连接已断开，请稍后重试。"));
          return;
        }
        if (wasOpen && !this.disposed) {
          this.handlers.onClose(event.reason || "连接已断开");
        }
      };
      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (!message || typeof message.type !== "string") return;
        const waiter = this.authWaiter;
        if (waiter) {
          if (message.type === "client.welcome") {
            this.authWaiter = null;
            window.clearTimeout(waiter.timer);
            waiter.resolve(message);
            return;
          }
          if (message.type === "client.rejected") {
            this.authWaiter = null;
            window.clearTimeout(waiter.timer);
            waiter.reject(new ServerAccessError(message.reason, message.message));
            return;
          }
          if (message.type === "error" && message.code === "unknown-type") {
            this.authWaiter = null;
            window.clearTimeout(waiter.timer);
            waiter.reject(
              new ServerAccessError(
                "invalid-hello",
                "服务器版本过旧，请先升级服务端后再连接。",
              ),
            );
            return;
          }
        }
        this.handlers.onMessage(message);
      };
    });
  }

  authenticate(hello: ClientHelloInput, timeoutMs = 8000): Promise<WelcomeInfo> {
    if (!this.isOpen) {
      return Promise.reject(new ServerAccessError("network", "无法连接远控服务器"));
    }
    return new Promise((resolve, reject) => {
      if (this.authWaiter) {
        reject(new ServerAccessError("network", "客户端接入正在进行中，请稍候。"));
        return;
      }
      const timer = window.setTimeout(() => {
        this.authWaiter = null;
        reject(new ServerAccessError("network", "客户端接入超时，请稍后再试。"));
      }, timeoutMs);
      this.authWaiter = { resolve, reject, timer };
      const sent = this.send({
        type: "client.hello",
        deviceId: hello.deviceId,
        deviceName: hello.deviceName,
        version: hello.version,
        platform: hello.platform,
        ...(hello.inviteCode ? { inviteCode: hello.inviteCode } : {}),
      });
      if (!sent) {
        this.authWaiter = null;
        window.clearTimeout(timer);
        reject(new ServerAccessError("network", "无法连接远控服务器"));
      }
    });
  }

  send(message: ClientMessage): boolean {
    if (!this.isOpen) return false;
    try {
      this.socket?.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.disposed = true;
    this.opened = false;
    if (this.authWaiter) {
      const waiter = this.authWaiter;
      this.authWaiter = null;
      window.clearTimeout(waiter.timer);
      waiter.reject(new ServerAccessError("network", "连接已取消"));
    }
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }
}
