import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatDuration, useElapsed } from "../hooks/useElapsed";
import {
  keyboardEventToInput,
  pointerButton,
  type InputEventPayload,
  type MouseButton,
} from "../lib/input";
import { CHAT_TEXT_LIMIT } from "../lib/session-channel";
import { keyboardDangerAction } from "../lib/danger";
import type { PeerProfile } from "../lib/signaling";
import { QUALITY_ORDER, QUALITY_PROFILES, assessNetwork } from "../lib/webrtc";
import type {
  QualityPreset,
  ServerStats,
  SessionChatMessage,
  SessionStats,
} from "../types";
import {
  ChatIcon,
  ClipboardIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  KeyboardIcon,
  LockIcon,
  MousePointerIcon,
  PauseIcon,
  PowerIcon,
  SendIcon,
  XIcon,
} from "./icons";

import { t, tf } from "../i18n";


type ViewMode = "fit" | "fill" | "actual";

const VIEW_MODES: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "fit", label: t("适应"), hint: t("完整显示画面，可能留有黑边") },
  { id: "fill", label: t("填充"), hint: t("铺满窗口，边缘可能被裁切") },
  { id: "actual", label: t("原尺寸"), hint: t("按对方屏幕原始像素显示，可滚动查看") },
];

interface SessionViewProps {
  stream: MediaStream | null;
  hostName: PeerProfile | null;
  stats: SessionStats | null;
  serverStats: ServerStats | null;
  endsAt?: number | null;
  channelReady: boolean;
  connected: boolean;
  inputPaused: boolean;
  clipboardAllowed: boolean;
  clipboardEnabled: boolean;
  quality: QualityPreset;
  chatMessages: SessionChatMessage[];
  sendInput: (payload: InputEventPayload) => boolean;
  onDangerShortcut: (action: string) => void;
  onToggleClipboard: () => void;
  onChangeQuality: (preset: QualityPreset) => void;
  onSendChat: (text: string) => boolean;
  onDisconnect: () => void;
}

function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps} Kbps`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SessionView({
  stream,
  hostName,
  stats,
  serverStats,
  endsAt,
  channelReady,
  connected,
  inputPaused,
  clipboardAllowed,
  clipboardEnabled,
  quality,
  chatMessages,
  sendInput,
  onDangerShortcut,
  onToggleClipboard,
  onChangeQuality,
  onSendChat,
  onDisconnect,
}: SessionViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;
  const channelReadyRef = useRef(channelReady);
  channelReadyRef.current = channelReady;
  const inputPausedRef = useRef(inputPaused);
  inputPausedRef.current = inputPaused;
  const viewModeRef = useRef<ViewMode>("fit");

  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const wheelRef = useRef(0);
  const pressedKeysRef = useRef(new Map<number, boolean>());
  const pressedButtonsRef = useRef(new Set<MouseButton>());
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const lastChatCountRef = useRef(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("fit");
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const elapsed = useElapsed(startedAt);

  viewModeRef.current = viewMode;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    setStartedAt(connected ? Date.now() : null);
  }, [connected]);

  useEffect(() => {
    if (channelReady) stageRef.current?.focus();
  }, [channelReady]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    const list = chatListRef.current;
    if (!list || !chatOpen) return;
    list.scrollTop = list.scrollHeight;
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    const added = chatMessages.length - lastChatCountRef.current;
    lastChatCountRef.current = chatMessages.length;
    if (added <= 0 || chatOpen) return;
    const latest = chatMessages[chatMessages.length - 1];
    if (latest?.from === "peer") setUnread((value) => value + added);
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!channelReadyRef.current || inputPausedRef.current) return;
      if (event.target instanceof Element && event.target.closest(".session-chat")) return;
      if (viewModeRef.current === "actual") {
        const maxScroll = element.scrollHeight - element.clientHeight;
        const canScrollUp = event.deltaY < 0 && element.scrollTop > 0;
        const canScrollDown = event.deltaY > 0 && element.scrollTop < maxScroll - 1;
        if (maxScroll > 0 && (canScrollUp || canScrollDown)) return;
      }
      event.preventDefault();
      wheelRef.current += event.deltaY;
      const steps = Math.trunc(wheelRef.current / 100);
      if (steps === 0) return;
      wheelRef.current -= steps * 100;
      sendInputRef.current({ kind: "wheel", delta: -steps * 120 });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      for (const [vk, extended] of pressedKeysRef.current) {
        sendInputRef.current({ kind: "key", action: "up", vk, extended });
      }
      pressedKeysRef.current.clear();
      for (const button of pressedButtonsRef.current) {
        sendInputRef.current({ kind: "mouse-button", button, action: "up" });
      }
      pressedButtonsRef.current.clear();
    };
  }, []);

  function normalizedPoint(
    event: ReactPointerEvent<HTMLDivElement>,
  ): { x: number; y: number } | null {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const videoWidth = video.videoWidth || rect.width;
    const videoHeight = video.videoHeight || rect.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let left = rect.left;
    let top = rect.top;
    if (viewModeRef.current === "fill") {
      const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
      contentWidth = videoWidth * scale;
      contentHeight = videoHeight * scale;
      left = rect.left + (rect.width - contentWidth) / 2;
      top = rect.top + (rect.height - contentHeight) / 2;
    } else if (viewModeRef.current === "fit") {
      const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
      contentWidth = videoWidth * scale;
      contentHeight = videoHeight * scale;
      left = rect.left + (rect.width - contentWidth) / 2;
      top = rect.top + (rect.height - contentHeight) / 2;
    }
    const x = (event.clientX - left) / contentWidth;
    const y = (event.clientY - top) / contentHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  function queueMove(point: { x: number; y: number }): void {
    pendingMoveRef.current = point;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (pending) sendInputRef.current({ kind: "mouse-move", x: pending.x, y: pending.y });
    });
  }

  function inputReady(): boolean {
    return channelReadyRef.current && !inputPausedRef.current;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!inputReady()) return;
    const point = normalizedPoint(event);
    if (point) queueMove(point);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!inputReady()) return;
    stageRef.current?.focus();
    const button = pointerButton(event.button);
    if (!button) return;
    const point = normalizedPoint(event);
    if (!point) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best effort.
    }
    sendInputRef.current({ kind: "mouse-move", x: point.x, y: point.y });
    pressedButtonsRef.current.add(button);
    sendInputRef.current({ kind: "mouse-button", button, action: "down" });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const button = pointerButton(event.button);
    if (!button || !pressedButtonsRef.current.has(button)) return;
    pressedButtonsRef.current.delete(button);
    sendInputRef.current({ kind: "mouse-button", button, action: "up" });
  }

  function handlePointerCancel(): void {
    for (const button of pressedButtonsRef.current) {
      sendInputRef.current({ kind: "mouse-button", button, action: "up" });
    }
    pressedButtonsRef.current.clear();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!inputReady()) return;
    if (document.fullscreenElement && event.code === "Escape") return;
    const payload = keyboardEventToInput(event.nativeEvent, true);
    if (!payload) return;
    event.preventDefault();
    if (payload.kind === "key") {
      pressedKeysRef.current.set(payload.vk, payload.extended === true);
    }
    const danger = keyboardDangerAction(event.nativeEvent);
    if (danger) onDangerShortcut(danger);
    sendInputRef.current(payload);
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (document.fullscreenElement && event.code === "Escape") return;
    const payload = keyboardEventToInput(event.nativeEvent, false);
    if (!payload) return;
    event.preventDefault();
    if (payload.kind === "key") pressedKeysRef.current.delete(payload.vk);
    sendInputRef.current(payload);
  }

  function releaseOnBlur(): void {
    for (const [vk, extended] of pressedKeysRef.current) {
      sendInputRef.current({ kind: "key", action: "up", vk, extended });
    }
    pressedKeysRef.current.clear();
    for (const button of pressedButtonsRef.current) {
      sendInputRef.current({ kind: "mouse-button", button, action: "up" });
    }
    pressedButtonsRef.current.clear();
  }

  function submitChat(): void {
    const text = chatDraft.trim();
    if (!text) return;
    if (onSendChat(text)) setChatDraft("");
  }

  function toggleChat(): void {
    const next = !chatOpen;
    setChatOpen(next);
    if (next) setUnread(0);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await shellRef.current?.requestFullscreen();
      }
    } catch {
      // Fullscreen may be denied by the window manager.
    }
  }

  const naturalWidth = videoSize?.width ?? stats?.width ?? 0;
  const naturalHeight = videoSize?.height ?? stats?.height ?? 0;
  const actualStyle =
    viewMode === "actual" && naturalWidth > 0 && naturalHeight > 0
      ? { width: `${naturalWidth}px`, height: `${naturalHeight}px` }
      : undefined;
  const clipboardActive = clipboardEnabled && clipboardAllowed;
  const verdict = assessNetwork(stats);
  const serverHint = serverStats
    ? [
        tf("服务器出口 {0} / 入口 {1}", formatKbps(serverStats.bandwidthOutKbps), formatKbps(serverStats.bandwidthInKbps)),
        `CPU ${serverStats.cpuPct}%`,
        tf("负载 {0}", serverStats.load1.toFixed(2)),
        tf("内存 {0}%", serverStats.memoryPct),
        tf("事件循环延迟 {0} ms", serverStats.lagMs),
        tf("当前 {0} 路远控 · {1} 个在线连接", serverStats.sessions, serverStats.peers),
      ].join(" · ")
    : undefined;
  const clipboardTitle = !channelReady
    ? t("控制通道建立后可同步剪贴板")
    : !clipboardAllowed
      ? t("对方未允许剪贴板同步")
      : clipboardEnabled
        ? t("关闭剪贴板同步")
        : t("开启剪贴板同步（仅文本，请确认对方可信）");

  return (
    <div className={`session-shell${fullscreen ? " is-fullscreen" : ""}`} ref={shellRef}>
      <div className="session-toolbar">
        <div className="session-peer">
          <span className="peer-avatar">{(hostName?.name ?? t("远")).slice(0, 1).toUpperCase()}</span>
          <div className="peer-meta">
            <strong>{hostName?.name ?? t("远程设备")}</strong>
            <span className={`session-state ${channelReady ? "online" : ""}`}>
              <span className="live-dot" />
              {channelReady
                ? inputPaused
                  ? t("仅查看 · 输入已暂停")
                  : t("安全连接")
                : t("正在建立加密通道")}
            </span>
          </div>
        </div>

        <div className="session-stats">
          {stats && stats.width > 0 && (
            <span className="stat-chip">
              {stats.width}×{stats.height}
            </span>
          )}
          {stats && stats.fps > 0 && <span className="stat-chip">{stats.fps} FPS</span>}
          {stats && stats.kbps > 0 && <span className="stat-chip">{formatKbps(stats.kbps)}</span>}
          {stats && stats.rttMs > 0 && <span className="stat-chip">{stats.rttMs} ms</span>}
          {stats && stats.lossPct >= 0.5 && (
            <span className="stat-chip warn">{t("丢包")} {stats.lossPct.toFixed(1)}%</span>
          )}
          {channelReady && (
            <span
              className={`stat-chip verdict ${verdict.level}`}
              title={tf("网络质量：{0}", verdict.detail)}
            >
              {verdict.label}
            </span>
          )}
          {serverStats && (
            <span className="stat-chip server" title={serverHint}>
              {t("本服")} {serverStats.sessions} {t("路远控")}
            </span>
          )}
          {serverStats && (
            <span className="stat-chip server" title={serverHint}>
              {t("服务器 ↓")}{formatKbps(serverStats.bandwidthOutKbps)} ↑
              {formatKbps(serverStats.bandwidthInKbps)}
            </span>
          )}
          {connected && <span className="stat-chip timer">{formatDuration(elapsed)}</span>}
          {endsAt && (
            <span className="stat-chip warn" title={t("服务器限制的单次远控时长，到时自动结束")}>
              {t("剩余")} {formatDuration(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))}
            </span>
          )}
        </div>

        <div className="session-tools">
          <div className="view-switch" role="group" aria-label={t("画面缩放")}>
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={viewMode === mode.id ? "active" : ""}
                aria-pressed={viewMode === mode.id}
                title={mode.hint}
                onClick={() => setViewMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <select
            className="quality-select"
            value={quality}
            disabled={!channelReady}
            onChange={(event) => onChangeQuality(event.target.value as QualityPreset)}
            title={QUALITY_PROFILES[quality].hint}
            aria-label={t("画质档位")}
          >
            {QUALITY_ORDER.map((preset) => (
              <option key={preset} value={preset}>
                {QUALITY_PROFILES[preset].label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`icon-button on-dark${clipboardActive ? " is-active" : ""}`}
            onClick={onToggleClipboard}
            disabled={!channelReady || !clipboardAllowed}
            aria-label={t("剪贴板同步")}
            aria-pressed={clipboardActive}
            title={clipboardTitle}
          >
            <ClipboardIcon size={16} />
          </button>

          <div className="session-tool-wrap">
            <button
              type="button"
              className={`icon-button on-dark${chatOpen ? " is-active" : ""}`}
              onClick={toggleChat}
              aria-label={t("会话消息")}
              aria-expanded={chatOpen}
              title={t("会话消息")}
            >
              <ChatIcon size={16} />
            </button>
            {unread > 0 && <span className="tool-badge">{unread > 9 ? "9+" : unread}</span>}
          </div>

          <button
            type="button"
            className="icon-button on-dark"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? t("退出全屏") : t("全屏")}
            title={fullscreen ? t("退出全屏") : t("全屏")}
          >
            {fullscreen ? <ExitFullscreenIcon size={17} /> : <FullscreenIcon size={17} />}
          </button>
          <button type="button" className="button danger small" onClick={onDisconnect}>
            <PowerIcon size={15} />
            {t("结束控制")}
          </button>
        </div>
      </div>

      <div className="session-stage-wrap">
        <div
          className={`video-stage view-${viewMode}${inputPaused ? " is-input-paused" : ""}`}
          ref={stageRef}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={releaseOnBlur}
        >
        {stream ? (
          <video
            ref={videoRef}
            className={`remote-video view-${viewMode}`}
            style={actualStyle}
            autoPlay
            playsInline
            data-testid="remote-video"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setVideoSize({ width: video.videoWidth, height: video.videoHeight });
              }
            }}
          />
        ) : (
          <div className="video-placeholder">
            <span className="spinner large" />
            <span>{t("正在建立端到端加密画面…")}</span>
          </div>
        )}

        {!channelReady && (
          <div className="video-overlay">
            <span className="spinner light" />
            {t("正在协商控制通道")}
          </div>
        )}

        {inputPaused && channelReady && (
          <div className="input-paused-banner">
            <PauseIcon size={16} />
            <div>
              <strong>{t("对方已暂停输入")}</strong>
              <span>{t("画面仍然实时可见，键盘和鼠标暂不会发送。")}</span>
            </div>
          </div>
        )}

        <div className="video-hint">
          {inputPaused ? (
            <>
              <PauseIcon size={14} />
              {t("对方已暂停你的输入")}
            </>
          ) : (
            <>
              <MousePointerIcon size={14} />
              {t("点击画面后即可操作")}
              <span className="hint-divider" />
              <KeyboardIcon size={14} />
              {t("键盘将发送到对方")}
            </>
          )}
          <span className="hint-divider" />
          <LockIcon size={14} />
          DTLS-SRTP
        </div>
        </div>

        {chatOpen && (
          <section className="session-chat" aria-label={t("会话消息")}>
            <header className="session-chat-head">
              <div>
                <strong>{t("会话消息")}</strong>
                <span>{t("仅本次连接可见")}</span>
              </div>
              <button
                type="button"
                className="icon-button on-dark chat-close"
                onClick={() => setChatOpen(false)}
                aria-label={t("关闭会话消息")}
              >
                <XIcon size={14} />
              </button>
            </header>
            <div className="session-chat-list" ref={chatListRef}>
              {chatMessages.length === 0 ? (
                <p className="session-chat-empty">{t("发消息给对方，内容不经过服务器。")}</p>
              ) : (
                chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`chat-row ${message.from === "self" ? "self" : "peer"}`}
                  >
                    <div className="chat-bubble">{message.text}</div>
                    <span className="chat-time">{formatTime(message.at)}</span>
                  </div>
                ))
              )}
            </div>
            <form
              className="session-chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitChat();
              }}
            >
              <input
                ref={chatInputRef}
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                maxLength={CHAT_TEXT_LIMIT}
                placeholder={t("输入消息，Enter 发送")}
                aria-label={t("聊天消息")}
              />
              <button
                type="submit"
                className="button primary small"
                disabled={!chatDraft.trim()}
                aria-label={t("发送消息")}
              >
                <SendIcon size={14} />
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
