import { useEffect, useRef } from "react";
import type { UpdatePhase, UpdateStatus } from "../types";
import { CheckIcon, DownloadIcon, RefreshIcon, XIcon } from "./icons";
import { InlineAlert, StatusPill } from "./ui";

interface UpdateDialogProps {
  open: boolean;
  status: UpdateStatus | null;
  busy: "check" | "download" | "install" | "auto" | null;
  actionError: string | null;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onToggleAuto: (enabled: boolean) => void;
  onOpenFolder: () => void;
}

const PHASE_LABELS: Record<UpdatePhase, string> = {
  idle: "尚未检查",
  checking: "正在检查",
  "up-to-date": "已是最新版本",
  available: "发现新版本",
  downloading: "正在下载",
  ready: "等待安装",
  installing: "正在安装",
  error: "检查失败",
};

function phaseTone(phase: UpdatePhase): "idle" | "busy" | "online" | "error" {
  if (phase === "error") return "error";
  if (phase === "up-to-date" || phase === "ready") return "online";
  if (phase === "idle") return "idle";
  return "busy";
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "大小未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function UpdateDialog({
  open,
  status,
  busy,
  actionError,
  onClose,
  onCheck,
  onDownload,
  onInstall,
  onToggleAuto,
  onOpenFolder,
}: UpdateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const phase: UpdatePhase = status?.phase ?? "idle";
  const release = status?.release ?? null;
  const progress = status?.progress ?? null;
  const supported = status?.supported ?? true;
  const checking = busy === "check" || phase === "checking";
  const downloading = phase === "downloading";

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog update-dialog"
      data-testid="update-dialog"
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
      <div className="settings-card">
        <div className="settings-head">
          <div>
            <span className="eyebrow">版本与更新</span>
            <h2>软件更新</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭更新窗口">
            <XIcon size={18} />
          </button>
        </div>

        <div className="settings-body">
          <div className="update-hero">
            <div className="update-hero-main">
              <span className="update-current">当前版本 v{status?.currentVersion ?? "0.1.0"}</span>
              <StatusPill tone={phaseTone(phase)} label={PHASE_LABELS[phase]} />
            </div>
            <p className="field-help">
              更新源 {status?.updateBaseUrl || "https://ruodao.com"}，安装包下载后会在本机校验 SHA-256。
            </p>
          </div>

          {!supported && status?.reason && <InlineAlert kind="info">{status.reason}</InlineAlert>}

          {release && (
            <div className="update-release">
              <div className="update-release-head">
                <strong>v{release.version}</strong>
                <span>{formatBytes(release.size)}</span>
              </div>
              {release.publishedAt && (
                <p className="update-release-date">发布于 {formatDate(release.publishedAt)}</p>
              )}
              {release.notes && <div className="update-notes">{release.notes}</div>}
              {release.mandatory && (
                <p className="update-mandatory">这是一个必须安装的版本，修复了重要问题。</p>
              )}
            </div>
          )}

          {downloading && (
            <div className="update-progress">
              <div className="update-progress-head">
                <span>正在下载安装包</span>
                <span>
                  {progress?.percent ?? 0}%
                  {progress && progress.total > 0
                    ? ` · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                    : ""}
                </span>
              </div>
              <div
                className="update-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress?.percent ?? 0}
              >
                <span style={{ width: `${Math.max(2, progress?.percent ?? 0)}%` }} />
              </div>
            </div>
          )}

          {phase === "ready" && (
            <InlineAlert kind="info">
              {status?.portable
                ? "便携版已下载完成。请打开所在文件夹，退出应用后手动替换为新版本。"
                : "安装包已校验完成。点击「重启并安装」会关闭当前窗口并静默安装，远控会话会中断。"}
            </InlineAlert>
          )}

          {phase === "error" && status?.error && <InlineAlert>{status.error}</InlineAlert>}
          {actionError && actionError !== status?.error && <InlineAlert>{actionError}</InlineAlert>}

          <div className="setting-row update-auto-row">
            <div>
              <strong>自动检查并下载更新</strong>
              <p>
                启动后自动向若道更新源查询新版本，并在后台下载；退出应用时自动安装。关闭后仍可手动检查。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status?.autoUpdate ?? true}
              aria-label="自动检查并下载更新"
              className={`switch${status?.autoUpdate ? " on" : ""}`}
              disabled={busy === "auto" || !supported}
              onClick={() => onToggleAuto(!(status?.autoUpdate ?? true))}
            >
              <span />
            </button>
          </div>

          {status?.lastCheckedAt && (
            <p className="update-footnote">
              上次检查：{new Date(status.lastCheckedAt).toLocaleString("zh-CN", { hour12: false })}
            </p>
          )}
        </div>

        <div className="settings-foot">
          <span className="version-text">
            若道远程 v{status?.currentVersion ?? "0.1.0"} · {status?.portable ? "便携版" : "安装版"}
          </span>
          <div className="settings-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              关闭
            </button>
            {phase === "ready" ? (
              <>
                <button type="button" className="button ghost" onClick={onOpenFolder}>
                  打开所在文件夹
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy === "install"}
                  onClick={onInstall}
                >
                  {busy === "install" ? <span className="spinner" /> : <CheckIcon size={16} />}
                  重启并安装
                </button>
              </>
            ) : phase === "available" ? (
              <button type="button" className="button primary" disabled={busy === "download"} onClick={onDownload}>
                {busy === "download" ? <span className="spinner" /> : <DownloadIcon size={16} />}
                下载更新
              </button>
            ) : downloading ? (
              <button type="button" className="button primary" disabled>
                <span className="spinner" />
                下载中 {progress?.percent ?? 0}%
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={checking || !supported}
                onClick={onCheck}
              >
                {checking ? <span className="spinner" /> : <RefreshIcon size={16} />}
                {phase === "error" ? "重新检查" : phase === "up-to-date" ? "再次检查" : "检查更新"}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
