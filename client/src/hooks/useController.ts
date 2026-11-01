import { useEffect, useRef, useState } from "react";
import { deriveKeyHash, isCompleteKey, normalizeCodeInput, normalizeKeyInput } from "../lib/key";
import {
  SignalingClient,
  ServerAccessError,
  detectPlatform,
  signalUrl,
  type AccessRejectReason,
  type PeerProfile,
  type ServerMessage,
} from "../lib/signaling";
import {
  collectStats,
  isSignalData,
  toIceServers,
  type SignalData,
  type StatsSample,
} from "../lib/webrtc";
import {
  accessErrorMessage,
  connectionErrorMessage,
  peerLeftMessage,
  protocolErrorMessage,
  rejectMessage,
} from "../lib/messages";
import { isRendererInputEvent, type InputEventPayload } from "../lib/input";
import { dangerActionLabel } from "../lib/danger";
import {
  clipboardKey,
  encodeSessionMessage,
  parseSessionFrame,
  sanitizeChatText,
  type SessionMessage,
} from "../lib/session-channel";
import type {
  AppInfo,
  QualityPreset,
  ServerStats,
  SessionChatMessage,
  SessionLogDangerEvent,
  SessionStats,
  Settings,
  ToastKind,
} from "../types";

import { t } from "../i18n";

export type ControllerPhase =
  | "idle"
  | "lookup"
  | "waiting"
  | "verifying"
  | "connecting"
  | "connected"
  | "error";

type PairedMessage = Extract<ServerMessage, { type: "controller.paired" }>;

interface ControllerLogSession {
  sessionId: string;
  startedAt: number;
  peer: PeerProfile;
  dangerEvents: SessionLogDangerEvent[];
}

interface ControllerEngine {
  client: SignalingClient | null;
  peer: RTCPeerConnection | null;
  channel: RTCDataChannel | null;
  candidates: RTCIceCandidateInit[];
  pendingSignals: unknown[];
  statsTimer: number | null;
  approval: number | null;
  lastSample: StatsSample | null;
  generation: number;
  manual: boolean;
  phase: ControllerPhase;
  pending: { code: string; key: string } | null;
  inputPaused: boolean;
  clipboardEnabled: boolean;
  clipboardAllowed: boolean;
  clipboardTimer: number | null;
  clipboardBusy: boolean;
  clipboardMark: string;
  quality: QualityPreset;
  chatSeq: number;
  session: ControllerLogSession | null;
  lastStatsReportAt: number;
}

function createEngine(): ControllerEngine {
  return {
    client: null,
    peer: null,
    channel: null,
    candidates: [],
    pendingSignals: [],
    statsTimer: null,
    approval: null,
    lastSample: null,
    generation: 0,
    manual: false,
    phase: "idle",
    pending: null,
    inputPaused: false,
    clipboardEnabled: false,
    clipboardAllowed: false,
    clipboardTimer: null,
    clipboardBusy: false,
    clipboardMark: "",
    quality: "balanced",
    chatSeq: 0,
    session: null,
    lastStatsReportAt: 0,
  };
}

export function useController(
  settings: Settings | null,
  appInfo: AppInfo | null,
  notify: (message: string, kind?: ToastKind) => void,
) {
  const [phase, setPhaseState] = useState<ControllerPhase>("idle");
  const [hostName, setHostName] = useState<PeerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessIssue, setAccessIssue] = useState<AccessRejectReason | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [inputPaused, setInputPausedState] = useState(false);
  const [clipboardAllowed, setClipboardAllowedState] = useState(false);
  const [clipboardEnabled, setClipboardEnabledState] = useState(false);
  const [quality, setQualityState] = useState<QualityPreset>("balanced");
  const [chatMessages, setChatMessages] = useState<SessionChatMessage[]>([]);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(null);

  const engineRef = useRef<ControllerEngine>(createEngine());
  const settingsRef = useRef<Settings | null>(settings);
  settingsRef.current = settings;
  const appInfoRef = useRef<AppInfo | null>(appInfo);
  appInfoRef.current = appInfo;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  function setPhase(next: ControllerPhase): void {
    engineRef.current.phase = next;
    setPhaseState(next);
  }

  function finalizeSessionLog(reason: string): void {
    const engine = engineRef.current;
    const record = engine.session;
    if (!record) return;
    engine.session = null;
    void window.remote
      .appendSessionLog({
        startedAt: record.startedAt,
        durationMs: Math.max(0, Date.now() - record.startedAt),
        role: "controller",
        peerName: record.peer.name,
        peerIp: record.peer.ip ?? null,
        peerPlatform: record.peer.platform,
        sessionId: record.sessionId,
        reason,
        dangerEvents: record.dangerEvents,
      })
      .catch(() => {});
  }

  function noteDangerShortcut(action: string): void {
    const engine = engineRef.current;
    const session = engine.session;
    if (!session) return;
    const at = Date.now();
    const last = session.dangerEvents[session.dangerEvents.length - 1];
    if (last && last.action === action && at - last.at < 2500) return;
    session.dangerEvents.push({ at, action, label: dangerActionLabel(action) });
    if (session.dangerEvents.length > 50) {
      session.dangerEvents = session.dangerEvents.slice(-50);
    }
    engine.client?.send({ type: "session.event", kind: "danger", action });
  }

  function stopStats(): void {
    const engine = engineRef.current;
    if (engine.statsTimer !== null) {
      window.clearInterval(engine.statsTimer);
      engine.statsTimer = null;
    }
    engine.lastSample = null;
  }

  function startStats(gen: number, pc: RTCPeerConnection): void {
    const engine = engineRef.current;
    if (engine.statsTimer !== null) return;
    engine.statsTimer = window.setInterval(() => {
      if (gen !== engine.generation) return;
      void collectStats(pc, engine.lastSample).then((sample) => {
        if (!sample || gen !== engine.generation) return;
        engine.lastSample = sample;
        setStats(sample.stats);
        const now = Date.now();
        if (engine.session && now - engine.lastStatsReportAt >= 3000) {
          engine.lastStatsReportAt = now;
          engine.client?.send({ type: "session.stats", stats: { ...sample.stats } });
        }
      });
    }, 1000);
  }

  function teardownPeer(): void {
    const engine = engineRef.current;
    stopStats();
    stopClipboardTimer();
    engine.candidates = [];
    engine.pendingSignals = [];
    engine.clipboardBusy = false;
    engine.clipboardMark = "";
    engine.inputPaused = false;
    engine.clipboardEnabled = false;
    engine.clipboardAllowed = false;
    engine.chatSeq = 0;
    engine.lastStatsReportAt = 0;
    setInputPausedState(false);
    setClipboardEnabledState(false);
    setClipboardAllowedState(false);
    setChatMessages([]);
    if (engine.channel) {
      engine.channel.onopen = null;
      engine.channel.onclose = null;
      engine.channel.onmessage = null;
      engine.channel = null;
    }
    if (engine.peer) {
      engine.peer.ontrack = null;
      engine.peer.ondatachannel = null;
      engine.peer.onicecandidate = null;
      engine.peer.onconnectionstatechange = null;
      try {
        engine.peer.close();
      } catch {
        // ignore
      }
      engine.peer = null;
    }
    setStream(null);
    setStats(null);
    setChannelReady(false);
  }

  function closeClient(): void {
    const engine = engineRef.current;
    if (engine.client) {
      engine.client.close();
      engine.client = null;
    }
  }

  function clearApproval(): void {
    const engine = engineRef.current;
    if (engine.approval !== null) {
      window.clearInterval(engine.approval);
      engine.approval = null;
    }
  }

  function stopClipboardTimer(): void {
    const engine = engineRef.current;
    if (engine.clipboardTimer !== null) {
      window.clearInterval(engine.clipboardTimer);
      engine.clipboardTimer = null;
    }
  }

  function updateClipboardSync(): void {
    const engine = engineRef.current;
    const active =
      engine.clipboardEnabled &&
      engine.clipboardAllowed &&
      engine.channel?.readyState === "open";
    if (!active) {
      stopClipboardTimer();
      return;
    }
    if (engine.clipboardTimer !== null) return;
    engine.clipboardTimer = window.setInterval(() => {
      void pushClipboard();
    }, 1200);
  }

  async function pushClipboard(): Promise<void> {
    const engine = engineRef.current;
    if (engine.clipboardBusy) return;
    const channel = engine.channel;
    if (!channel || channel.readyState !== "open") return;
    if (!engine.clipboardEnabled || !engine.clipboardAllowed) return;
    engine.clipboardBusy = true;
    try {
      const text = await window.remote.readClipboardText();
      if (!text) return;
      const key = clipboardKey(text);
      if (key === engine.clipboardMark) return;
      channel.send(encodeSessionMessage({ kind: "clipboard", text }));
      engine.clipboardMark = key;
    } catch {
      // Clipboard reads and channel writes can fail transiently.
    } finally {
      engine.clipboardBusy = false;
    }
  }

  function sendMessage(message: SessionMessage): boolean {
    const channel = engineRef.current.channel;
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(encodeSessionMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  function appendChat(from: "self" | "peer", text: string, at: number): void {
    const engine = engineRef.current;
    engine.chatSeq += 1;
    const message: SessionChatMessage = { id: engine.chatSeq, from, text, at };
    setChatMessages((list) => [...list.slice(-199), message]);
  }

  function handleChannelMessage(gen: number, raw: unknown): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    const frame = parseSessionFrame(raw);
    if (!frame || frame.type !== "message") return;
    const message = frame.message;
    switch (message.kind) {
      case "chat":
        appendChat("peer", message.text, Date.now());
        break;
      case "clipboard":
        if (!engine.clipboardEnabled || !engine.clipboardAllowed) return;
        engine.clipboardMark = clipboardKey(message.text);
        void window.remote.writeClipboardText(message.text).catch(() => {});
        break;
      case "session-state":
        engine.inputPaused = message.inputPaused;
        engine.clipboardAllowed = message.clipboard;
        setInputPausedState(message.inputPaused);
        setClipboardAllowedState(message.clipboard);
        updateClipboardSync();
        break;
      case "clipboard-pref":
      case "quality":
        break;
    }
  }

  function setClipboardSync(enabled: boolean): void {
    const engine = engineRef.current;
    if (engine.channel?.readyState !== "open") {
      notifyRef.current(t("会话尚未建立，暂时无法同步剪贴板"), "info");
      return;
    }
    engine.clipboardEnabled = enabled;
    setClipboardEnabledState(enabled);
    sendMessage({ kind: "clipboard-pref", enabled });
    updateClipboardSync();
    notifyRef.current(
      enabled
        ? engine.clipboardAllowed
          ? t("剪贴板同步已开启")
          : t("已请求剪贴板同步，等待对方允许")
        : t("已关闭剪贴板同步"),
      "info",
    );
  }

  function changeQuality(preset: QualityPreset): void {
    const engine = engineRef.current;
    if (engine.quality === preset) return;
    engine.quality = preset;
    setQualityState(preset);
    sendMessage({ kind: "quality", preset });
  }

  function sendChat(value: string): boolean {
    const text = sanitizeChatText(value);
    if (!text) return false;
    const at = Date.now();
    if (!sendMessage({ kind: "chat", text, at })) return false;
    appendChat("self", text, at);
    return true;
  }

  function resetSession(reason = "ended"): void {
    finalizeSessionLog(reason);
    teardownPeer();
    clearApproval();
    closeClient();
    const engine = engineRef.current;
    engine.pending = null;
    engine.candidates = [];
    setHostName(null);
    setServerStats(null);
    setSessionEndsAt(null);
  }

  function sendSignal(gen: number, data: SignalData): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    engine.client?.send({ type: "signal", data });
  }

  function startPeer(gen: number, message: PairedMessage): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || engine.peer) return;
    if (engine.session) finalizeSessionLog("replaced");
    engine.session = {
      sessionId: message.sessionId,
      startedAt: Date.now(),
      peer: message.host,
      dangerEvents: [],
    };
    engine.lastStatsReportAt = 0;
    const pc = new RTCPeerConnection({ iceServers: toIceServers(message.iceServers) });
    engine.peer = pc;
    setHostName(message.host);
    setSessionEndsAt(message.endsAt ?? null);
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) setStream(remote);
    };
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      engine.channel = channel;
      channel.onopen = () => {
        if (gen !== engine.generation) return;
        setChannelReady(true);
        setPhase("connected");
        startStats(gen, pc);
        sendMessage({ kind: "quality", preset: engine.quality });
        if (engine.clipboardEnabled) {
          sendMessage({ kind: "clipboard-pref", enabled: true });
        }
        updateClipboardSync();
      };
      channel.onclose = () => {
        setChannelReady(false);
        stopClipboardTimer();
      };
      channel.onmessage = (message) => handleChannelMessage(gen, message.data);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(gen, { candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setPhase("connected");
        startStats(gen, pc);
      } else if (pc.connectionState === "failed") {
        if (gen !== engine.generation) return;
        finalizeSessionLog("connection-failed");
        setError(t("无法建立点对点连接，对方可能需要配置 TURN 中转服务器。"));
        setPhase("error");
        teardownPeer();
        closeClient();
      }
    };

    const pending = engine.pendingSignals;
    engine.pendingSignals = [];
    for (const signal of pending) {
      void applySignal(gen, signal);
    }
  }

  async function applySignal(gen: number, data: unknown): Promise<void> {
    const engine = engineRef.current;
    if (gen !== engine.generation || !isSignalData(data)) return;
    const pc = engine.peer;
    if (!pc) {
      if (engine.pendingSignals.length < 32) engine.pendingSignals.push(data);
      return;
    }
    try {
      if (data.description) {
        if (data.description.type !== "offer") return;
        await pc.setRemoteDescription(data.description);
        const queued = engine.candidates;
        engine.candidates = [];
        for (const candidate of queued) {
          await pc.addIceCandidate(candidate).catch(() => {});
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          sendSignal(gen, {
            description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
          });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch(() => {});
        } else {
          engine.candidates.push(data.candidate);
        }
      }
    } catch {
      // Duplicate or late ICE payloads are safe to ignore.
    }
  }

  function startWaitingPolling(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || engine.approval !== null) return;
    engine.approval = window.setInterval(() => {
      const pending = engine.pending;
      if (gen !== engine.generation || engine.manual || !pending) return;
      if (!engine.client?.isOpen) return;
      engine.client.send({ type: "controller.lookup", code: pending.code });
    }, 6000);
  }

  async function handleMessage(gen: number, message: ServerMessage): Promise<void> {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    switch (message.type) {
      case "controller.challenge": {
        clearApproval();
        const pending = engine.pending;
        if (!pending) return;
        setHostName(message.host);
        setPhase("verifying");
        try {
          const hash = await deriveKeyHash(pending.key, message.keySalt);
          if (gen !== engine.generation) return;
          engine.client?.send({
            type: "controller.connect",
            code: pending.code,
            keyHash: hash,
            controllerName: settingsRef.current?.deviceName ?? t("若道远程客户端"),
            platform: detectPlatform(),
          });
        } catch (err) {
          if (gen !== engine.generation) return;
          setError(connectionErrorMessage(err));
          setPhase("error");
          closeClient();
        }
        break;
      }
      case "controller.paired":
        clearApproval();
        setHostName(message.host);
        setPhase("connecting");
        startPeer(gen, message);
        break;
      case "controller.rejected":
        if (message.reason === "device-pending") {
          setPhase("waiting");
          setError(null);
          startWaitingPolling(gen);
          break;
        }
        if (message.reason === "device-blocked") {
          engine.manual = true;
          resetSession("blocked");
          const text = accessErrorMessage("blocked", message.message);
          setAccessIssue("blocked");
          setError(text);
          setPhase("error");
          notifyRef.current(text, "error");
          break;
        }
        setError(rejectMessage(message.reason));
        setPhase("error");
        closeClient();
        engine.pending = null;
        break;
      case "client.rejected": {
        engine.manual = true;
        resetSession("kicked");
        const text = accessErrorMessage(message.reason, message.message);
        setAccessIssue(message.reason);
        setError(text);
        setPhase("error");
        notifyRef.current(text, "error");
        break;
      }
      case "signal":
        await applySignal(gen, message.data);
        break;
      case "peer.left":
        resetSession(message.reason || "peer-left");
        setPhase("idle");
        notifyRef.current(peerLeftMessage(message.reason, message.cooldownUntil), "info");
        break;
      case "server.stats":
        setServerStats(message.stats);
        break;
      case "controller.request-denied":
        engine.pending = null;
        closeClient();
        setError(message.message);
        setPhase("error");
        notifyRef.current(message.message, "error");
        break;
      case "error":
        setError(protocolErrorMessage(message.code, message.message));
        break;
      default:
        break;
    }
  }

  function handleSocketClose(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || engine.manual) return;
    if (engine.phase === "connected") {
      notifyRef.current(t("信令连接已断开，画面可能仍可用"), "info");
      return;
    }
    resetSession("server-disconnected");
    setPhase("error");
    setError(t("与服务器的连接已断开，请重新连接。"));
  }

  async function openMemberClient(gen: number): Promise<SignalingClient | null> {
    const engine = engineRef.current;
    const current = settingsRef.current;
    if (!current) return null;

    let client: SignalingClient;
    try {
      client = new SignalingClient(signalUrl(current.serverUrl), {
        onMessage: (message) => {
          void handleMessage(gen, message);
        },
        onClose: () => handleSocketClose(gen),
      });
    } catch (err) {
      setPhase("error");
      setError(connectionErrorMessage(err));
      return null;
    }
    engine.client = client;
    try {
      await client.open(8000);
    } catch (err) {
      if (engine.client === client) engine.client = null;
      client.close();
      if (gen !== engine.generation) return null;
      setPhase("error");
      setError(connectionErrorMessage(err));
      return null;
    }
    if (gen !== engine.generation) {
      client.close();
      return null;
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
      if (gen !== engine.generation) return null;
      engine.pending = null;
      if (err instanceof ServerAccessError && err.reason !== "network") {
        setAccessIssue(err.reason);
        setError(accessErrorMessage(err.reason, err.message));
        setPhase("error");
        return null;
      }
      setPhase("error");
      setError(connectionErrorMessage(err));
      return null;
    }
    if (gen !== engine.generation) return null;
    setAccessIssue(null);
    if (welcome.device.status !== "approved") {
      setPhase("waiting");
      setError(null);
      startWaitingPolling(gen);
      return null;
    }
    return client;
  }

  async function connect(codeInput: string, keyInput: string): Promise<void> {
    const code = normalizeCodeInput(codeInput);
    const key = normalizeKeyInput(keyInput);
    if (!/^\d{9}$/.test(code)) {
      setError(t("请输入完整的 9 位远控码"));
      setPhase("error");
      return;
    }
    if (!isCompleteKey(keyInput)) {
      setError(t("请输入完整的 10 位访问密钥（不含 I、O、0、1）"));
      setPhase("error");
      return;
    }
    const current = settingsRef.current;
    if (!current) return;

    resetSession("replaced");
    const engine = engineRef.current;
    engine.manual = false;
    engine.generation += 1;
    engine.pending = { code, key };
    const gen = engine.generation;
    setError(null);
    setAccessIssue(null);
    setHostName(null);
    setPhase("lookup");

    const client = await openMemberClient(gen);
    if (!client || gen !== engine.generation) return;
    client.send({ type: "controller.lookup", code });
  }

  async function connectWithToken(host: PeerProfile, token: string): Promise<void> {
    const current = settingsRef.current;
    if (!current) return;
    resetSession("replaced");
    const engine = engineRef.current;
    engine.manual = false;
    engine.generation += 1;
    engine.pending = null;
    const gen = engine.generation;
    setError(null);
    setAccessIssue(null);
    setHostName(host);
    setPhase("connecting");

    const client = await openMemberClient(gen);
    if (!client || gen !== engine.generation) return;
    setPhase("verifying");
    const sent = client.send({
      type: "controller.connect-token",
      token,
      controllerName: current.deviceName,
      platform: detectPlatform(),
    });
    if (!sent) {
      closeClient();
      setError(t("无法发送远控授权，请检查服务器连接。"));
      setPhase("error");
    }
  }

  function disconnect(): void {
    const engine = engineRef.current;
    engine.manual = true;
    engine.generation += 1;
    if (engine.client?.isOpen) {
      engine.client.send({ type: "controller.disconnect" });
    }
    resetSession("controller-ended");
    setPhase("idle");
    setError(null);
  }

  function sendInput(payload: InputEventPayload): boolean {
    const engine = engineRef.current;
    const channel = engine.channel;
    if (engine.inputPaused) return false;
    if (!channel || channel.readyState !== "open") return false;
    if (!isRendererInputEvent(payload)) return false;
    try {
      channel.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engine.manual = true;
      engine.generation += 1;
      finalizeSessionLog("app-closed");
      if (engine.approval !== null) window.clearInterval(engine.approval);
      if (engine.clipboardTimer !== null) window.clearInterval(engine.clipboardTimer);
      stopStats();
      engine.channel?.close();
      engine.peer?.close();
      engine.client?.close();
    };
  }, []);

  return {
    phase,
    hostName,
    error,
    accessIssue,
    stream,
    stats,
    serverStats,
    sessionEndsAt,
    channelReady,
    inputPaused,
    clipboardAllowed,
    clipboardEnabled,
    quality,
    chatMessages,
    connect,
    connectWithToken,
    disconnect,
    sendInput,
    setClipboardSync,
    changeQuality,
    sendChat,
    noteDangerShortcut,
  };
}
