import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Toast } from "../types";
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  SparkIcon,
  XIcon,
} from "./icons";

export function StatusPill({
  tone,
  label,
}: {
  tone: "idle" | "busy" | "online" | "error";
  label: string;
}) {
  return (
    <span className={`status-pill tone-${tone}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

export function InlineAlert({
  kind = "error",
  children,
}: {
  kind?: "error" | "info";
  children: ReactNode;
}) {
  return (
    <div className={`inline-alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "error" ? <AlertIcon size={16} /> : <InfoIcon size={16} />}
      <span>{children}</span>
    </div>
  );
}

export function CopyButton({
  value,
  label,
  withLabel = false,
}: {
  value: string;
  label: string;
  withLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be blocked; the visible value can still be copied manually.
    }
  }

  return (
    <button
      type="button"
      className={`copy-button${withLabel ? " with-label" : ""}${copied ? " copied" : ""}`}
      onClick={() => void copy()}
      aria-label={copied ? "已复制" : label}
      title={copied ? "已复制" : label}
    >
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      {withLabel && <span>{copied ? "已复制" : "复制"}</span>}
    </button>
  );
}

export function HelpTip({
  title,
  children,
  onOpenGuide,
  onAskAi,
}: {
  title: string;
  children: ReactNode;
  onOpenGuide?: () => void;
  onAskAi?: () => void;
}) {
  return (
    <div className="help-tip">
      <span className="help-tip-icon">
        <BookIcon size={17} />
      </span>
      <div className="help-tip-copy">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      <div className="help-tip-actions">
        {onOpenGuide && (
          <button type="button" className="text-button" onClick={onOpenGuide}>
            使用指南
          </button>
        )}
        {onAskAi && (
          <button type="button" className="text-button ai" onClick={onAskAi}>
            <SparkIcon size={13} />
            问 AI
          </button>
        )}
      </div>
    </div>
  );
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === "success" ? (
              <CheckIcon size={16} />
            ) : toast.kind === "error" ? (
              <AlertIcon size={16} />
            ) : (
              <InfoIcon size={16} />
            )}
          </span>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => onDismiss(toast.id)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
