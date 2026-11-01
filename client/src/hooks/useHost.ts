import { useEffect, useRef, useState } from "react";
import {
  deriveKeyHash,
  generateAccessKey,
  generateSaltHex,
} from "../lib/key";
import {
  SignalingClient,
  ServerAccessError,
  detectPlatform,
  signalUrl,
  type AccessRejectReason,
  type HostControlRequestInfo,
  type PeerProfile,
  type ServerMessage,
} from "../lib/signaling";
import {
  clipboardKey,
  encodeSessionMessage,
  parseSessionFrame,
  sanitizeChatText,
  type SessionMessage,
} from "../lib/session-channel";
import {
  isSignalData,
  toIceServers,
  tuneVideoSender,
  type SignalData,
} from "../lib/webrtc";
import { dangerActionLabel, inputDangerAction } from "../lib/danger";
import {
  accessErrorMessage,
  captureErrorMessage,
  connectionErrorMessage,
  peerLeftMessage,
  protocolErrorMessage,
} from "../lib/messages";
import type {
  AppInfo,
  HostSessionInfo,
  QualityPreset,
  SessionChatMessage,
  SessionLogDangerEvent,
  Settings,
  ToastKind,
} from "../types";

export type HostPhase = "idle" | "connecting" | "pending" | "online" | "error";

type HostPairedMessage = Extract<ServerMessage, { type: "host.paired" }>;

interface HostIdentity {
  key: string;
  salt: string;
  hash: string;
}

interface HostLogSession {
  sessionId: string;
  startedAt: number;
  peer: PeerProfile;
  dangerEvents: SessionLogDangerEvent[];
}

interface HostEngine {
  identity: HostIdentity | null;
  client: SignalingClient | null;
  peer: RTCPeerConnection | null;
  channel: RTCDataChannel | null;
  stream: MediaStream | null;
  heartbeat: number | null;
  retry: number | null;
  approval: number | null;
  attempts: number;
  generation: number;
  stopped: boolean;
  starting: boolean;
  phase: HostPhase;
  preferredCode: string;
  candidates: RTCIceCandidateInit[];
  inputPaused: boolean;
  clipboardAllowed: boolean;
  peerClipboard: boolean;
  clipboardTimer: number | null;
  clipboardBusy: boolean;
  clipboardMark: string;
  quality: QualityPreset;
  chatSeq: number;
  publishWanted: boolean;
  publishNote: string;
  pressedKeys: Set<number>;
  logSession: HostLogSession | null;
}

function createEngine(): HostEngine {
  return {
    identity: null,
    client: null,
    peer: null,
    channel: null,
    stream: null,
    heartbeat: null,
    retry: null,
    approval: null,
    attempts: 0,
    generation: 0,
    stopped: true,
    starting: false,
    phase: "idle",
    preferredCode: "",
    candidates: [],
    inputPaused: false,
    clipboardAllowed: false,
    peerClipboard: false,
    clipboardTimer: null,
    clipboardBusy: false,
    clipboardMark: "",
    quality: "balanced",
    chatSeq: 0,
    publishWanted: false,
    publishNote: "",
    pressedKeys: new Set(),
    logSession: null,
  };
}

export function useHost(
  settings: Settings | null,
  appInfo: AppInfo | null,
  notify: (message: string, kind?: ToastKind) => void,
) {
  const [phase, setPhaseState] = useState<HostPhase>("idle");
  const [code, setCode] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(true);
  const [keyPersisted, setKeyPersisted] = useState(true);
  const [session, setSession] = useState<HostSessionInfo | null>(null);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessIssue, setAccessIssue] = useState<AccessRejectReason | null>(null);
  const [busy, setBusy] = useState<"rotating" | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [inputPaused, setInputPausedState] = useState(false);
  const [clipboardAllowed, setClipboardAllowedState] = useState(false);
  const [chatMessages, setChatMessages] = useState<SessionChatMessage[]>([]);
  const [published, setPublishedState] = useState(false);
  const [publishNote, setPublishNoteState] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);
  const [requests, setRequests] = useState<HostControlRequestInfo[]>([]);

  const engineRef = useRef<HostEngine>(createEngine());
  const settingsRef = useRef<Settings | null>(settings);
  settingsRef.current = settings;
  const appInfoRef = useRef<AppInfo | null>(appInfo);
  appInfoRef.current = appInfo;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const autoStartedRef = useRef(false);

  function setPhase(next: HostPhase): void {
    engineRef.current.phase = next;
    setPhaseState(next);
  }

  function clearTimers(): void {
    const engine = engineRef.current;
    if (engine.heartbeat !== null) {
      window.clearInterval(engine.heartbeat);
      engine.heartbeat = null;
    }
    if (engine.retry !== null) {
      window.clearTimeout(engine.retry);
      engine.retry = null;
    }
    if (engine.approval !== null) {
      window.clearInterval(engine.approval);
      engine.approval = null;
    }
  }

  function finalizeHostLog(reason: string): void {
    const engine = engineRef.current;
    const record = engine.logSession;
    if (!record) return;
    engine.logSession = null;
    void window.remote
      .appendSessionLog({
        startedAt: record.startedAt,
        durationMs: Math.max(0, Date.now() - record.startedAt),
        role: "host",
        peerName: record.peer.name,
        peerIp: record.peer.ip ?? null,
        peerPlatform: record.peer.platform,
        sessionId: record.sessionId,
        reason,
        dangerEvents: record.dangerEvents,
      })
      .catch(() => {});
  }

  function noteHostDanger(action: string, notifyUser = true): void {
    const engine = engineRef.current;
    const record = engine.logSession;
    if (!record) return;
    const at = Date.now();
    const last = record.dangerEvents[record.dangerEvents.length - 1];
    if (last && last.action === action && at - last.at < 2500) return;
    const event = { at, action, label: dangerActionLabel(action) };
    record.dangerEvents.push(event);
    if (record.dangerEvents.length > 50) {
      record.dangerEvents = record.dangerEvents.slice(-50);
    }
    engine.client?.send({ type: "session.event", kind: "danger", action });
    if (notifyUser) {
      notifyRef.current(`检测到对方执行危险操作：${event.label}`, "error");
    }
  }

  function trackDangerInput(vk: number, down: boolean): string | null {
    const engine = engineRef.current;
    const pressed = engine.pressedKeys;
    if (!down) {
      pressed.delete(vk);
      return null;
    }
    if (pressed.has(vk)) return null;
    const action = inputDangerAction(vk, pressed);
    pressed.add(vk);
    return action;
  }

  function teardownPeer(reason = "ended"): void {
    finalizeHostLog(reason);
    const engine = engineRef.current;
    engine.candidates = [];
    engine.pressedKeys.clear();
    stopClipboardTimer();
    engine.clipboardBusy = false;
    engine.clipboardMark = "";
    engine.inputPaused = false;
    engine.clipboardAllowed = false;
    engine.peerClipboard = false;
    engine.chatSeq = 0;
    setInputPausedState(false);
    setClipboardAllowedState(false);
    setChatMessages([]);
    if (engine.channel) {
      engine.channel.onopen = null;
      engine.channel.onclose = null;
      engine.channel.onmessage = null;
      try {
        engine.channel.close();
      } catch {
        // ignore
      }
      engine.channel = null;
    }
    if (engine.peer) {
      engine.peer.onicecandidate = null;
      engine.peer.onconnectionstatechange = null;
      try {
        engine.peer.close();
      } catch {
        // ignore
      }
      engine.peer = null;
    }
    void window.remote.setInputActive(false);
    window.remote.releaseAllInput();
    setSession(null);
  }

  function teardownStream(): void {
    const engine = engineRef.current;
    if (engine.stream) {
      for (const track of engine.stream.getTracks()) track.stop();
      engine.stream = null;
    }
    setPreview(null);
  }

  function closeClient(): void {
    const engine = engineRef.current;
    clearTimers();
    if (engine.client) {
      engine.client.close();
      engine.client = null;
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
      engine.clipboardAllowed &&
      engine.peerClipboard &&
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
    if (!engine.clipboardAllowed || !engine.peerClipboard) return;
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

  function sendSessionState(): void {
    const engine = engineRef.current;
    const channel = engine.channel;
    if (!channel || channel.readyState !== "open") return;
    try {
      channel.send(
        encodeSessionMessage({
          kind: "session-state",
          inputPaused: engine.inputPaused,
          clipboard: engine.clipboardAllowed,
        }),
      );
    } catch {
      // The channel may close between the state check and the send.
    }
  }

  function appendChat(from: "self" | "peer", text: string, at: number): void {
    const engine = engineRef.current;
    engine.chatSeq += 1;
    const message: SessionChatMessage = { id: engine.chatSeq, from, text, at };
    setChatMessages((list) => [...list.slice(-199), message]);
  }

  function handleSessionMessage(message: SessionMessage): void {
    const engine = engineRef.current;
    switch (message.kind) {
      case "chat":
        appendChat("peer", message.text, Date.now());
        break;
      case "clipboard":
        if (!engine.clipboardAllowed || !engine.peerClipboard) return;
        engine.clipboardMark = clipboardKey(message.text);
        void window.remote.writeClipboardText(message.text).catch(() => {});
        break;
      case "clipboard-pref":
        engine.peerClipboard = message.enabled;
        updateClipboardSync();
        sendSessionState();
        break;
      case "quality":
        engine.quality = message.preset;
        if (engine.peer) void tuneVideoSender(engine.peer, message.preset);
        break;
      case "session-state":
        break;
    }
  }

  function toggleInputPause(): void {
    const engine = engineRef.current;
    if (engine.channel?.readyState !== "open") {
      notifyRef.current("会话尚未建立，暂时无法调整输入权限", "info");
      return;
    }
    const next = !engine.inputPaused;
    engine.inputPaused = next;
    setInputPausedState(next);
    void window.remote.setInputActive(!next);
    if (next) {
      engine.pressedKeys.clear();
      window.remote.releaseAllInput();
    }
    sendSessionState();
    notifyRef.current(next ? "已暂停对方键盘和鼠标输入" : "已恢复对方输入", "info");
  }

  function toggleClipboard(): void {
    const engine = engineRef.current;
    if (engine.channel?.readyState !== "open") {
      notifyRef.current("会话尚未建立，暂时无法调整剪贴板权限", "info");
      return;
    }
    engine.clipboardAllowed = !engine.clipboardAllowed;
    setClipboardAllowedState(engine.clipboardAllowed);
    updateClipboardSync();
    sendSessionState();
    notifyRef.current(
      engine.clipboardAllowed ? "已允许剪贴板同步，需对方也开启后生效" : "已关闭剪贴板同步",
      "info",
    );
  }

  function sendChat(value: string): boolean {
    const engine = engineRef.current;
    const text = sanitizeChatText(value);
    if (!text) return false;
    const channel = engine.channel;
    if (!channel || channel.readyState !== "open") return false;
    const at = Date.now();
    try {
      channel.send(encodeSessionMessage({ kind: "chat", text, at }));
    } catch {
      return false;
    }
    appendChat("self", text, at);
    return true;
  }

  function setPublish(nextPublished: boolean, note: string): void {
    const engine = engineRef.current;
    const value = note.slice(0, 120);
    if (!engine.client?.isOpen || engine.phase !== "online") {
      notifyRef.current("请先开始被控，再共享给本服成员", "info");
      return;
    }
    if (nextPublished === engine.publishWanted && (!nextPublished || value === engine.publishNote)) {
      return;
    }
    engine.publishWanted = nextPublished;
    engine.publishNote = value;
    if (!nextPublished && !published) {
      setPublishNoteState(value);
      return;
    }
    setPublishBusy(true);
    if (
      !engine.client.send({
        type: "host.publish",
        published: nextPublished,
        note: value,
      })
    ) {
      setPublishBusy(false);
      notifyRef.current("共享设置发送失败，请检查网络连接", "error");
    }
  }

  function decideRequest(requestId: string, accept: boolean): void {
    const engine = engineRef.current;
    if (!engine.client?.isOpen) {
      notifyRef.current("与服务器的连接已断开，无法处理申请", "error");
      return;
    }
    setRequests((list) => list.filter((item) => item.id !== requestId));
    if (!engine.client.send({ type: "host.control-decision", requestId, accept })) {
      notifyRef.current("处理申请失败，请检查网络连接", "error");
      return;
    }
    notifyRef.current(accept ? "已同意申请，等待对方建立连接" : "已拒绝该申请", "info");
  }

  function sendSignal(gen: number, data: SignalData): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    engine.client?.send({ type: "signal", data });
  }

  function startHeartbeat(gen: number): void {
    const engine = engineRef.current;
    if (engine.heartbeat !== null) window.clearInterval(engine.heartbeat);
    engine.heartbeat = window.setInterval(() => {
      if (gen !== engine.generation || engine.stopped) return;
      engine.client?.send({ type: "host.heartbeat" });
    }, 20_000);
  }

  function scheduleReconnect(gen: number): void {
    const engine = engineRef.current;
    if (engine.stopped || gen !== engine.generation) return;
    if (engine.retry !== null) return;
    engine.attempts = Math.min(engine.attempts + 1, 5);
    const delay = Math.min(1000 * 2 ** (engine.attempts - 1), 15_000);
    engine.retry = window.setTimeout(() => {
      engine.retry = null;
      if (gen !== engine.generation || engineRef.current.stopped) return;
      void openSignaling(gen).catch(() => beginRetry(gen));
    }, delay);
  }

  function beginRetry(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || engine.stopped) return;
    setAccessIssue(null);
    setError("连接服务器失败，正在重试…");
    setPhase("connecting");
    scheduleReconnect(gen);
  }

  function sendHostRegister(gen: number): void {
    const engine = engineRef.current;
    const current = settingsRef.current;
    const identity = engine.identity;
    if (gen !== engine.generation || !current || !identity) return;
    engine.client?.send({
      type: "host.register",
      requestedCode: engine.preferredCode || undefined,
      keySalt: identity.salt,
      keyHash: identity.hash,
      deviceName: current.deviceName,
      platform: detectPlatform(),
    });
  }

  function startApprovalPolling(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    if (engine.approval !== null) return;
    sendHostRegister(gen);
    engine.approval = window.setInterval(() => {
      if (gen !== engine.generation || engine.stopped) return;
      sendHostRegister(gen);
    }, 5000);
  }

  async function openSignaling(gen: number): Promise<void> {
    const engine = engineRef.current;
    const current = settingsRef.current;
    const identity = engine.identity;
    if (!current || !identity) throw new Error("远控密钥尚未准备好");
    closeClient();
    const client = new SignalingClient(signalUrl(current.serverUrl), {
      onMessage: (message) => {
        void handleMessage(gen, message);
      },
      onClose: () => handleSocketClose(gen),
    });
    engine.client = client;
    await client.open(8000);
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
        setPhase("error");
        return;
      }
      throw err;
    }
    if (gen !== engine.generation) return;
    setAccessIssue(null);
    if (welcome.device.status !== "approved") {
      setPhase("pending");
      setError(null);
      startApprovalPolling(gen);
      return;
    }
    sendHostRegister(gen);
  }

  function handleSocketClose(gen: number): void {
    const engine = engineRef.current;
    if (gen !== engine.generation || engine.stopped) return;
    teardownPeer("server-disconnected");
    setPublishedState(false);
    setPublishBusy(false);
    setRequests([]);
    if (!engine.stream) {
      setPhase("error");
      setError("屏幕共享已停止，请重新开始。");
      return;
    }
    setError("与服务器的连接已断开，正在重连…");
    setPhase("connecting");
    scheduleReconnect(gen);
  }

  async function beginHostSession(gen: number, message: HostPairedMessage): Promise<void> {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    teardownPeer("replaced");
    const startedAt = Date.now();
    engine.logSession = {
      sessionId: message.sessionId,
      startedAt,
      peer: message.controller,
      dangerEvents: [],
    };
    setSession({
      sessionId: message.sessionId,
      controllerName: message.controller.name,
      platform: message.controller.platform,
      ip: message.controller.ip,
      startedAt,
      endsAt: message.endsAt ?? null,
    });
    try {
      if (!engine.stream) throw new Error("屏幕画面不可用");
      const pc = new RTCPeerConnection({ iceServers: toIceServers(message.iceServers) });
      engine.peer = pc;
      for (const track of engine.stream.getVideoTracks()) {
        pc.addTrack(track, engine.stream);
      }
      const channel = pc.createDataChannel("ruodao-input", { ordered: true });
      engine.channel = channel;
      channel.onopen = () => {
        void window.remote.setInputActive(!engine.inputPaused);
        sendSessionState();
        updateClipboardSync();
      };
      channel.onclose = () => {
        void window.remote.setInputActive(false);
        stopClipboardTimer();
      };
      channel.onmessage = (event) => {
        const frame = parseSessionFrame(String(event.data));
        if (!frame) return;
        if (frame.type === "input") {
          if (engine.inputPaused) return;
          const action =
            frame.event.kind === "key" ? trackDangerInput(frame.event.vk, frame.event.action === "down") : null;
          window.remote.injectInput(frame.event);
          if (action) noteHostDanger(action);
          return;
        }
        handleSessionMessage(frame.message);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(gen, { candidate: event.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          notifyRef.current("远程连接中断，请让对方重新连接", "error");
          teardownPeer("connection-failed");
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      void tuneVideoSender(pc, engine.quality);
      if (pc.localDescription) {
        sendSignal(gen, {
          description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
      }
    } catch (err) {
      teardownPeer("setup-failed");
      setError(connectionErrorMessage(err));
    }
  }

  async function applySignal(gen: number, data: unknown): Promise<void> {
    const engine = engineRef.current;
    if (gen !== engine.generation || !isSignalData(data)) return;
    const pc = engine.peer;
    if (!pc) return;
    try {
      if (data.description) {
        if (data.description.type !== "answer") return;
        await pc.setRemoteDescription(data.description);
        const pending = engine.candidates;
        engine.candidates = [];
        for (const candidate of pending) {
          await pc.addIceCandidate(candidate).catch(() => {});
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch(() => {});
        } else {
          engine.candidates.push(data.candidate);
        }
      }
    } catch {
      // A late or duplicate candidate can be ignored safely.
    }
  }

  async function handleMessage(gen: number, message: ServerMessage): Promise<void> {
    const engine = engineRef.current;
    if (gen !== engine.generation) return;
    switch (message.type) {
      case "host.registered": {
        engine.preferredCode = message.code;
        engine.attempts = 0;
        if (engine.approval !== null) {
          window.clearInterval(engine.approval);
          engine.approval = null;
        }
        setCode(message.code);
        setError(null);
        setAccessIssue(null);
        setPhase("online");
        startHeartbeat(gen);
        setRequests([]);
        setPublishedState(false);
        void window.remote.updateSettings({ preferredCode: message.code }).catch(() => {});
        if (engine.publishWanted) {
          setPublishBusy(true);
          engine.client?.send({
            type: "host.publish",
            published: true,
            note: engine.publishNote,
          });
        } else {
          setPublishBusy(false);
        }
        break;
      }
      case "host.key-updated":
        notifyRef.current("新的访问密钥已生效", "success");
        break;
      case "host.publish-state":
        engine.publishWanted = message.published;
        engine.publishNote = message.note;
        setPublishedState(message.published);
        setPublishNoteState(message.note);
        setPublishBusy(false);
        notifyRef.current(
          message.published ? "已共享给本服成员，等待对方申请" : "已停止共享本机",
          "success",
        );
        break;
      case "host.control-request":
        setRequests((list) =>
          list.some((item) => item.id === message.request.id)
            ? list
            : [...list.slice(-4), message.request],
        );
        notifyRef.current(`收到“${message.request.controllerName}”的远控申请`, "info");
        break;
      case "host.control-approved":
        setRequests((list) => list.filter((item) => item.id !== message.requestId));
        break;
      case "host.control-closed":
        setRequests((list) => list.filter((item) => item.id !== message.requestId));
        break;
      case "host.paired":
        setRequests([]);
        await beginHostSession(gen, message);
        break;
      case "client.rejected": {
        engine.stopped = true;
        teardownPeer("kicked");
        closeClient();
        engine.publishWanted = false;
        setPublishedState(false);
        setPublishBusy(false);
        setRequests([]);
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
        teardownPeer(message.reason || "peer-left");
        notifyRef.current(peerLeftMessage(message.reason, message.cooldownUntil), "info");
        break;
      case "error":
        if (message.code === "device-pending") {
          setPhase("pending");
          startApprovalPolling(gen);
          break;
        }
        if (message.code === "device-blocked" || message.code === "device-frozen") {
          engine.stopped = true;
          engine.publishWanted = false;
          setPublishedState(false);
          setPublishBusy(false);
          setRequests([]);
          closeClient();
          const frozen = message.code === "device-frozen";
          const text = accessErrorMessage(frozen ? "frozen" : "blocked", message.message);
          setAccessIssue(frozen ? "frozen" : "blocked");
          setError(text);
          setPhase("error");
          notifyRef.current(text, "error");
          break;
        }
        if (message.code === "hello-required" || message.code === "device-unknown") {
          engine.stopped = true;
          closeClient();
          setAccessIssue("invalid-hello");
          setError(protocolErrorMessage(message.code, message.message));
          setPhase("error");
          break;
        }
        setError(protocolErrorMessage(message.code, message.message));
        if (message.code === "already-registered" || message.code === "server-full") {
          setPhase("error");
        }
        break;
      default:
        break;
    }
  }

  async function start(): Promise<void> {
    const engine = engineRef.current;
    const current = settingsRef.current;
    if (!current || !engine.identity) return;
    if (engine.starting || engine.phase === "online" || engine.phase === "connecting") return;
    engine.stopped = false;
    engine.starting = true;
    engine.attempts = 0;
    engine.generation += 1;
    const gen = engine.generation;
    setError(null);
    setAccessIssue(null);
    setPhase("connecting");

    let stream = engine.stream;
    const ended =
      !stream ||
      stream.getVideoTracks().length === 0 ||
      stream.getVideoTracks().every((track) => track.readyState === "ended");
    if (ended) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
          audio: false,
        });
      } catch (err) {
        engine.starting = false;
        engine.stream = null;
        setPreview(null);
        if (gen !== engineRef.current.generation) return;
        setPhase("error");
        setError(captureErrorMessage(err));
        return;
      }
      if (gen !== engineRef.current.generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      engine.stream = stream;
      setPreview(stream);
      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener("ended", () => {
        notifyRef.current("屏幕共享已停止，已自动下线", "info");
        stop();
      });
    }

    engine.starting = false;
    try {
      await openSignaling(gen);
    } catch {
      beginRetry(gen);
    }
  }

  function stop(): void {
    const engine = engineRef.current;
    engine.stopped = true;
    engine.starting = false;
    engine.generation += 1;
    engine.publishWanted = false;
    engine.publishNote = "";
    clearTimers();
    if (engine.client) {
      engine.client.send({ type: "host.unregister" });
      engine.client.close();
      engine.client = null;
    }
    teardownPeer("host-ended");
    teardownStream();
    setPhase("idle");
    setCode("");
    setError(null);
    setAccessIssue(null);
    setBusy(null);
    setPublishedState(false);
    setPublishNoteState("");
    setPublishBusy(false);
    setRequests([]);
  }

  async function rotateKey(): Promise<void> {
    const engine = engineRef.current;
    if (busy) return;
    setBusy("rotating");
    try {
      const key = generateAccessKey();
      const salt = generateSaltHex();
      const hash = await deriveKeyHash(key, salt);
      const saved = await window.remote.saveHostKey({ key, salt });
      engine.identity = { key, salt, hash };
      setAccessKey(key);
      setKeyPersisted(saved.persisted);
      if (engine.client?.isOpen) {
        engine.client.send({ type: "host.update-key", keySalt: salt, keyHash: hash });
      }
      notifyRef.current("已生成新的访问密钥", "success");
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const settingsReady = Boolean(settings);

  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await window.remote.loadHostKey();
        let key = saved?.key ?? "";
        let salt = saved?.salt ?? "";
        let persisted = Boolean(saved);
        if (!key || !salt) {
          key = generateAccessKey();
          salt = generateSaltHex();
          const result = await window.remote.saveHostKey({ key, salt });
          persisted = result.persisted;
        }
        const hash = await deriveKeyHash(key, salt);
        if (cancelled) return;
        engineRef.current.identity = { key, salt, hash };
        engineRef.current.preferredCode = settingsRef.current?.preferredCode ?? "";
        setAccessKey(key);
        setKeyPersisted(persisted);
        setIdentityReady(true);
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        setError(connectionErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsReady]);

  useEffect(() => {
    if (!identityReady || autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (settings?.autoStartHost) void start();
  }, [identityReady, settings?.autoStartHost]);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engine.stopped = true;
      engine.generation += 1;
      finalizeHostLog("app-closed");
      if (engine.heartbeat !== null) window.clearInterval(engine.heartbeat);
      if (engine.retry !== null) window.clearTimeout(engine.retry);
      if (engine.clipboardTimer !== null) window.clearInterval(engine.clipboardTimer);
      engine.client?.close();
      engine.channel?.close();
      engine.peer?.close();
      engine.stream?.getTracks().forEach((track) => track.stop());
      void window.remote.setInputActive(false);
      window.remote.releaseAllInput();
    };
  }, []);

  return {
    phase,
    code,
    accessKey,
    keyVisible,
    keyPersisted,
    session,
    preview,
    error,
    accessIssue,
    busy,
    identityReady,
    inputPaused,
    clipboardAllowed,
    chatMessages,
    published,
    publishNote,
    publishBusy,
    requests,
    deviceName: settings?.deviceName ?? "",
    start,
    stop,
    rotateKey,
    setPublish,
    decideRequest,
    toggleKeyVisible: () => setKeyVisible((value) => !value),
    toggleInputPause,
    toggleClipboard,
    sendChat,
  };
}
