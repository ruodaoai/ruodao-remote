import { useEffect, useRef, useState } from "react";
import type { HostPhase } from "../hooks/useHost";
import type { AccessRejectReason, HostControlRequestInfo } from "../lib/signaling";
import { formatDuration, useElapsed } from "../hooks/useElapsed";
import { errorQuestion } from "../lib/diagnosis";
import { formatCode, formatKey } from "../lib/key";
import { CHAT_TEXT_LIMIT } from "../lib/session-channel";
import type { HostSessionInfo, SessionChatMessage, Settings } from "../types";
import {
  ArrowRightIcon,
  ChatIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyboardIcon,
  LockIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  RefreshIcon,
  SendIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "./icons";
import { CopyButton, HelpTip, InlineAlert, StatusPill } from "./ui";

interface HostPanelProps {
  phase: HostPhase;
  code: string;
  accessKey: string;
  keyVisible: boolean;
  keyPersisted: boolean;
  session: HostSessionInfo | null;
  preview: MediaStream | null;
  error: string | null;
  accessIssue: AccessRejectReason | null;
  busy: "rotating" | null;
  identityReady: boolean;
  inputPaused: boolean;
  clipboardAllowed: boolean;
  chatMessages: SessionChatMessage[];
  published: boolean;
  publishNote: string;
  publishBusy: boolean;
  requests: HostControlRequestInfo[];
  settings: Settings;
  autoStartHost: boolean;
  launchAtLogin: boolean;
  onStart: () => void;
  onStop: () => void;
  onRotateKey: () => void;
  onToggleKey: () => void;
  onTogglePause: () => void;
  onToggleClipboard: () => void;
  onToggleAutoStart: (value: boolean) => void;
  onToggleLaunchAtLogin: (value: boolean) => void;
  onSendChat: (text: string) => boolean;
  onSetPublish: (published: boolean, note: string) => void;
  onDecideRequest: (requestId: string, accept: boolean) => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onAskAi: (question?: string) => void;
}

function platformLabel(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return "未知平台";
}

function statusFor(phase: HostPhase, hasSession: boolean): { tone: "idle" | "busy" | "online" | "error"; label: string } {
  if (phase === "online") return { tone: "online", label: hasSession ? "被控中" : "已上线" };
  if (phase === "pending") return { tone: "busy", label: "等待批准" };
  if (phase === "connecting") return { tone: "busy", label: "正在上线" };
  if (phase === "error") return { tone: "error", label: "连接异常" };
  return { tone: "idle", label: "未上线" };
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return <video ref={ref} className="preview-video" muted autoPlay playsInline />;
}

function WaitingCard() {
  return (
    <div className="side-card waiting-card">
      <div className="radar">
        <span className="radar-ring ring-one" />
        <span className="radar-ring ring-two" />
        <span className="radar-core">
          <MonitorIcon size={26} />
        </span>
      </div>
      <h2>等待对方连接</h2>
      <p>把远控码和访问密钥发给可信的人；也可以开启共享，让本服成员提交申请后再由你同意。</p>
      <div className="waiting-hints">
        <span>
          <LockIcon size={14} /> 密钥本地校验
        </span>
        <span>
          <ShieldIcon size={14} /> 端到端加密
        </span>
        <span>
          <KeyboardIcon size={14} /> 可随时下线
        </span>
      </div>
    </div>
  );
}

function ApprovalCard() {
  return (
    <div className="side-card waiting-card approval-card">
      <div className="radar">
        <span className="radar-ring ring-one" />
        <span className="radar-ring ring-two" />
        <span className="radar-core">
          <ShieldIcon size={26} />
        </span>
      </div>
      <h2>等待管理员批准</h2>
      <p>
        这台电脑已提交上线请求，管理员批准后会自动生成远控码并继续上线，无需重新操作。
      </p>
      <div className="waiting-hints">
        <span>
          <ShieldIcon size={14} /> 管理员审核中
        </span>
        <span>
          <RefreshIcon size={14} /> 每 5 秒自动检查
        </span>
      </div>
    </div>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function ControlRequests({
  requests,
  onDecide,
}: {
  requests: HostControlRequestInfo[];
  onDecide: (requestId: string, accept: boolean) => void;
}) {
  const now = useNow(requests.length > 0);
  return (
    <div className="side-card request-card">
      <div className="request-head">
        <span className="live-badge request">
          <span className="live-dot" />
          待处理申请
        </span>
        <span className="request-count">{requests.length}</span>
      </div>
      <h2>有人想控制这台电脑</h2>
      <p>同意后对方会在 60 秒内建立加密连接；拒绝不会泄露远控码或访问密钥。</p>
      <ul className="request-list">
        {requests.map((request) => {
          const left = Math.max(0, Math.ceil((request.expiresAt - now) / 1000));
          return (
            <li key={request.id} className="request-item">
              <span className="request-avatar">{request.controllerName.slice(0, 1)}</span>
              <div className="request-main">
                <strong>{request.controllerName}</strong>
                <span>
                  {platformLabel(request.platform)} ·{" "}
                  {left > 0 ? `${left} 秒后失效` : "即将失效"}
                </span>
              </div>
              <div className="request-actions">
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => onDecide(request.id, true)}
                >
                  <CheckIcon size={14} />
                  允许
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => onDecide(request.id, false)}
                >
                  <XIcon size={14} />
                  拒绝
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="request-foot">
        <ShieldIcon size={14} />
        只有你点“允许”后才会建立连接
      </div>
    </div>
  );
}

function HostChat({
  messages,
  onSend,
}: {
  messages: SessionChatMessage[];
  onSend: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submit(): void {
    const text = draft.trim();
    if (!text) return;
    if (onSend(text)) setDraft("");
  }

  return (
    <div className="host-chat">
      <div className="host-chat-head">
        <strong>会话消息</strong>
        <span>仅本次连接可见</span>
      </div>
      <div className="host-chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="host-chat-empty">对方发来的消息会显示在这里</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-row ${message.from === "self" ? "self" : "peer"}`}
            >
              <div className="chat-bubble">{message.text}</div>
              <span className="chat-time">
                {new Date(message.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
      </div>
      <form
        className="host-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_TEXT_LIMIT}
          placeholder="输入消息，Enter 发送"
          aria-label="聊天消息"
        />
        <button
          type="submit"
          className="button ghost small"
          disabled={!draft.trim()}
          aria-label="发送消息"
        >
          <SendIcon size={14} />
          发送
        </button>
      </form>
    </div>
  );
}

function ActiveSession({
  session,
  preview,
  inputPaused,
  clipboardAllowed,
  chatMessages,
  onStop,
  onTogglePause,
  onToggleClipboard,
  onSendChat,
}: {
  session: HostSessionInfo;
  preview: MediaStream | null;
  inputPaused: boolean;
  clipboardAllowed: boolean;
  chatMessages: SessionChatMessage[];
  onStop: () => void;
  onTogglePause: () => void;
  onToggleClipboard: () => void;
  onSendChat: (text: string) => boolean;
}) {
  const elapsed = useElapsed(session.startedAt);
  const remainingMs = session.endsAt ? Math.max(0, session.endsAt - Date.now()) : null;
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const lastChatCountRef = useRef(0);

  useEffect(() => {
    const added = chatMessages.length - lastChatCountRef.current;
    lastChatCountRef.current = chatMessages.length;
    if (added <= 0 || chatOpen) return;
    const latest = chatMessages[chatMessages.length - 1];
    if (latest?.from === "peer") setUnread((value) => value + added);
  }, [chatMessages, chatOpen]);

  function toggleChat(): void {
    const next = !chatOpen;
    setChatOpen(next);
    if (next) setUnread(0);
  }

  return (
    <div className="side-card session-card live">
      <div className="live-head">
        <span className={`live-badge${inputPaused ? " view-only" : ""}`}>
          <span className="live-dot" />
          {inputPaused ? "仅查看中" : "正在被控制"}
        </span>
        <div className="live-head-actions">
          <span className="live-timer">{formatDuration(elapsed)}</span>
          <button
            type="button"
            className={`host-chat-button${chatOpen ? " active" : ""}`}
            onClick={toggleChat}
            aria-expanded={chatOpen}
            aria-label="会话消息"
            title="会话消息"
          >
            <ChatIcon size={15} />
            {unread > 0 && (
              <span className="tool-badge">{unread > 9 ? "9+" : unread}</span>
            )}
          </button>
        </div>
      </div>
      <div className="preview-shell">
        {preview ? (
          <PreviewVideo stream={preview} />
        ) : (
          <div className="preview-placeholder">
            <MonitorIcon size={28} />
            <span>正在准备画面…</span>
          </div>
        )}
        <div className="preview-caption">
          {session.controllerName} {inputPaused ? "正在观看画面" : "正在操作这台电脑"}
        </div>
      </div>
      <div className="session-meta">
        <div>
          <span className="meta-label">控制方</span>
          <strong>{session.controllerName}</strong>
        </div>
        <div>
          <span className="meta-label">系统</span>
          <span>{platformLabel(session.platform)}</span>
        </div>
        <div>
          <span className="meta-label">来源 IP</span>
          <span>{session.ip || "未知"}</span>
        </div>
        {remainingMs !== null && (
          <div>
            <span className="meta-label">剩余时长</span>
            <span>{formatDuration(Math.floor(remainingMs / 1000))}</span>
          </div>
        )}
      </div>
      <div className="host-session-tools">
        <button
          type="button"
          className={`host-tool${inputPaused ? " active" : ""}`}
          onClick={onTogglePause}
          aria-pressed={inputPaused}
        >
          {inputPaused ? <PlayIcon size={15} /> : <PauseIcon size={15} />}
          <span>{inputPaused ? "恢复操作" : "暂停操作"}</span>
        </button>
        <button
          type="button"
          className={`host-tool${clipboardAllowed ? " active" : ""}`}
          onClick={onToggleClipboard}
          aria-pressed={clipboardAllowed}
        >
          <ClipboardIcon size={15} />
          <span>剪贴板{clipboardAllowed ? "已允许" : "未允许"}</span>
        </button>
      </div>
      {chatOpen && <HostChat messages={chatMessages} onSend={onSendChat} />}
      <button type="button" className="button danger wide" onClick={onStop}>
        <PowerIcon size={16} /> 结束会话并下线
      </button>
      <p className="tiny-note">
        {inputPaused
          ? "对方仅能观看画面。剪贴板仅文本，可能含密码，请确认可信。"
          : "键鼠直接作用于本机。剪贴板仅文本，可能含密码，请确认可信。"}
      </p>
    </div>
  );
}

function IdleGuide() {
  return (
    <div className="side-card guide-card">
      <div className="guide-icon">
        <ShieldIcon size={26} />
      </div>
      <h2>只需一串号码</h2>
      <p>对方向你要远控码和密钥，输入后即可建立加密连接，全程不需要注册账号。</p>
      <ol className="steps">
        <li>
          <span className="step-index">1</span>
          <div>
            <strong>开始被控</strong>
            <p>点击开始，应用会共享主屏幕并生成远控码。</p>
          </div>
        </li>
        <li>
          <span className="step-index">2</span>
          <div>
            <strong>对方输入号码</strong>
            <p>9 位远控码 + 10 位密钥，服务器只做密钥哈希校验。</p>
          </div>
        </li>
        <li>
          <span className="step-index">3</span>
          <div>
            <strong>建立加密画面</strong>
            <p>视频走 WebRTC 端到端加密，服务器无法看到画面。</p>
          </div>
        </li>
      </ol>
      <div className="guide-foot">
        <LockIcon size={14} />
        <span>密钥不会以明文离开这台电脑</span>
        <ArrowRightIcon size={14} />
      </div>
    </div>
  );
}

function AutoStartCard({
  autoStartHost,
  launchAtLogin,
  onToggleAutoStart,
  onToggleLaunchAtLogin,
}: {
  autoStartHost: boolean;
  launchAtLogin: boolean;
  onToggleAutoStart: (value: boolean) => void;
  onToggleLaunchAtLogin: (value: boolean) => void;
}) {
  return (
    <div
      className={`auto-start-card${autoStartHost ? " on" : ""}`}
      data-testid="auto-start-card"
    >
      <span className="auto-start-icon">
        <PowerIcon size={20} />
      </span>
      <div className="auto-start-copy">
        <div className="auto-start-head">
          <strong>不想每次手动点“开始被控”？把它设成常驻</strong>
          {autoStartHost && <span className="auto-start-badge">已开启</span>}
        </div>
        <p>
          开启“启动后自动被控”后，每次打开若道远程都会自动共享主屏幕并生成远控码；再开启“开机自动启动”，电脑重启后也会自动上线，不用再手动点开始。
        </p>
      </div>
      <div className="auto-start-controls">
        <div className="auto-start-control">
          <div className="auto-start-control-copy">
            <strong>启动后自动被控</strong>
            <span>打开应用即共享主屏幕</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoStartHost}
            aria-label="启动后自动被控"
            data-testid="auto-start-host"
            className={`switch${autoStartHost ? " on" : ""}`}
            onClick={() => onToggleAutoStart(!autoStartHost)}
          >
            <span />
          </button>
        </div>
        <span className="auto-start-divider" aria-hidden="true" />
        <div className="auto-start-control">
          <div className="auto-start-control-copy">
            <strong>开机自动启动</strong>
            <span>登录系统后自动打开客户端</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={launchAtLogin}
            aria-label="开机自动启动"
            data-testid="auto-start-login"
            className={`switch${launchAtLogin ? " on" : ""}`}
            onClick={() => onToggleLaunchAtLogin(!launchAtLogin)}
          >
            <span />
          </button>
        </div>
      </div>
    </div>
  );
}

export function HostPanel({
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
  settings,
  autoStartHost,
  launchAtLogin,
  onStart,
  onStop,
  onRotateKey,
  onToggleKey,
  onTogglePause,
  onToggleClipboard,
  onToggleAutoStart,
  onToggleLaunchAtLogin,
  onSendChat,
  onSetPublish,
  onDecideRequest,
  onOpenSettings,
  onOpenGuide,
  onAskAi,
}: HostPanelProps) {
  const [noteDraft, setNoteDraft] = useState(publishNote);
  useEffect(() => {
    setNoteDraft(publishNote);
  }, [publishNote]);

  const status = statusFor(phase, Boolean(session));
  const online = phase === "online";
  const pending = phase === "pending";
  const connecting = phase === "connecting";
  const showCode = online && Boolean(code);
  const inviteIssue = accessIssue === "invite-required" || accessIssue === "invite-invalid";

  return (
    <section className="panel host-panel" data-testid="host-state" data-state={phase}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <MonitorIcon size={14} />
            </span>
            本机被控
          </span>
          <h1>把这台电脑临时交给可信的人</h1>
          <p>告知对方远控码与访问密钥即可连接，无需注册，也不依赖账号体系。</p>
        </div>
        <StatusPill tone={status.tone} label={status.label} />
      </div>

      {!session && phase !== "online" && phase !== "pending" && (
        <HelpTip
          title="第一次被控？"
          onOpenGuide={onOpenGuide}
          onAskAi={() =>
            onAskAi(
              error
                ? errorQuestion("本机被控", error)
                : "我想让别人控制我的电脑，应该怎么操作？",
            )
          }
        >
          先点“开始被控”，再把 9 位远控码和 10 位访问密钥一起发给对方；访问密钥只在本机校验。
        </HelpTip>
      )}

      {!session && phase !== "online" && phase !== "pending" && phase !== "connecting" && (
        <AutoStartCard
          autoStartHost={autoStartHost}
          launchAtLogin={launchAtLogin}
          onToggleAutoStart={onToggleAutoStart}
          onToggleLaunchAtLogin={onToggleLaunchAtLogin}
        />
      )}

      <div className="host-layout">
        <div className="identity-panel">
          <div className={`identity-block code-block ${showCode ? "" : "is-empty"}`}>
            <div className="block-top">
              <span className="block-label">远控码</span>
              <CopyButton value={code} label="复制远控码" withLabel />
            </div>
            <div
              className="remote-code"
              data-testid="remote-code"
              data-code={code}
            >
              {showCode ? formatCode(code) : "000 000 000"}
            </div>
            <div className="block-foot">
              <span className="block-foot-icon">
                <ArrowRightIcon size={13} />
              </span>
              {pending
                ? "管理员批准后将自动生成远控码"
                : "对方在“控制远程设备”页输入这串号码"}
            </div>
          </div>

          <div className="identity-block key-block">
            <div className="block-top">
              <span className="block-label">访问密钥</span>
              <div className="mini-actions">
                <button
                  type="button"
                  className="icon-button subtle"
                  onClick={onToggleKey}
                  aria-label={keyVisible ? "隐藏密钥" : "显示密钥"}
                  title={keyVisible ? "隐藏密钥" : "显示密钥"}
                >
                  {keyVisible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={accessKey} label="复制访问密钥" />
              </div>
            </div>
            <div
              className="access-key"
              data-testid="access-key"
              data-key={accessKey}
            >
              {keyVisible ? formatKey(accessKey) : "••••• •••••"}
            </div>
            <div className="block-foot">
              <span className="block-foot-icon">
                <LockIcon size={13} />
              </span>
              本机生成，服务器只保存加盐哈希
            </div>
          </div>

          <div className={`share-block${published ? " on" : ""}`}>
            <div className="share-head">
              <div className="share-copy">
                <span className="block-label">共享给本服成员</span>
                <strong>{published ? "已发布，等待申请" : "未发布"}</strong>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={published}
                aria-label="共享给本服成员"
                data-testid="host-publish-toggle"
                className={`switch${published ? " on" : ""}`}
                disabled={!online || publishBusy}
                onClick={() => onSetPublish(!published, noteDraft)}
              >
                <span />
              </button>
            </div>
            <p className="share-hint">
              {online
                ? "开启后，本服已接入的成员可以申请控制这台电脑；每一条申请都需要你同意。"
                : "开始被控后，可以把本机共享给本服成员。"}
            </p>
            {online && (
              <div className="share-note-row">
                <input
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value.slice(0, 120))}
                  placeholder="说明，例如：工作站，晚上 8 点后可用"
                  aria-label="共享说明"
                  disabled={publishBusy}
                  maxLength={120}
                />
                {published && noteDraft.trim() !== publishNote && (
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => onSetPublish(true, noteDraft)}
                    disabled={publishBusy}
                  >
                    保存说明
                  </button>
                )}
              </div>
            )}
            {requests.length > 0 && (
              <span className="share-badge">{requests.length} 条待处理申请</span>
            )}
          </div>

          <div className="host-actions">
            {online || pending ? (
              <button type="button" className="button danger-soft" onClick={onStop}>
                <PowerIcon size={17} />
                {pending ? "取消等待" : "停止被控"}
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                data-testid="host-toggle"
                onClick={onStart}
                disabled={!identityReady || connecting}
              >
                {connecting ? <span className="spinner" /> : <MonitorIcon size={17} />}
                {connecting ? "正在共享屏幕…" : phase === "error" ? "重新上线" : "开始被控"}
              </button>
            )}
            <button
              type="button"
              className="button ghost"
              onClick={onRotateKey}
              disabled={Boolean(busy)}
            >
              <RefreshIcon size={16} />
              {busy ? "生成中…" : "更换密钥"}
            </button>
          </div>

          {error && <InlineAlert>{error}</InlineAlert>}
          {(error || inviteIssue) && (
            <div className="inline-actions">
              {inviteIssue && (
                <button type="button" className="text-button" onClick={onOpenSettings}>
                  去设置中填写邀请码
                </button>
              )}
              {error && (
                <button
                  type="button"
                  className="text-button ai"
                  onClick={() => onAskAi(errorQuestion("本机被控", error))}
                >
                  <SparkIcon size={13} />
                  让 AI 分析这个错误
                </button>
              )}
            </div>
          )}
          {!keyPersisted && (
            <p className="tiny-note">
              当前系统无法加密保存密钥，重启应用后会生成新的访问密钥。
            </p>
          )}

          <div className="server-line">
            <ServerIcon size={14} />
            <span className="server-url">{settings.serverUrl}</span>
            <span className="server-divider" />
            <span>仅转发信令</span>
            <span className="server-divider" />
            <span>{settings.deviceName}</span>
          </div>
        </div>

        {session ? (
          <ActiveSession
            session={session}
            preview={preview}
            inputPaused={inputPaused}
            clipboardAllowed={clipboardAllowed}
            chatMessages={chatMessages}
            onStop={onStop}
            onTogglePause={onTogglePause}
            onToggleClipboard={onToggleClipboard}
            onSendChat={onSendChat}
          />
        ) : pending ? (
          <ApprovalCard />
        ) : online && requests.length > 0 ? (
          <ControlRequests requests={requests} onDecide={onDecideRequest} />
        ) : online || connecting ? (
          <WaitingCard />
        ) : (
          <IdleGuide />
        )}
      </div>

      <div className="panel-foot trust-row">
        <span>
          <ShieldIcon size={14} /> DTLS-SRTP 端到端加密
        </span>
        <span>
          <LockIcon size={14} /> 密钥不上传服务器
        </span>
        <span>
          <CopyIcon size={14} /> 远控码仅本次在线有效
        </span>
      </div>
    </section>
  );
}
