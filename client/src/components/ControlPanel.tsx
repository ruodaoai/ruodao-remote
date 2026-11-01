import { useEffect, useState } from "react";
import type { ControllerPhase } from "../hooks/useController";
import type { CatalogRequestState, CatalogStatus } from "../hooks/useCatalog";
import {
  formatCode,
  formatKey,
  isCompleteCode,
  isCompleteKey,
  normalizeCodeInput,
  normalizeKeyInput,
} from "../lib/key";
import type { InputEventPayload } from "../lib/input";
import { errorQuestion } from "../lib/diagnosis";
import type { AccessRejectReason, CatalogHost, PeerProfile } from "../lib/signaling";
import type { ServerStats, SessionStats, Settings } from "../types";
import type { QualityPreset, SessionChatMessage } from "../types";
import { SessionView } from "./SessionView";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  LockIcon,
  MonitorIcon,
  PowerIcon,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
} from "./icons";
import { HelpTip, InlineAlert, StatusPill } from "./ui";

interface ControlPanelProps {
  phase: ControllerPhase;
  hostName: PeerProfile | null;
  error: string | null;
  accessIssue: AccessRejectReason | null;
  stream: MediaStream | null;
  stats: SessionStats | null;
  serverStats: ServerStats | null;
  sessionEndsAt?: number | null;
  channelReady: boolean;
  inputPaused: boolean;
  clipboardAllowed: boolean;
  clipboardEnabled: boolean;
  quality: QualityPreset;
  chatMessages: SessionChatMessage[];
  settings: Settings;
  catalogHosts: CatalogHost[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  catalogRequest: CatalogRequestState | null;
  initialCode?: string;
  initialKey?: string;
  onConnect: (code: string, key: string) => void;
  onDisconnect: () => void;
  sendInput: (payload: InputEventPayload) => boolean;
  onDangerShortcut: (action: string) => void;
  onToggleClipboard: () => void;
  onChangeQuality: (preset: QualityPreset) => void;
  onSendChat: (text: string) => boolean;
  onRequestHost: (host: CatalogHost) => void;
  onCancelRequest: () => void;
  onRefreshCatalog: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onAskAi: (question?: string) => void;
}

function statusFor(phase: ControllerPhase): { tone: "idle" | "busy" | "online" | "error"; label: string } {
  switch (phase) {
    case "lookup":
      return { tone: "busy", label: "正在查找" };
    case "waiting":
      return { tone: "busy", label: "等待批准" };
    case "verifying":
      return { tone: "busy", label: "正在验证" };
    case "connecting":
      return { tone: "busy", label: "建立通道" };
    case "connected":
      return { tone: "online", label: "控制中" };
    case "error":
      return { tone: "error", label: "连接失败" };
    default:
      return { tone: "idle", label: "待连接" };
  }
}

function ConnectionProgress({ phase, onCancel }: { phase: ControllerPhase; onCancel: () => void }) {
  const steps = [
    { label: "查找设备", state: phase === "lookup" ? "active" : "done" },
    { label: "验证访问密钥", state: phase === "lookup" ? "todo" : phase === "verifying" ? "active" : "done" },
    { label: "建立加密控制通道", state: phase === "connecting" ? "active" : "todo" },
  ];
  return (
    <div className="connection-progress">
      <ol>
        {steps.map((step) => (
          <li key={step.label} className={`progress-step ${step.state}`}>
            <span className="progress-marker">
              {step.state === "done" ? (
                "✓"
              ) : step.state === "active" ? (
                <span className="spinner small" />
              ) : (
                <span className="step-dot" />
              )}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <button type="button" className="text-button" onClick={onCancel}>
        取消连接
      </button>
    </div>
  );
}

function ApprovalWait({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="connection-progress approval-wait">
      <div className="approval-wait-head">
        <span className="spinner" />
        <div>
          <strong>等待管理员批准</strong>
          <p>此客户端已提交远控请求，服务器管理员批准后会自动继续连接。</p>
        </div>
      </div>
      <button type="button" className="text-button" onClick={onCancel}>
        取消连接
      </button>
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

function platformLabel(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return "未知平台";
}

function SharedCatalog({
  hosts,
  status,
  error,
  request,
  onRequestHost,
  onCancelRequest,
  onRefresh,
}: {
  hosts: CatalogHost[];
  status: CatalogStatus;
  error: string | null;
  request: CatalogRequestState | null;
  onRequestHost: (host: CatalogHost) => void;
  onCancelRequest: () => void;
  onRefresh: () => void;
}) {
  const now = useNow(Boolean(request));
  const left = request ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : 0;

  return (
    <section className="catalog-card" id="shared-catalog" data-testid="shared-catalog">
      <div className="catalog-head">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <ServerIcon size={14} />
            </span>
            本服共享
          </span>
          <h2>共享设备</h2>
          <p>本服务器成员主动发布的电脑，申请经对方同意后才会建立连接。</p>
        </div>
        <button
          type="button"
          className="icon-button subtle"
          onClick={onRefresh}
          disabled={status === "loading"}
          aria-label="刷新共享列表"
          title="刷新共享列表"
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      {request && (
        <div className="catalog-wait" data-testid="catalog-request">
          <span className="spinner small" />
          <div className="catalog-wait-copy">
            <strong>已向“{request.hostName}”发送远控申请</strong>
            <span>
              等待对方同意，{left > 0 ? `${left} 秒后失效` : "即将失效"}；对方拒绝或超时后可重新申请。
            </span>
          </div>
          <button type="button" className="button ghost small" onClick={onCancelRequest}>
            取消申请
          </button>
        </div>
      )}

      {error && !request && <InlineAlert>{error}</InlineAlert>}

      {hosts.length === 0 ? (
        status === "loading" ? (
          <div className="catalog-empty">
            <span className="spinner small" />
            <span>正在读取共享列表…</span>
          </div>
        ) : status === "error" ? null : (
          <div className="catalog-empty">
            <ServerIcon size={18} />
            <span>还没有成员发布设备。让对方在「本机被控」页打开“共享给本服成员”即可出现在这里。</span>
          </div>
        )
      ) : (
        <ul className="catalog-list">
          {hosts.map((host) => {
            const requesting = request?.hostDeviceId === host.deviceId;
            const disabled = host.busy || Boolean(request) || status !== "ready";
            return (
              <li key={host.deviceId} className="catalog-item">
                <span className="catalog-avatar">{host.name.slice(0, 1)}</span>
                <div className="catalog-main">
                  <div className="catalog-title">
                    <strong>{host.name}</strong>
                    <span className="catalog-tag">{platformLabel(host.platform)}</span>
                    {host.busy && <span className="catalog-tag busy">正在被控</span>}
                  </div>
                  <p>{host.note || "未填写共享说明"}</p>
                </div>
                <button
                  type="button"
                  className="button ghost small catalog-action"
                  disabled={disabled}
                  onClick={() => onRequestHost(host)}
                  title={
                    host.busy
                      ? "对方正在被控，暂时无法申请"
                      : request && !requesting
                        ? "已有待处理的申请"
                        : undefined
                  }
                >
                  {requesting ? "已申请" : host.busy ? "忙线中" : "申请远控"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConnectAside() {
  return (
    <aside className="side-card connect-card">
      <div className="link-visual" aria-hidden="true">
        <div className="mini-screen">
          <MonitorIcon size={22} />
          <span>本机</span>
        </div>
        <div className="link-beam">
          <span className="beam-line" />
          <span className="beam-lock">
            <LockIcon size={14} />
          </span>
        </div>
        <div className="mini-screen remote">
          <MonitorIcon size={22} />
          <span>对方</span>
        </div>
      </div>
      <h2>优先点对点直连</h2>
      <p>
        同一局域网或网络可直连时，画面不经过服务器中转；无法直连时自动使用
        TURN 中继，内容仍是端到端加密。
      </p>
      <ul className="fact-list">
        <li>
          <LockIcon size={15} />
          密钥只在本地参与 PBKDF2 校验
        </li>
        <li>
          <ShieldIcon size={15} />
          画面由 DTLS-SRTP 加密传输
        </li>
        <li>
          <PowerIcon size={15} />
          随时可点击“结束控制”断开
        </li>
      </ul>
      <div className="aside-note">
        <ArrowRightIcon size={14} />
        没有账号、没有密码找回，只有远控码和密钥。
      </div>
    </aside>
  );
}

export function ControlPanel({
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
  settings,
  catalogHosts,
  catalogStatus,
  catalogError,
  catalogRequest,
  initialCode = "",
  initialKey = "",
  onConnect,
  onDisconnect,
  sendInput,
  onDangerShortcut,
  onToggleClipboard,
  onChangeQuality,
  onSendChat,
  onRequestHost,
  onCancelRequest,
  onRefreshCatalog,
  onOpenSettings,
  onOpenGuide,
  onAskAi,
}: ControlPanelProps) {
  const [code, setCode] = useState(() => normalizeCodeInput(initialCode));
  const [key, setKey] = useState(() => normalizeKeyInput(initialKey));
  const [showKey, setShowKey] = useState(false);

  const busy =
    phase === "lookup" || phase === "waiting" || phase === "verifying" || phase === "connecting";
  const ready = isCompleteCode(code) && isCompleteKey(key);
  const inSession = phase === "connected" || (phase === "connecting" && stream !== null);
  const status = statusFor(phase);
  const inviteIssue = accessIssue === "invite-required" || accessIssue === "invite-invalid";

  if (inSession) {
    return (
      <section
        className="panel control-panel session-mode"
        data-testid="connection-state"
        data-state={phase}
      >
        <SessionView
          stream={stream}
          hostName={hostName}
          stats={stats}
          serverStats={serverStats}
          endsAt={sessionEndsAt}
          channelReady={channelReady}
          connected={phase === "connected"}
          inputPaused={inputPaused}
          clipboardAllowed={clipboardAllowed}
          clipboardEnabled={clipboardEnabled}
          quality={quality}
          chatMessages={chatMessages}
          sendInput={sendInput}
          onDangerShortcut={onDangerShortcut}
          onToggleClipboard={onToggleClipboard}
          onChangeQuality={onChangeQuality}
          onSendChat={onSendChat}
          onDisconnect={onDisconnect}
        />
      </section>
    );
  }

  return (
    <section
      className="panel control-panel"
      data-testid="connection-state"
      data-state={phase}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <MonitorIcon size={14} />
            </span>
            远程控制
          </span>
          <h1>连接另一台电脑</h1>
          <p>输入对方“本机被控”页显示的远控码与访问密钥，无需注册账号。</p>
        </div>
        <div className="panel-heading-actions">
          {catalogHosts.length > 0 && (
            <button
              type="button"
              className="catalog-jump"
              onClick={() =>
                document
                  .getElementById("shared-catalog")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              title="查看本服共享设备"
            >
              <ServerIcon size={14} />
              共享设备 {catalogHosts.length}
            </button>
          )}
          <StatusPill tone={status.tone} label={status.label} />
        </div>
      </div>

      <HelpTip
        title="连接前先确认"
        onOpenGuide={onOpenGuide}
        onAskAi={() =>
          onAskAi(
            error
              ? errorQuestion("控制远程设备", error)
              : "我想控制另一台电脑，需要对方提供什么？",
          )
        }
      >
        对方需要在「本机被控」页保持在线，并把 9 位远控码和 10 位访问密钥一起发给你；两端服务器地址要一致。也可以从下方共享设备列表向本服成员发送申请。
      </HelpTip>

      <div className="control-layout">
        <form
          className="control-form-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && ready) onConnect(code, key);
          }}
        >
          <div className="field">
            <div className="field-label">
              <span>远控码</span>
              <span className="field-hint">9 位数字</span>
            </div>
            <div className={`input-shell${busy ? " disabled" : ""}`}>
              <HashIcon size={18} />
              <input
                data-testid="control-code"
                value={formatCode(code)}
                onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
                placeholder="000 000 000"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={11}
                disabled={busy}
                aria-label="远控码"
              />
            </div>
          </div>

          <div className="field">
            <div className="field-label">
              <span>访问密钥</span>
              <span className="field-hint">10 位，不含 I / O / 0 / 1</span>
            </div>
            <div className={`input-shell${busy ? " disabled" : ""}`}>
              <LockIcon size={18} />
              <input
                data-testid="control-key"
                value={showKey ? formatKey(key) : formatKey(key).replace(/[A-Z0-9]/g, "•")}
                onChange={(event) => setKey(normalizeKeyInput(event.target.value))}
                onFocus={() => setShowKey(true)}
                placeholder="••••• •••••"
                autoComplete="off"
                spellCheck={false}
                maxLength={11}
                disabled={busy}
                aria-label="访问密钥"
              />
              <button
                type="button"
                className="icon-button subtle input-action"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                title={showKey ? "隐藏密钥" : "显示密钥"}
              >
                {showKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
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
                  onClick={() => onAskAi(errorQuestion("控制远程设备", error))}
                >
                  <SparkIcon size={13} />
                  让 AI 分析这个错误
                </button>
              )}
            </div>
          )}

          {phase === "waiting" ? (
            <ApprovalWait onCancel={onDisconnect} />
          ) : busy ? (
            <ConnectionProgress phase={phase} onCancel={onDisconnect} />
          ) : (
            <button
              type="submit"
              className="button primary wide connect-button"
              data-testid="control-connect"
              disabled={!ready}
            >
              连接远程设备
              <ArrowRightIcon size={17} />
            </button>
          )}

          <div className="form-foot">
            <ShieldIcon size={14} />
            <span>密钥不会发送到服务器，视频默认点对点加密。</span>
          </div>
          <div className="form-server">
            服务器 <span>{settings.serverUrl}</span>
          </div>
        </form>

        <ConnectAside />
      </div>

      <SharedCatalog
        hosts={catalogHosts}
        status={catalogStatus}
        error={catalogError}
        request={catalogRequest}
        onRequestHost={onRequestHost}
        onCancelRequest={onCancelRequest}
        onRefresh={onRefreshCatalog}
      />

      <div className="panel-foot trust-row">
        <span>
          <LockIcon size={14} /> 无账号模式
        </span>
        <span>
          <ShieldIcon size={14} /> 服务器仅转发信令
        </span>
        <span>
          <ArrowRightIcon size={14} /> 连接失败不会泄露密钥
        </span>
      </div>
    </section>
  );
}
