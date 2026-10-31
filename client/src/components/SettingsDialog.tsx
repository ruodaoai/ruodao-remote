import { useEffect, useRef, useState } from "react";
import type { AppInfo, SessionLogEntry, Settings, SettingsPatch } from "../types";
import { formatDuration } from "../hooks/useElapsed";
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  HashIcon,
  LinkIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "./icons";
import { InlineAlert } from "./ui";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  appInfo: AppInfo | null;
  onClose: () => void;
  onSave: (patch: SettingsPatch) => Promise<void>;
  onOpenGuide: () => void;
  onAskAi: () => void;
}

function validateServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("服务器地址不能为空");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("服务器地址格式不正确");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("服务器地址必须以 http://、https://、ws:// 或 wss:// 开头");
  }
  if (url.username || url.password) throw new Error("服务器地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("服务器地址不能包含查询参数");
  return trimmed;
}

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return "保存失败，请稍后再试。";
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

function normalizeInviteValue(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

export function SettingsDialog({
  open,
  settings,
  appInfo,
  onClose,
  onSave,
  onOpenGuide,
  onAskAi,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [inviteCode, setInviteCode] = useState(settings.inviteCode);
  const [autoStartHost, setAutoStartHost] = useState(settings.autoStartHost);
  const [localPort, setLocalPort] = useState(String(settings.localServerPort));
  const [localPublicUrl, setLocalPublicUrl] = useState(settings.localServerPublicUrl);
  const [launchAtLogin, setLaunchAtLogin] = useState(settings.launchAtLogin);
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.remote
      .listSessionLogs(4)
      .then((items) => {
        if (!cancelled) setLogs(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setServerUrl(settings.serverUrl);
    setDeviceName(settings.deviceName);
    setInviteCode(settings.inviteCode);
    setAutoStartHost(settings.autoStartHost);
    setLocalPort(String(settings.localServerPort));
    setLocalPublicUrl(settings.localServerPublicUrl);
    setLaunchAtLogin(settings.launchAtLogin);
    setError(null);
  }, [open, settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(): Promise<void> {
    if (saving) return;
    setError(null);
    try {
      const url = validateServerUrl(serverUrl);
      const name = deviceName.trim();
      if (!name) throw new Error("本机名称不能为空");
      const port = Number(localPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error("本机服务端口需要在 1024 到 65535 之间");
      }
      const publicUrl = localPublicUrl.trim() ? validateServerUrl(localPublicUrl) : "";
      setSaving(true);
      await onSave({
        serverUrl: url,
        deviceName: name,
        inviteCode,
        autoStartHost,
        localServerPort: port,
        localServerPublicUrl: publicUrl,
        launchAtLogin,
      });
      onClose();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      data-testid="settings-dialog"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <form
        method="dialog"
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="settings-head">
          <div>
            <span className="eyebrow">连接偏好</span>
            <h2>设置</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="settings-body">
          <label className="field">
            <div className="field-label">
              <span>服务器地址</span>
              <span className="field-hint">自建信令服务器</span>
            </div>
            <div className="input-shell">
              <ServerIcon size={17} />
              <input
                data-testid="settings-server"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://remote.example.com"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <p className="field-help">
              支持 http / https / ws / wss。公网部署请使用 https 并配置 TURN 中转。
            </p>
          </label>

          <label className="field">
            <div className="field-label">
              <span>邀请码</span>
              <span className="field-hint">服务器开启邀请制时需要</span>
            </div>
            <div className="input-shell">
              <HashIcon size={17} />
              <input
                data-testid="settings-invite"
                value={inviteCode}
                onChange={(event) => setInviteCode(normalizeInviteValue(event.target.value))}
                placeholder="例如 ABCD-EFGH，留空表示没有"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <p className="field-help">
              邀请码由服务器管理员生成并分配。同一台电脑只需填写一次，之后自动沿用。
            </p>
          </label>

          <div className="setting-row auto-start-setting">
            <div>
              <strong>启动应用后自动开启被控</strong>
              <p>
                打开若道远程后自动共享主屏幕并生成远控码，不用再手动点“开始被控”。想随电脑开机生效，请同时开启下方的“开机自动启动”。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoStartHost}
              aria-label="启动应用后自动开启被控"
              className={`switch${autoStartHost ? " on" : ""}`}
              onClick={() => setAutoStartHost((value) => !value)}
            >
              <span />
            </button>
          </div>

          <label className="field">
            <div className="field-label">
              <span>本机名称</span>
              <span className="field-hint">对方连接时看到</span>
            </div>
            <div className="input-shell">
              <CheckIcon size={17} />
              <input
                data-testid="settings-device"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={64}
                placeholder="例如：设计部-01"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </label>

          <div className="settings-section">
            <div className="settings-section-head">
              <strong>本机服务端</strong>
              <span>在“服务端”页一键启动</span>
            </div>

            <label className="field">
              <div className="field-label">
                <span>服务端口</span>
                <span className="field-hint">默认 8787</span>
              </div>
              <div className="input-shell">
                <ServerIcon size={17} />
                <input
                  value={localPort}
                  onChange={(event) => setLocalPort(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="8787"
                  spellCheck={false}
                />
              </div>
              <p className="field-help">
                修改端口后，需要回到“服务端”页重新启动本机服务端。
              </p>
            </label>

            <label className="field">
              <div className="field-label">
                <span>公网地址</span>
                <span className="field-hint">可选</span>
              </div>
              <div className="input-shell">
                <LinkIcon size={17} />
                <input
                  value={localPublicUrl}
                  onChange={(event) => setLocalPublicUrl(event.target.value)}
                  placeholder="https://remote.example.com"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <p className="field-help">
                为本机服务配置端口映射或反向代理后，填写对外访问地址，客户端会直接使用它。
              </p>
            </label>

            <div className="setting-row">
              <div>
                <strong>开机自动启动</strong>
                <p>
                  登录系统后自动打开若道远程；配合上方“启动应用后自动开启被控”，即可开机后自动上线。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={launchAtLogin}
                aria-label="开机自动启动"
                className={`switch${launchAtLogin ? " on" : ""}`}
                onClick={() => setLaunchAtLogin((value) => !value)}
              >
                <span />
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-head">
              <strong>会话日志</strong>
              <span>仅保存在本机</span>
            </div>
            <p className="field-help">
              每次被控或控制他人都会记录开始时间、对方名称与 IP、持续时长，以及任务管理器、锁屏、运行命令等危险操作。
            </p>
            {logs.length === 0 ? (
              <p className="log-empty">还没有会话记录。</p>
            ) : (
              <ul className="log-list">
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className="log-item"
                    title={
                      log.dangerEvents.length > 0
                        ? log.dangerEvents.map((event) => event.label).join("、")
                        : "没有危险操作"
                    }
                  >
                    <div className="log-main">
                      <strong>
                        {log.role === "host"
                          ? `被“${log.peerName}”控制`
                          : `控制“${log.peerName}”`}
                      </strong>
                      <span>
                        {new Date(log.startedAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                        {" · "}时长 {formatDuration(log.durationMs / 1000)}
                      </span>
                    </div>
                    <div className="log-side">
                      <span>{log.peerIp || "IP 未知"}</span>
                      {log.dangerEvents.length > 0 && (
                        <span className="log-danger">
                          {log.dangerEvents.length} 次危险操作
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                void window.remote.openSessionLogFolder().then((result) => {
                  if (!result.ok) setError(result.error ?? "无法打开日志目录");
                });
              }}
            >
              打开日志目录
            </button>
          </div>

          <div className="settings-help">
            <span className="settings-help-icon">
              <BookIcon size={17} />
            </span>
            <div>
              <strong>不知道服务器地址或邀请码怎么填？</strong>
              <p>按场景查看使用指南，或让 AI 结合当前连接状态一步步带你操作。</p>
            </div>
            <div className="settings-help-actions">
              <button type="button" className="text-button" onClick={onOpenGuide}>
                使用指南
              </button>
              <button type="button" className="text-button ai" onClick={onAskAi}>
                <SparkIcon size={13} />
                问 AI
              </button>
            </div>
          </div>

          <div className="settings-note">
            <ShieldIcon size={17} />
            <div>
              <strong>无账号安全边界</strong>
              <p>
                远控码在设备上线时生成；访问密钥只在本机生成，服务器仅保存 PBKDF2
                加盐哈希。会话建立后视频与输入走 WebRTC 加密通道。
              </p>
            </div>
          </div>

          {error && <InlineAlert>{error}</InlineAlert>}
        </div>

        <div className="settings-foot">
          <span className="version-text">
            若道远程 v{appInfo?.version ?? "0.1.0"} · {appInfo?.platform ?? "desktop"}
          </span>
          <div className="settings-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="button primary"
              data-testid="settings-save"
              disabled={saving}
            >
              {saving ? <span className="spinner" /> : <CheckIcon size={16} />}
              保存设置
            </button>
          </div>
        </div>

        {!appInfo?.inputAvailable && (
          <div className="settings-warning">
            <AlertIcon size={15} />
            当前系统不支持本机输入注入，被控时只能观看画面。
          </div>
        )}
      </form>
    </dialog>
  );
}
