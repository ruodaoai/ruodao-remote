import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantController } from "../hooks/useAssistant";
import type {
  Settings,
  SharedServerFormInput,
  SharedServerInfo,
  SharedServerMineEntry,
  SharedServerMineState,
  SharedServerPage,
  SharedServerSort,
  ToastKind,
} from "../types";
import {
  accessModeInfo,
  expiryText,
  expiresInDays,
  formatExpiryDate,
  formatInviteCode,
  maxExpiryInputValue,
  serverHealth,
  serverStatusLabel,
  todayInputValue,
} from "../lib/shared-servers";
import {
  AlertIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  HashIcon,
  LockIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
} from "./icons";
import { CopyButton, InlineAlert, StatusPill } from "./ui";

import { t, tf } from "../i18n";


const PAGE_SIZE = 9;

const SORT_OPTIONS: Array<{ id: SharedServerSort; label: string }> = [
  { id: "recommended", label: t("推荐排序") },
  { id: "newest", label: t("最新发布") },
  { id: "expiring", label: t("即将到期") },
];

interface SharedServersPanelProps {
  settings: Settings;
  assistant: AssistantController;
  onUseServer: (url: string, inviteCode: string, name: string) => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
}

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return t("操作失败，请稍后再试。");
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

function sameServer(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  return normalize(left) !== "" && normalize(left) === normalize(right);
}

function renewDate(value: string | null | undefined): string {
  const today = todayInputValue();
  const date = String(value ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today) return date;
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 7);
  return todayInputValue(fallback);
}

interface ServerFormState {
  name: string;
  address: string;
  region: string;
  specs: string;
  maxDevices: string;
  inviteCode: string;
  note: string;
  expiresAt: string;
}

function formStateFor(server: SharedServerInfo | null | undefined): ServerFormState {
  return {
    name: server?.name ?? "",
    address: server?.address ?? "",
    region: server?.region ?? "",
    specs: server?.specs ?? "",
    maxDevices: server?.maxDevices ? String(server.maxDevices) : "",
    inviteCode: server?.inviteCode ?? "",
    note: server?.note ?? "",
    expiresAt: renewDate(server?.expiresAt),
  };
}

function SharedLoginCard({
  assistant,
  expired,
  focusSignal,
  onLoggedIn,
}: {
  assistant: AssistantController;
  expired: boolean;
  focusSignal: number;
  onLoggedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = assistant.status?.email;
    if (saved) setEmail((current) => current || saved);
  }, [assistant.status?.email]);

  useEffect(() => {
    if (focusSignal > 0) emailRef.current?.focus();
  }, [focusSignal]);

  async function submit(): Promise<void> {
    if (assistant.loginBusy) return;
    const ok = await assistant.login(email, password);
    if (ok) {
      setPassword("");
      onLoggedIn();
    }
  }

  return (
    <section className="shared-login-card" data-testid="shared-login-card">
      <div className="shared-login-copy">
        <span className="shared-login-icon">
          <UserIcon size={20} />
        </span>
        <div>
          <span className="community-kicker">
            <ShieldIcon size={13} /> {t("若道账号")}
          </span>
          <h3>{t("登录后查看共享服务器详情")}</h3>
          <p>
            {t("列表不用登录也能浏览；登录后可以查看完整地址、邀请码与配置说明，并发布自己的服务器。社区留言与共享服务器共用一个若道账号。")}
          </p>
        </div>
      </div>
      <form
        className="shared-login-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {expired && (
          <InlineAlert kind="info">{t("登录已过期，请重新输入密码。远控连接不受影响。")}</InlineAlert>
        )}
        <div className="shared-login-fields">
          <div className="input-shell">
            <UserIcon size={16} />
            <input
              ref={emailRef}
              data-testid="shared-login-email"
              type="email"
              value={email}
              placeholder={t("若道账号邮箱")}
              autoComplete="username"
              spellCheck={false}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="input-shell">
            <LockIcon size={16} />
            <input
              data-testid="shared-login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              maxLength={256}
              placeholder={t("密码")}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t("隐藏密码") : t("显示密码")}
            >
              {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
            </button>
          </div>
          <button
            type="submit"
            className="button primary small"
            data-testid="shared-login-submit"
            disabled={assistant.loginBusy || !email.trim() || !password}
          >
            {assistant.loginBusy ? <span className="spinner small" /> : <UserIcon size={15} />}
            {assistant.loginBusy ? t("正在登录…") : t("登录")}
          </button>
        </div>
        {assistant.error && <InlineAlert>{assistant.error}</InlineAlert>}
        <div className="shared-login-links">
          <button
            type="button"
            className="text-button"
            onClick={() => void assistant.openAccount("register")}
          >
            {t("注册若道账号")}
          </button>
          <span>·</span>
          <button
            type="button"
            className="text-button"
            onClick={() => void assistant.openAccount("login")}
          >
            {t("在浏览器中登录")}
          </button>
        </div>
      </form>
    </section>
  );
}

function PublicServerCard({
  server,
  current,
  using,
  signedIn,
  onUse,
  onReport,
  onRequireLogin,
}: {
  server: SharedServerInfo;
  current: boolean;
  using: boolean;
  signedIn: boolean;
  onUse: () => void;
  onReport: () => void;
  onRequireLogin: () => void;
}) {
  const mode = accessModeInfo(server.registrationMode);
  const health = serverHealth(server);
  const offline = server.healthStatus === "offline";
  const locked = !signedIn;
  return (
    <article
      className={`shared-server-card${locked ? " locked" : ""}`}
      data-testid={`shared-server-${server.id}`}
    >
      <header className="shared-server-card-head">
        <div className="shared-server-identity">
          <span className="shared-server-mark">
            <ServerIcon size={18} />
          </span>
          <div>
            <strong>{server.name}</strong>
            <span>
              {locked
                ? tf("{0}登录后显示服务器地址", server.region ? `${server.region} · ` : "")
                : `${server.host || server.address}${server.region ? ` · ${server.region}` : ""}`}
            </span>
          </div>
        </div>
        <StatusPill {...health} />
      </header>

      <div className="shared-server-chips">
        <span className="shared-server-chip">{mode.label}</span>
        {locked && (
          <span className="shared-server-chip locked">
            <LockIcon size={11} /> {t("详情需登录")}
          </span>
        )}
        {!locked && server.specs && <span className="shared-server-chip">{server.specs}</span>}
        {!locked && server.maxDevices ? (
          <span className="shared-server-chip">{t("可接入")} {server.maxDevices} {t("台")}</span>
        ) : null}
        {current && <span className="shared-server-chip current">{t("当前使用")}</span>}
      </div>

      <dl className="shared-server-facts">
        <div>
          <dt>{t("在线设备")}</dt>
          <dd className={locked ? "locked" : undefined}>
            {locked
              ? t("登录后可见")
              : tf("{0} 台{1}", server.peers ?? 0, server.sessions ? tf(" · {0} 个远控中", server.sessions) : "")}
          </dd>
        </div>
        <div>
          <dt>{t("有效期")}</dt>
          <dd className={locked ? "locked" : undefined} title={locked ? undefined : formatExpiryDate(server.expiresAt)}>
            {locked ? t("登录后可见") : expiryText(server.expiresAt)}
          </dd>
        </div>
        <div>
          <dt>{t("服务端")}</dt>
          <dd className={locked ? "locked" : undefined}>
            {locked
              ? t("登录后可见")
              : server.serverVersion
                ? `v${server.serverVersion}`
                : t("版本未知")}
          </dd>
        </div>
      </dl>

      {locked ? (
        <div className="shared-server-invite locked">
          <LockIcon size={14} />
          <span>{t("登录后可查看邀请码与接入方式")}</span>
        </div>
      ) : server.registrationMode === "invite" ? (
        server.inviteCode ? (
          <div className="shared-server-invite">
            <LockIcon size={14} />
            <span>{t("邀请码")}</span>
            <code>{formatInviteCode(server.inviteCode)}</code>
            <CopyButton value={server.inviteCode} label={t("复制邀请码")} />
          </div>
        ) : (
          <div className="shared-server-invite warning">
            <AlertIcon size={14} />
            {t("发布者没有填写邀请码，可能无法接入")}
          </div>
        )
      ) : (
        <div className="shared-server-invite">
          <ShieldIcon size={14} />
          <span>{mode.hint}</span>
        </div>
      )}

      {!locked && server.note && <p className="shared-server-card-note">{server.note}</p>}

      <footer className="shared-server-actions">
        <button
          type="button"
          className="button primary small"
          disabled={!locked && (using || offline)}
          title={
            locked
              ? t("登录后即可查看详情并接入")
              : offline
                ? t("健康检查未通过，暂时无法接入")
                : undefined
          }
          onClick={locked ? onRequireLogin : onUse}
        >
          {using ? (
            <span className="spinner small" />
          ) : locked ? (
            <LockIcon size={15} />
          ) : (
            <GlobeIcon size={15} />
          )}
          {using ? t("正在切换…") : locked ? t("登录后使用") : t("使用此服务器")}
        </button>
        <button
          type="button"
          className="button ghost small"
          onClick={locked ? onRequireLogin : onReport}
        >
          <AlertIcon size={14} />
          {locked ? t("登录后报告") : t("报告问题")}
        </button>
      </footer>
    </article>
  );
}

function MineServerCard({
  entry,
  current,
  using,
  busy,
  onUse,
  onEdit,
  onRemove,
}: {
  entry: SharedServerMineEntry;
  current: boolean;
  using: boolean;
  busy: boolean;
  onUse: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const server = entry.server;
  const status = serverStatusLabel(server, entry.gone);
  const mode = accessModeInfo(server?.registrationMode ?? "");
  const days = expiresInDays(server?.expiresAt);
  const expired = days !== null && days < 0;
  const usable =
    Boolean(server) &&
    !entry.gone &&
    !expired &&
    server!.status === "active" &&
    server!.healthStatus !== "offline";

  return (
    <article
      className={`shared-server-card mine${entry.gone || expired ? " inactive" : ""}`}
      data-testid={`shared-server-mine-${entry.id}`}
    >
      <header className="shared-server-card-head">
        <div className="shared-server-identity">
          <span className="shared-server-mark">
            <ServerIcon size={18} />
          </span>
          <div>
            <strong>{server?.name ?? t("未命名的共享记录")}</strong>
            <span>{server?.host || server?.address || entry.id}</span>
          </div>
        </div>
        <StatusPill {...status} />
      </header>

      {server ? (
        <>
          <div className="shared-server-chips">
            <span className="shared-server-chip">{mode.label}</span>
            {server.specs && <span className="shared-server-chip">{server.specs}</span>}
            {current && <span className="shared-server-chip current">{t("当前使用")}</span>}
          </div>
          <dl className="shared-server-facts">
            <div>
              <dt>{t("有效期")}</dt>
              <dd title={formatExpiryDate(server.expiresAt)}>
                {expiryText(server.expiresAt)} · {formatExpiryDate(server.expiresAt)}
              </dd>
            </div>
            <div>
              <dt>{t("在线设备")}</dt>
              <dd>{server.peers ?? 0} {t("台")}</dd>
            </div>
            <div>
              <dt>{t("接入方式")}</dt>
              <dd>{mode.label}</dd>
            </div>
          </dl>
          {server.registrationMode === "invite" && server.inviteCode && (
            <div className="shared-server-invite">
              <LockIcon size={14} />
              <span>{t("邀请码")}</span>
              <code>{formatInviteCode(server.inviteCode)}</code>
              <CopyButton value={server.inviteCode} label={t("复制邀请码")} />
            </div>
          )}
        </>
      ) : (
        <p className="shared-server-card-note">{t("本机保存的记录不完整，无法显示详情。")}</p>
      )}

      {entry.error && (
        <p className="shared-server-card-error">
          <AlertIcon size={13} />
          {entry.error}
        </p>
      )}
      {entry.gone && (
        <p className="shared-server-card-error">
          <AlertIcon size={13} />
          {t("服务器上已找不到这条记录，可能已过期或被管理员移除。")}
        </p>
      )}
      {!entry.gone && server?.status === "hidden" && (
        <p className="shared-server-card-error">
          <AlertIcon size={13} />
          {t("已被管理员隐藏，更新信息不会自动恢复展示，请联系管理员复核。")}
        </p>
      )}

      <footer className="shared-server-actions">
        <button
          type="button"
          className="button primary small"
          disabled={!usable || using}
          onClick={onUse}
        >
          {using ? <span className="spinner small" /> : <GlobeIcon size={15} />}
          {using ? t("正在切换…") : t("使用")}
        </button>
        <button type="button" className="button ghost small" disabled={busy} onClick={onEdit}>
          {expired || (days !== null && days <= 3) ? t("续期") : t("更新信息")}
        </button>
        <button
          type="button"
          className="button danger-soft small"
          disabled={busy}
          onClick={onRemove}
        >
          {busy ? <span className="spinner small" /> : <XIcon size={14} />}
          {t("下架")}
        </button>
      </footer>
    </article>
  );
}

function PublishDialog({
  mode,
  entry,
  onClose,
  onSaved,
  notify,
}: {
  mode: "create" | "edit";
  entry: SharedServerMineEntry | null;
  onClose: () => void;
  onSaved: (server: SharedServerInfo) => void;
  notify: (message: string, kind?: ToastKind) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<ServerFormState>(() => formStateFor(entry?.server));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  function patch<K extends keyof ServerFormState>(key: K, value: ServerFormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const input: SharedServerFormInput = {
        name: form.name,
        address: form.address,
        region: form.region,
        specs: form.specs,
        maxDevices: form.maxDevices.trim() ? Number(form.maxDevices) : null,
        inviteCode: form.inviteCode,
        note: form.note,
        expiresAt: form.expiresAt,
      };
      const result =
        mode === "edit" && entry
          ? await window.remote.sharedServersUpdate({ ...input, id: entry.id })
          : await window.remote.sharedServersCreate(input);
      notify(
        mode === "edit" ? t("共享信息已更新") : t("已发布到共享服务器列表，其他用户可以免费使用了"),
        "success",
      );
      onSaved(result.server);
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
      className="settings-dialog shared-server-dialog"
      data-testid="shared-server-dialog"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current && !saving) onClose();
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
            <span className="eyebrow">{mode === "edit" ? t("续期与更新") : t("贡献服务器")}</span>
            <h2>{mode === "edit" ? t("更新共享信息") : t("发布我的服务器")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label={t("关闭")}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-note">
            <ShieldIcon size={17} />
            <div>
              <strong>{t("发布前会真实检查服务器")}</strong>
              <p>
                {t("只接受能公网访问的 HTTPS 地址。我们会请求 /health\n                确认它正在运行若道远程服务，检查通过后才会出现在列表里。")}
              </p>
            </div>
          </div>

          <label className="field">
            <div className="field-label">
              <span>{t("显示名称")}</span>
              <span className="field-hint">{t("2-40 个字符")}</span>
            </div>
            <div className="input-shell">
              <ServerIcon size={17} />
              <input
                data-testid="shared-server-name"
                value={form.name}
                maxLength={40}
                placeholder={t("例如：香港社区共享服务器")}
                onChange={(event) => patch("name", event.target.value)}
              />
            </div>
          </label>

          <label className="field">
            <div className="field-label">
              <span>{t("服务器地址")}</span>
              <span className="field-hint">{t("必须 HTTPS")}</span>
            </div>
            <div className="input-shell">
              <GlobeIcon size={17} />
              <input
                data-testid="shared-server-address"
                value={form.address}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://remote.example.com"
                onChange={(event) => patch("address", event.target.value)}
              />
            </div>
            <p className="field-help">
              {t("在「服务端」页部署完成后拿到的地址，不要带路径、账号或查询参数。")}
            </p>
          </label>

          <div className="shared-server-form-grid">
            <label className="field">
              <div className="field-label">
                <span>{t("地区")}</span>
                <span className="field-hint">{t("选填")}</span>
              </div>
              <div className="input-shell">
                <input
                  value={form.region}
                  maxLength={32}
                  placeholder={t("例如：香港 / 上海")}
                  onChange={(event) => patch("region", event.target.value)}
                />
              </div>
            </label>
            <label className="field">
              <div className="field-label">
                <span>{t("配置说明")}</span>
                <span className="field-hint">{t("选填")}</span>
              </div>
              <div className="input-shell">
                <input
                  value={form.specs}
                  maxLength={80}
                  placeholder={t("例如：2 核 4G · 5Mbps")}
                  onChange={(event) => patch("specs", event.target.value)}
                />
              </div>
            </label>
          </div>

          <div className="shared-server-form-grid">
            <label className="field">
              <div className="field-label">
                <span>{t("可接入设备数")}</span>
                <span className="field-hint">{t("选填")}</span>
              </div>
              <div className="input-shell">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={form.maxDevices}
                  placeholder={t("例如：20")}
                  onChange={(event) => patch("maxDevices", event.target.value)}
                />
              </div>
            </label>
            <label className="field">
              <div className="field-label">
                <span>{t("有效期")}</span>
                <span className="field-hint">{t("最长 365 天")}</span>
              </div>
              <div className="input-shell">
                <input
                  type="date"
                  value={form.expiresAt}
                  min={todayInputValue()}
                  max={maxExpiryInputValue()}
                  onChange={(event) => patch("expiresAt", event.target.value)}
                />
              </div>
            </label>
          </div>

          <label className="field">
            <div className="field-label">
              <span>{t("邀请码")}</span>
              <span className="field-hint">{t("服务器开启邀请制时需要")}</span>
            </div>
            <div className="input-shell">
              <HashIcon size={17} />
              <input
                value={form.inviteCode}
                spellCheck={false}
                autoComplete="off"
                maxLength={64}
                placeholder={t("例如 ABCD-EFGH")}
                onChange={(event) => patch("inviteCode", event.target.value)}
              />
            </div>
            <p className="field-help">
              {t("邀请码会公开显示给所有用户，方便他们直接接入。请确认它只用于共享服务器。")}
            </p>
          </label>

          <label className="field">
            <div className="field-label">
              <span>{t("补充说明")}</span>
              <span className="field-hint">{t("选填 · 最多 200 字")}</span>
            </div>
            <textarea
              className="shared-server-textarea"
              rows={3}
              maxLength={200}
              value={form.note}
              placeholder={t("例如：带宽有限，请勿用于大文件传输；长期在线。")}
              onChange={(event) => patch("note", event.target.value)}
            />
          </label>

          {error && <InlineAlert>{error}</InlineAlert>}
        </div>

        <div className="settings-foot">
          <span className="field-help">{t("管理令牌只保存在本机，用于之后续期或下架。")}</span>
          <div className="settings-actions">
            <button type="button" className="button ghost small" disabled={saving} onClick={onClose}>
              {t("取消")}
            </button>
            <button
              type="submit"
              className="button primary small"
              data-testid="shared-server-submit"
              disabled={saving}
            >
              {saving ? <span className="spinner small" /> : <SendIcon size={15} />}
              {saving
                ? t("正在检查服务器…")
                : mode === "edit"
                  ? t("保存更新")
                  : t("检查并发布")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function ReportDialog({
  target,
  onClose,
  notify,
}: {
  target: SharedServerInfo;
  onClose: () => void;
  notify: (message: string, kind?: ToastKind) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  async function submit(): Promise<void> {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await window.remote.sharedServersReport({
        id: target.id,
        reason: reason.trim(),
      });
      notify(
        result.hidden
          ? t("已提交报告，该服务器已被临时隐藏，等待管理员复核")
          : t("已提交报告，感谢你的反馈"),
        "success",
      );
      onClose();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog shared-server-dialog small"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (!sending) onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current && !sending) onClose();
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
            <span className="eyebrow">{t("社区维护")}</span>
            <h2>{t("报告「")}{target.name}」</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={sending}
            aria-label={t("关闭")}
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="settings-body">
          <p className="shared-server-report-hint">
            {t("如果服务器无法连接、实际配置与描述不符，或者存在安全风险，请告诉我们。24\n            小时内被报告 5 次的服务器会自动隐藏，等待管理员复核。")}
          </p>
          <label className="field">
            <div className="field-label">
              <span>{t("问题描述")}</span>
              <span className="field-hint">{t("选填 · 最多 200 字")}</span>
            </div>
            <textarea
              className="shared-server-textarea"
              rows={3}
              maxLength={200}
              value={reason}
              placeholder={t("例如：地址打不开，/health 返回 404")}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <InlineAlert>{error}</InlineAlert>}
        </div>
        <div className="settings-foot">
          <span className="field-help">{t("报告会提交给若道管理员复核。")}</span>
          <div className="settings-actions">
            <button type="button" className="button ghost small" disabled={sending} onClick={onClose}>
              {t("取消")}
            </button>
            <button type="submit" className="button primary small" disabled={sending}>
              {sending ? <span className="spinner small" /> : <SendIcon size={15} />}
              {sending ? t("正在提交…") : t("提交报告")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

export function SharedServersPanel({
  settings,
  assistant,
  onUseServer,
  notify,
}: SharedServersPanelProps) {
  const [tab, setTab] = useState<"list" | "mine">("list");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SharedServerSort>("recommended");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageData, setPageData] = useState<SharedServerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [mine, setMine] = useState<SharedServerMineState | null>(null);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineError, setMineError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; entry: SharedServerMineEntry } | null
  >(null);
  const [reportTarget, setReportTarget] = useState<SharedServerInfo | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginFocus, setLoginFocus] = useState(0);

  const signedIn = Boolean(assistant.status?.authenticated);
  const expired = Boolean(
    assistant.status && !assistant.status.authenticated && assistant.status.sessionExpired,
  );
  const accountLabel =
    assistant.status?.user?.displayName || assistant.status?.email || t("已登录若道账号");

  useEffect(() => {
    void assistant.ensureLoaded().finally(() => setAuthChecked(true));
  }, [assistant.ensureLoaded]);

  useEffect(() => {
    setPage(1);
  }, [query, sort, onlineOnly]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.remote.sharedServersList({
          q: query.trim(),
          sort,
          onlineOnly,
          page,
          size: PAGE_SIZE,
        });
        if (cancelled) return;
        setPageData(result);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError(cleanError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 280 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sort, onlineOnly, page, reloadKey, signedIn]);

  const loadMine = useCallback(async (refresh: boolean) => {
    setMineLoading(true);
    setMineError(null);
    try {
      const state = refresh
        ? await window.remote.sharedServersRefresh()
        : await window.remote.sharedServersMine();
      setMine(state);
    } catch (err) {
      setMineError(cleanError(err));
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setMine(null);
      setMineError(null);
      setMineLoading(false);
      return;
    }
    void loadMine(false);
  }, [loadMine, signedIn]);

  const requireLogin = useCallback(
    (message = t("登录若道账号后即可查看共享服务器详情")) => {
      notify(message, "info");
      setLoginFocus((value) => value + 1);
    },
    [notify],
  );

  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.size)) : 1;
  const mineEntries = mine?.entries ?? [];
  const activeMine = useMemo(
    () => mineEntries.filter((entry) => !entry.gone).length,
    [mineEntries],
  );

  async function useServer(server: SharedServerInfo): Promise<void> {
    if (usingId) return;
    if (!server.address) {
      notify(t("没有读取到服务器地址，请刷新列表或重新登录后再试"), "error");
      return;
    }
    setUsingId(server.id);
    try {
      await onUseServer(server.address, server.inviteCode, server.name);
    } catch (err) {
      notify(cleanError(err), "error");
    } finally {
      setUsingId(null);
    }
  }

  async function removeServer(entry: SharedServerMineEntry): Promise<void> {
    if (busyId) return;
    const name = entry.server?.name ?? t("这条记录");
    if (!window.confirm(tf("下架后「{0}」会从共享列表中移除，且无法恢复。确定继续？", name))) return;
    setBusyId(entry.id);
    try {
      await window.remote.sharedServersRemove({ id: entry.id });
      setMine((current) =>
        current
          ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) }
          : current,
      );
      notify(t("已下架共享服务器"), "success");
      setReloadKey((key) => key + 1);
    } catch (err) {
      notify(cleanError(err), "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(server: SharedServerInfo): void {
    setMine((current) => {
      if (!current) return current;
      const exists = current.entries.some((entry) => entry.id === server.id);
      if (!exists) {
        return {
          ...current,
          entries: [
            { id: server.id, addedAt: Date.now(), syncedAt: Date.now(), gone: false, server, error: null },
            ...current.entries,
          ],
        };
      }
      return {
        ...current,
        entries: current.entries.map((entry) =>
          entry.id === server.id
            ? { ...entry, server, syncedAt: Date.now(), gone: false, error: null }
            : entry,
        ),
      };
    });
    setReloadKey((key) => key + 1);
  }

  function openMine(): void {
    setTab("mine");
    if (!signedIn) {
      requireLogin(t("登录若道账号后即可管理你的共享服务器"));
      return;
    }
    if (!mine || mine.refreshedAt === null || Date.now() - mine.refreshedAt > 60_000) {
      void loadMine(true);
    }
  }

  return (
    <section className="panel shared-servers-panel" data-testid="shared-servers-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <GlobeIcon size={14} />
            </span>
            {t("共享服务器")}
          </span>
          <h1>{t("用社区分享的服务器，免费直连")}</h1>
          <p>
            {t("这里汇总社区成员自愿公开的若道远程信令服务器。列表无需登录即可浏览，登录若道账号后可查看完整详情并一键接入。")}
          </p>
        </div>
        <div className="panel-heading-actions">
          {signedIn && (
            <span className="shared-account-chip" title={t("社区留言与共享服务器共用此若道账号")}>
              <UserIcon size={14} />
              <span>{accountLabel}</span>
            </span>
          )}
          <button
            type="button"
            className="button ghost small"
            disabled={loading || mineLoading}
            onClick={() => {
              if (tab === "list") {
                setReloadKey((key) => key + 1);
                if (signedIn) void loadMine(true);
              } else if (signedIn) {
                void loadMine(true);
                setReloadKey((key) => key + 1);
              }
            }}
          >
            <RefreshIcon size={15} />
            {t("刷新")}
          </button>
          <button
            type="button"
            className="button primary small"
            data-testid="shared-server-publish"
            onClick={() => {
              if (!signedIn) {
                requireLogin(t("请先登录若道账号，再发布共享服务器"));
                return;
              }
              setDialog({ mode: "create" });
            }}
          >
            <SendIcon size={15} />
            {t("发布我的服务器")}
          </button>
        </div>
      </div>

      <nav className="server-tabs" aria-label={t("共享服务器视图")}>
        <button
          type="button"
          className={`server-tab${tab === "list" ? " active" : ""}`}
          onClick={() => setTab("list")}
        >
          <GlobeIcon size={14} />
          {t("共享列表")}
          {pageData && <span className="server-tab-badge soft">{pageData.total}</span>}
        </button>
        <button
          type="button"
          className={`server-tab${tab === "mine" ? " active" : ""}`}
          onClick={openMine}
        >
          <ShieldIcon size={14} />
          {t("我的分享")}
          {activeMine > 0 && <span className="server-tab-badge">{activeMine}</span>}
        </button>
        <span className="server-updated">
          {updatedAt
            ? tf("更新于 {0}", new Date(updatedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }))
            : ""}
        </span>
      </nav>

      <div className="server-tab-body shared-server-body">
        {!signedIn &&
          (authChecked ? (
            <SharedLoginCard
              assistant={assistant}
              expired={expired}
              focusSignal={loginFocus}
              onLoggedIn={() => {
                notify(t("已登录若道账号，共享服务器与社区留言已同步登录"), "success");
              }}
            />
          ) : (
            <div className="shared-login-checking">
              <span className="spinner small" />
              {t("正在检查若道登录状态…")}
            </div>
          ))}

        {tab === "list" ? (
          <>
            <div className="shared-server-toolbar">
              <div className="input-shell shared-server-search">
                <SearchIcon size={16} />
                <input
                  value={query}
                  placeholder={signedIn ? t("搜索名称、地区、配置或域名") : t("搜索名称或地区")}
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="shared-server-filters">
                <select
                  className="shared-server-select"
                  value={sort}
                  aria-label={t("排序方式")}
                  onChange={(event) => setSort(event.target.value as SharedServerSort)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`shared-server-toggle${onlineOnly ? " on" : ""}`}
                  aria-pressed={onlineOnly}
                  onClick={() => setOnlineOnly((value) => !value)}
                >
                  <CheckIcon size={14} />
                  {t("仅看在线")}
                </button>
              </div>
            </div>

            <div className="shared-server-note">
              <ShieldIcon size={16} />
              <span>
                {t("共享服务器由社区成员提供。若道只校验 /health 是否可达，不参与实际远控连接，也不保存远控码与访问密钥。列表公开浏览，完整详情与接入需登录若道账号；登录与社区留言通用。")}
              </span>
            </div>

            {error ? (
              <div className="shared-server-empty">
                <span className="shared-server-empty-icon error">
                  <AlertIcon size={24} />
                </span>
                <h2>{t("暂时读不到共享列表")}</h2>
                <p>{error}</p>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  <RefreshIcon size={15} />
                  {t("重新读取")}
                </button>
              </div>
            ) : loading && !pageData ? (
              <div className="shared-server-empty">
                <span className="spinner large" />
                <p>{t("正在读取共享服务器…")}</p>
              </div>
            ) : !pageData || pageData.items.length === 0 ? (
              <div className="shared-server-empty">
                <span className="shared-server-empty-icon">
                  <GlobeIcon size={24} />
                </span>
                <h2>{query || onlineOnly ? t("没有找到匹配的服务器") : t("还没有人分享服务器")}</h2>
                <p>
                  {query || onlineOnly
                    ? t("换个关键词，或取消“仅看在线”再试试。")
                    : t("如果你有闲置的服务器，可以发布出来，让社区用户免费使用。")}
                </p>
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => {
                    if (!signedIn) {
                      requireLogin(t("请先登录若道账号，再发布共享服务器"));
                      return;
                    }
                    setDialog({ mode: "create" });
                  }}
                >
                  <SendIcon size={15} />
                  {t("发布我的服务器")}
                </button>
              </div>
            ) : (
              <>
                <div className={`shared-server-grid${loading ? " is-loading" : ""}`}>
                  {pageData.items.map((server) => (
                    <PublicServerCard
                      key={server.id}
                      server={server}
                      current={signedIn && sameServer(settings.serverUrl, server.address)}
                      using={usingId === server.id}
                      signedIn={signedIn}
                      onUse={() => void useServer(server)}
                      onReport={() => setReportTarget(server)}
                      onRequireLogin={() => requireLogin()}
                    />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="shared-server-pagination">
                    <button
                      type="button"
                      className="button ghost small"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      {t("上一页")}
                    </button>
                    <span>
                      {t("第")} {page} / {totalPages} {t("页 · 共")} {pageData.total} {t("台")}
                    </span>
                    <button
                      type="button"
                      className="button ghost small"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    >
                      {t("下一页")}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="shared-server-note">
              <LockIcon size={16} />
              <span>
                {t("管理令牌只保存在这台电脑上，用来续期或下架你发布过的服务器。换一台电脑后无法再修改这些记录。查看和管理这些记录需要登录若道账号。")}
              </span>
            </div>

            {mineError && <InlineAlert>{mineError}</InlineAlert>}

            {!signedIn ? (
              <div className="shared-server-empty">
                <span className="shared-server-empty-icon">
                  <LockIcon size={24} />
                </span>
                <h2>{t("登录后管理你的分享")}</h2>
                <p>
                  {t("你的共享记录和管理令牌只保存在本机；登录若道账号后即可查看、续期或下架。")}
                </p>
              </div>
            ) : mineLoading && !mine ? (
              <div className="shared-server-empty">
                <span className="spinner large" />
                <p>{t("正在读取本机保存的共享记录…")}</p>
              </div>
            ) : mineEntries.length === 0 ? (
              <div className="shared-server-empty">
                <span className="shared-server-empty-icon">
                  <ServerIcon size={24} />
                </span>
                <h2>{t("你还没有发布过共享服务器")}</h2>
                <p>
                  {t("发布后，其他用户可以在「共享列表」里看到并直接使用；你随时可以在这里续期或下架。")}
                </p>
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => setDialog({ mode: "create" })}
                >
                  <SendIcon size={15} />
                  {t("发布我的服务器")}
                </button>
              </div>
            ) : (
              <div className="shared-server-grid">
                {mineEntries.map((entry) => (
                  <MineServerCard
                    key={entry.id}
                    entry={entry}
                    current={
                      entry.server ? sameServer(settings.serverUrl, entry.server.address) : false
                    }
                    using={usingId === entry.id}
                    busy={busyId === entry.id}
                    onUse={() => {
                      if (entry.server) void useServer(entry.server);
                    }}
                    onEdit={() => setDialog({ mode: "edit", entry })}
                    onRemove={() => void removeServer(entry)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel-foot trust-row">
        <span>
          <ShieldIcon size={14} /> {t("发布前自动检查 /health，只接受 HTTPS 公网地址")}
        </span>
        <span>
          <LockIcon size={14} /> {t("列表公开可见，详情与接入需登录若道账号")}
        </span>
        <span>
          <GlobeIcon size={14} /> {t("请只连接你信任的共享服务器")}
        </span>
      </div>

      {dialog && (
        <PublishDialog
          key={dialog.mode === "edit" ? `edit-${dialog.entry.id}` : "create"}
          mode={dialog.mode}
          entry={dialog.mode === "edit" ? dialog.entry : null}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
          notify={notify}
        />
      )}
      {reportTarget && (
        <ReportDialog
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          notify={notify}
        />
      )}
    </section>
  );
}