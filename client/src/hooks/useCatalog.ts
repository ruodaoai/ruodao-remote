import { useEffect, useRef, useState } from "react";
import {
  SignalingClient,
  ServerAccessError,
  detectPlatform,
  signalUrl,
  type AccessRejectReason,
  type CatalogHost,
  type PeerProfile,
  type ServerMessage,
} from "../lib/signaling";
import { accessErrorMessage, connectionErrorMessage } from "../lib/messages";
import type { AppInfo, Settings, ToastKind } from "../types";

export type CatalogStatus = "idle" | "loading" | "ready" | "pending" | "error";

export interface CatalogRequestState {
  hostDeviceId: string;
  hostName: string;
  requestId: string | null;
  expiresAt: number;
}

interface CatalogEngine {
  client: SignalingClient | null;
  generation: number;
  retry: number | null;
  requestTimer: number | null;
  request: CatalogRequestState | null;
  enabled: boolean;
}

function createEngine(): CatalogEngine {
  return {
    client: null,
    generation: 0,
    retry: null,
    requestTimer: null,
    request: null,
    enabled: false,
  };
}

export function useCatalog(
  settings: Settings | null,
  appInfo: AppInfo | null,
  enabled: boolean,
  notify: (message: string, kind?: ToastKind) => void,
  onAccepted: (host: PeerProfile, token: string) => void,
) {
  const [hosts, setHosts] = useState<CatalogHost[]>([]);
  const [status, setStatus] = useState<CatalogStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [accessIssue, setAccessIssue] = useState<AccessRejectReason | null>(null);
  const [request, setRequest] = useState<CatalogRequestState | null>(null);

  const engineRef = useRef<CatalogEngine>(createEngine());
  const settingsRef = useRef<Settings | null>(settings);
  settingsRef.current = settings;
  const appInfoRef = useRef<AppInfo | null>(appInfo);
  appInfoRef.current = appInfo;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const acceptedRef = useRef(onAccepted);
  acceptedRef.current = onAccepted;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const mountedRef = useRef(true);
  const statusRef = useRef<CatalogStatus>("idle");
  statusRef.current = status;

  function setCatalogStatus(next: CatalogStatus): void {
    if (!mountedRef.current) return;
    setStatus(next);
  }

  function clearRetry(): void {
    const engine = engineRef.current;
    if (engine.retry !== null) {
      window.clearTimeout(engine.retry);
      engine.retry = null;
    }
  }

  function clearRequestTimer(): void {
    const engine = engineRef.current;
    if (engine.requestTimer !== null) {
      window.clearTimeout(engine.requestTimer);
      engine.requestTimer = null;
    }
  }

  function clearRequest(): void {
    const engine = engineRef.current;
    clearRequestTimer();
    engine.request = null;
    if (mountedRef.current) setRequest(null);
  }

  function armRequestTimer(deadline: number): void {
    const engine = engineRef.current;
    clearRequestTimer();
    const delay = Math.max(500, deadline - Date.now() + 500);
    engine.requestTimer = window.setTimeout(() => {
      if (!engine.request) return;
      const name = engine.request.hostName;
      clearRequest();
      setError(`向“${name}”发送的申请已超时，请重新申请。`);
      notifyRef.current("远控申请已超时", "info");
    }, delay);
  }

  function stopClient(): void {
    const engine = engineRef.current;
    engine.generation += 1;
    clearRetry();
    clearRequest();
    if (engine.client) {
      engine.client.close();
      engine.client = null;
    }
  }

  function scheduleRetry(gen: number, delay = 3000): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || !enabledRef.current) return;
    if (engine.retry !== null) window.clearTimeout(engine.retry);
    engine.retry = window.setTimeout(() => {
      engine.retry = null;
      if (gen !== engine.generation || !enabledRef.current) return;
      startClient();
    }, delay);
  }

  function handleSocketClose(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    engine.client = null;
    const hadRequest = Boolean(engine.request);
    clearRequest();
    setCatalogStatus("error");
    setError(
      hadRequest
        ? "与服务器的连接已断开，申请已取消，请重新申请。"
        : "与服务器的连接已断开，正在重试…",
    );
    scheduleRetry(gen);
  }

  function handleMessage(gen: number, message: ServerMessage): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    switch (message.type) {
      case "catalog.snapshot":
      case "catalog.updated":
        setHosts(message.hosts);
        setCatalogStatus("ready");
        break;
      case "controller.request-sent": {
        if (!engine.request) break;
        const next: CatalogRequestState = {
          ...engine.request,
          requestId: message.requestId,
          expiresAt: message.expiresAt,
        };
        engine.request = next;
        setRequest(next);
        armRequestTimer(message.expiresAt);
        break;
      }
      case "controller.request-accepted": {
        clearRequest();
        if (!mountedRef.current) return;
        setError(null);
        notifyRef.current(`“${message.host.name}”已同意远控申请`, "success");
        acceptedRef.current(message.host, message.token);
        break;
      }
      case "controller.request-denied":
        clearRequest();
        setError(message.message);
        notifyRef.current(message.message, "error");
        break;
      case "client.rejected": {
        clearRequest();
        const text = accessErrorMessage(message.reason, message.message);
        setAccessIssue(message.reason);
        setError(text);
        setCatalogStatus("error");
        break;
      }
      case "error":
        setError(message.message);
        break;
      default:
        break;
    }
  }

  async function openCatalog(gen: number): Promise<void> {
    const engine = engineRef.current;
    const current = settingsRef.current;
    if (!current) return;
    let client: SignalingClient;
    try {
      client = new SignalingClient(signalUrl(current.serverUrl), {
        onMessage: (message) => handleMessage(gen, message),
        onClose: () => handleSocketClose(gen),
      });
    } catch (err) {
      setError(connectionErrorMessage(err));
      setCatalogStatus("error");
      return;
    }
    engine.client = client;
    try {
      await client.open(8000);
    } catch (err) {
      if (engine.client === client) engine.client = null;
      client.close();
      if (gen !== engine.generation) return;
      setError(connectionErrorMessage(err));
      setCatalogStatus("error");
      scheduleRetry(gen);
      return;
    }
    if (gen !== engine.generation) {
      client.close();
      return;
    }

    let welcome;
    try {
      welcome = await client.authenticate({
        deviceId: current.deviceId,
        deviceName: current.deviceName,
        version: appInfoRef.current?.version ?? "0.1.0",
        platform: detectPlatform(),
        inviteCode: current.inviteCode || undefined,
      });
    } catch (err) {
      if (engine.client === client) engine.client = null;
      client.close();
      if (gen !== engine.generation) return;
      if (err instanceof ServerAccessError && err.reason !== "network") {
        setAccessIssue(err.reason);
        setError(accessErrorMessage(err.reason, err.message));
        setCatalogStatus("error");
        return;
      }
      setError(connectionErrorMessage(err));
      setCatalogStatus("error");
      scheduleRetry(gen);
      return;
    }
    if (gen !== engine.generation) return;
    setAccessIssue(null);
    if (welcome.device.status !== "approved") {
      setCatalogStatus("pending");
      setError("此客户端正在等待管理员批准，批准后即可查看本服共享设备。");
      scheduleRetry(gen, 8000);
      return;
    }
    setCatalogStatus("ready");
  }

  function startClient(): void {
    const engine = engineRef.current;
    if (!enabledRef.current || !settingsRef.current) return;
    stopClient();
    engine.generation += 1;
    const gen = engine.generation;
    setError(null);
    setCatalogStatus("loading");
    void openCatalog(gen);
  }

  function requestControl(host: CatalogHost): void {
    const engine = engineRef.current;
    if (engine.request) {
      notifyRef.current("已有一条待处理的申请", "info");
      return;
    }
    const client = engine.client;
    if (!client?.isOpen || statusRef.current !== "ready") {
      notifyRef.current("共享列表尚未就绪，请稍后再试", "info");
      return;
    }
    const next: CatalogRequestState = {
      hostDeviceId: host.deviceId,
      hostName: host.name,
      requestId: null,
      expiresAt: Date.now() + 60_000,
    };
    engine.request = next;
    setRequest(next);
    setError(null);
    if (!client.send({ type: "controller.request", hostDeviceId: host.deviceId })) {
      clearRequest();
      setError("无法发送远控申请，请检查服务器连接。");
    }
  }

  function cancelRequest(): void {
    const engine = engineRef.current;
    if (!engine.request) return;
    engine.client?.send({ type: "controller.disconnect" });
    clearRequest();
    setError(null);
    notifyRef.current("已取消远控申请", "info");
  }

  function refresh(): void {
    if (!enabledRef.current) return;
    setHosts([]);
    startClient();
  }

  useEffect(() => {
    if (!enabled) {
      stopClient();
      setCatalogStatus("idle");
      setHosts([]);
      setError(null);
      setAccessIssue(null);
      return;
    }
    startClient();
    return () => {
      stopClient();
    };
  }, [enabled, settings?.serverUrl, settings?.deviceId, settings?.inviteCode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const engine = engineRef.current;
      engine.generation += 1;
      if (engine.retry !== null) window.clearTimeout(engine.retry);
      if (engine.requestTimer !== null) window.clearTimeout(engine.requestTimer);
      engine.client?.close();
    };
  }, []);

  return {
    hosts,
    status,
    error,
    accessIssue,
    request,
    requestControl,
    cancelRequest,
    refresh,
  };
}
