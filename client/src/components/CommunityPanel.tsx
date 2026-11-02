import { useEffect, useRef, useState } from "react";
import type { AssistantController } from "../hooks/useAssistant";
import type { OpenSourceController } from "../hooks/useOpenSource";
import type { OpenSourceComment } from "../types";
import { commentPlainText, parseCommentBody } from "../lib/comment-body";
import {
  AlertIcon,
  BookIcon,
  ChatIcon,
  ChevronDownIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  LockIcon,
  RefreshIcon,
  SendIcon,
  ShieldIcon,
  ThumbUpIcon,
  UserIcon,
} from "./icons";
import { InlineAlert } from "./ui";

import { t, tf } from "../i18n";

interface CommunityPanelProps {
  assistant: AssistantController;
  openSource: OpenSourceController;
}

const CONTENT_LIMIT = 1000;

function formatAgo(value: string): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) return t("刚刚");
  if (diff < 3_600_000) return tf("{0} 分钟前", Math.floor(diff / 60_000));
  if (diff < 86_400_000) return tf("{0} 小时前", Math.floor(diff / 3_600_000));
  if (diff < 30 * 86_400_000) return tf("{0} 天前", Math.floor(diff / 86_400_000));
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 评论正文：只渲染白名单节点，链接交给主进程用系统浏览器打开。 */
function CommentBody({ html, onOpenLink }: { html: string; onOpenLink: (url: string) => void }) {
  const nodes = parseCommentBody(html);
  if (nodes.length === 0) {
    return <p className="community-review-text muted">{t("（空评论）")}</p>;
  }
  return (
    <p className="community-review-text">
      {nodes.map((node, index) => {
        if (node.kind === "break") return <br key={index} />;
        if (node.kind === "strong") return <strong key={index}>{node.text}</strong>;
        if (node.kind === "em") return <em key={index}>{node.text}</em>;
        if (node.kind === "code") return <code key={index}>{node.text}</code>;
        if (node.kind === "link") {
          return (
            <button
              key={index}
              type="button"
              className="community-inline-link"
              title={node.href}
              onClick={() => onOpenLink(node.href)}
            >
              {node.text}
            </button>
          );
        }
        return <span key={index}>{node.text}</span>;
      })}
    </p>
  );
}

export function CommunityPanel({ assistant, openSource }: CommunityPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const authSeen = useRef<boolean | null>(null);

  const signedIn = Boolean(assistant.status?.authenticated);
  const expired = Boolean(
    assistant.status && !assistant.status.authenticated && assistant.status.sessionExpired,
  );
  const thread = openSource.thread;
  const product = thread?.product ?? null;
  const items = thread?.items ?? [];
  const identity = thread?.identity ?? null;
  const total = thread?.total ?? 0;
  const title = product?.title || t("若道远程");
  const hasMore = Boolean(thread && items.length < total);

  useEffect(() => {
    void assistant.ensureLoaded();
    void openSource.ensureLoaded();
  }, [assistant.ensureLoaded, openSource.ensureLoaded]);

  // 登录状态变化时重新拉一次：评论的 owner 字段与昵称都跟令牌有关。
  useEffect(() => {
    const previous = authSeen.current;
    authSeen.current = signedIn;
    if (previous === null || previous === signedIn) return;
    void openSource.refresh();
  }, [signedIn, openSource.refresh]);

  useEffect(() => {
    if (openSource.error && /登录|过期|权限/.test(openSource.error)) {
      void assistant.refresh();
    }
  }, [openSource.error, assistant.refresh]);

  useEffect(() => {
    if (signedIn) return;
    const saved = assistant.status?.email;
    if (saved) setEmail((current) => current || saved);
  }, [signedIn, assistant.status?.email]);

  async function submitLogin(): Promise<void> {
    if (assistant.loginBusy) return;
    const ok = await assistant.login(email, password);
    if (ok) setPassword("");
  }

  async function submitComment(): Promise<void> {
    const body = draft.trim();
    if (!body || openSource.submitting) return;
    const ok = await openSource.submit(body);
    if (ok) setDraft("");
  }

  async function submitReply(): Promise<void> {
    const body = replyDraft.trim();
    if (!body || !replyTo || openSource.submitting) return;
    const ok = await openSource.submit(body, replyTo.id);
    if (ok) {
      setReplyDraft("");
      setReplyTo(null);
    }
  }

  async function deleteComment(comment: OpenSourceComment): Promise<void> {
    if (openSource.deletingId) return;
    const preview = commentPlainText(comment.body).slice(0, 40);
    const message = tf("删除后这条评论会从若道社区页一起消失。确定删除「{0}」？", preview || t("这条评论"));
    if (!window.confirm(message)) return;
    await openSource.remove(comment.id);
  }

  function startReply(comment: OpenSourceComment): void {
    setReplyTo({ id: comment.id, name: comment.authorName });
    setReplyDraft("");
  }

  function renderComment(comment: OpenSourceComment, depth: number) {
    const replying = replyTo?.id === comment.id;
    return (
      <article
        className={`community-review community-comment${depth > 0 ? " reply" : ""}`}
        key={comment.id}
        style={depth > 0 ? { marginLeft: `${Math.min(2, depth) * 22}px` } : undefined}
      >
        <header>
          <span className="community-avatar" aria-hidden>
            {comment.authorName.trim().slice(0, 1) || t("用")}
          </span>
          <div className="community-review-who">
            <strong>
              {comment.authorName}
              {comment.owner && (
                <em className="community-verified">
                  <UserIcon size={11} />
                  {t("我")}
                </em>
              )}
            </strong>
            <span>
              {comment.replyToName && <em>{tf("回复 {0}", comment.replyToName)} · </em>}
              <span title={comment.createdAt}>{formatAgo(comment.createdAt)}</span>
            </span>
          </div>
          <div className="community-comment-actions">
            <button
              type="button"
              className="text-button"
              disabled={!signedIn}
              title={signedIn ? t("回复这条评论") : t("登录后才可回复")}
              onClick={() => startReply(comment)}
            >
              <ChatIcon size={13} />
              {t("回复")}
            </button>
            {comment.owner && (
              <button
                type="button"
                className="text-button danger"
                disabled={Boolean(openSource.deletingId)}
                onClick={() => void deleteComment(comment)}
              >
                {openSource.deletingId === comment.id ? t("删除中…") : t("删除")}
              </button>
            )}
          </div>
        </header>

        <CommentBody html={comment.body} onOpenLink={(url) => void openSource.openUrl(url)} />

        {comment.replies.length > 0 && (
          <div className="community-replies">
            {comment.replies.map((reply) => renderComment(reply, depth + 1))}
          </div>
        )}

        {replying && (
          <div className="community-reply-form">
            <span className="community-kicker">
              <ChatIcon size={13} />
              {tf("回复 {0}", replyTo?.name ?? "")}
            </span>
            <textarea
              value={replyDraft}
              rows={3}
              maxLength={CONTENT_LIMIT}
              placeholder={t("写下你的回复…")}
              onChange={(event) => setReplyDraft(event.target.value)}
            />
            <div className="community-reply-actions">
              <button
                type="button"
                className="button primary small"
                disabled={openSource.submitting || !replyDraft.trim()}
                onClick={() => void submitReply()}
              >
                {openSource.submitting ? <span className="spinner small" /> : <SendIcon size={14} />}
                {openSource.submitting ? t("正在发布…") : t("发布回复")}
              </button>
              <button
                type="button"
                className="button ghost small"
                disabled={openSource.submitting}
                onClick={() => setReplyTo(null)}
              >
                {t("取消")}
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="panel community-panel" data-testid="community-panel">
      <div className="panel-heading community-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <ChatIcon size={14} />
            </span>
            {t("若道开源社区")}
          </span>
          <h1>{t("大家的评论都在若道")}</h1>
          <p>
            {t("这里和若道开源产品页是同一份评论数据：在客户端发的评论会立刻出现在站点上，站点上的回复也会同步到这里。")}
          </p>
        </div>
        <div className="community-heading-actions">
          <button
            type="button"
            className="button ghost small"
            disabled={openSource.refreshing || openSource.loading}
            onClick={() => void openSource.refresh()}
          >
            {openSource.refreshing ? <span className="spinner small" /> : <RefreshIcon size={15} />}
            {t("刷新")}
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void openSource.open("community")}
          >
            <LinkIcon size={15} />
            {t("在若道讨论")}
          </button>
        </div>
      </div>

      {openSource.error && thread && <InlineAlert>{openSource.error}</InlineAlert>}
      {openSource.notice && <InlineAlert kind="info">{openSource.notice}</InlineAlert>}

      <div className="community-layout">
        <div className="community-main">
          {openSource.loading && !thread ? (
            <div className="community-loading">
              <span className="spinner large" />
              <p>{t("正在读取若道社区…")}</p>
            </div>
          ) : !thread ? (
            <div className="community-empty large">
              <span className="community-empty-icon error">
                <AlertIcon size={26} />
              </span>
              <h2>{t("暂时读不到若道社区")}</h2>
              <p>{openSource.error ?? t("若道社区暂时不可用，请稍后再试。")}</p>
              <div className="community-empty-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={openSource.refreshing || openSource.loading}
                  onClick={() => void openSource.refresh()}
                >
                  {openSource.refreshing ? <span className="spinner" /> : <RefreshIcon size={16} />}
                  {t("重新读取")}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => void openSource.open("catalog")}
                >
                  <LinkIcon size={16} />
                  {t("打开开源产品栏")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="community-summary community-summary-stats">
                <div className="community-stats">
                  <div className="community-stat">
                    <ChatIcon size={15} />
                    <strong>{product?.commentCount ?? total}</strong>
                    <span>{t("评论")}</span>
                  </div>
                  <div className="community-stat">
                    <ThumbUpIcon size={15} />
                    <strong>{product?.likeCount ?? 0}</strong>
                    <span>{t("点赞")}</span>
                  </div>
                  <div className="community-stat">
                    <ShieldIcon size={15} />
                    <strong>{product?.version ? `v${product.version}` : "—"}</strong>
                    <span>{t("当前版本")}</span>
                  </div>
                  <div className="community-stat">
                    <RefreshIcon size={15} />
                    <strong>{product?.updatedAt ? formatAgo(product.updatedAt) : "—"}</strong>
                    <span>{t("最近更新")}</span>
                  </div>
                </div>
                <div className="community-summary-note">
                  <ShieldIcon size={17} />
                  <div>
                    <strong>{t("数据来自若道公开接口")}</strong>
                    <span>
                      {tf(
                        "评论数、点赞数与版本号都随 {0} 同步，客户端不做本地统计。",
                        product?.communityUrl || "ruodao.com",
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="community-discussions">
                <div className="community-section-head">
                  <div>
                    <ChatIcon size={16} />
                    <strong>{t("大家的讨论")}</strong>
                    <span className="community-count">
                      {total} {t("条评论")}
                    </span>
                  </div>
                  <span className="community-sort">{t("按最新排序")}</span>
                </div>

                {items.length === 0 ? (
                  <div className="community-empty">
                    <span className="community-empty-icon">
                      <ChatIcon size={24} />
                    </span>
                    <h2>{t("还没有人评论")}</h2>
                    <p>
                      {signedIn
                        ? t("你可以在右侧写下第一条评论：用过之后哪里顺手、哪里卡住，都值得说。")
                        : t("用若道账号登录后，就可以在右侧写下第一条评论。")}
                    </p>
                  </div>
                ) : (
                  <div className="community-review-list">
                    {items.map((comment) => renderComment(comment, 0))}
                  </div>
                )}

                {hasMore && (
                  <button
                    type="button"
                    className="button ghost wide community-load-more"
                    disabled={openSource.loadingMore}
                    onClick={() => void openSource.loadMore()}
                  >
                    {openSource.loadingMore ? (
                      <span className="spinner small" />
                    ) : (
                      <ChevronDownIcon size={16} />
                    )}
                    {openSource.loadingMore ? t("正在加载…") : t("加载更多评论")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="community-side">
          {!assistant.status && assistant.loading ? (
            <div className="community-card community-side-loading">
              <span className="spinner" />
              <p>{t("正在检查若道登录状态…")}</p>
            </div>
          ) : !signedIn ? (
            <form
              className="community-card community-login-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitLogin();
              }}
            >
              <span className="community-kicker">
                <UserIcon size={15} /> {t("若道账号")}
              </span>
              <h3>{t("登录后参与讨论")}</h3>
              <p>
                {t("评论要走若道统一身份，登录只用于发评论和认领自己的评论；同一个账号也解锁共享服务器详情与 AI 助手。")}
              </p>
              {expired && (
                <InlineAlert kind="info">
                  {t("登录已过期，请重新输入密码。远控连接不受影响。")}
                </InlineAlert>
              )}
              <label className="field">
                <div className="field-label">
                  <span>{t("邮箱")}</span>
                </div>
                <div className="input-shell">
                  <UserIcon size={17} />
                  <input
                    data-testid="community-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    spellCheck={false}
                  />
                </div>
              </label>
              <label className="field">
                <div className="field-label">
                  <span>{t("密码")}</span>
                </div>
                <div className="input-shell">
                  <LockIcon size={17} />
                  <input
                    data-testid="community-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t("若道账号密码")}
                    autoComplete="current-password"
                    maxLength={256}
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? t("隐藏密码") : t("显示密码")}
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </label>
              {assistant.error && <InlineAlert>{assistant.error}</InlineAlert>}
              <button
                type="submit"
                className="button primary wide"
                data-testid="community-login"
                disabled={assistant.loginBusy || !email.trim() || !password}
              >
                {assistant.loginBusy ? <span className="spinner" /> : <SendIcon size={16} />}
                {assistant.loginBusy ? t("正在登录…") : t("登录若道账号")}
              </button>
              <div className="community-login-links">
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
          ) : (
            <section className="community-card community-composer">
              <div className="community-composer-head">
                <div>
                  <span className="community-kicker">
                    <ChatIcon size={15} />
                    {identity?.displayName || assistant.status?.user?.displayName || t("若道账号")}
                  </span>
                  <h3>{t("写一条评论")}</h3>
                </div>
                <span className="community-char-count">
                  {draft.length} / {CONTENT_LIMIT}
                </span>
              </div>
              <label className="community-textarea">
                <textarea
                  data-testid="community-content"
                  value={draft}
                  maxLength={CONTENT_LIMIT}
                  rows={6}
                  placeholder={t("这个工具帮你解决了什么问题？也可以写下遇到的问题或希望改进的地方。")}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button primary wide"
                data-testid="community-submit"
                disabled={openSource.submitting || !draft.trim()}
                onClick={() => void submitComment()}
              >
                {openSource.submitting ? <span className="spinner" /> : <SendIcon size={16} />}
                {openSource.submitting ? t("正在发布…") : t("发布评论")}
              </button>
              <p className="community-composer-hint">
                <LockIcon size={13} />
                {t("评论会公开显示，请不要填写远控码、访问密钥或登录密码。")}
              </p>
            </section>
          )}

          <div className="community-card community-app-card">
            <div className="community-app-head">
              <span className="community-app-mark">
                <LinkIcon size={19} />
              </span>
              <div>
                <strong>{title}</strong>
                <span>
                  {product?.official ? t("若道官方 · 开源产品") : t("开源产品 · 社区共建")}
                </span>
              </div>
            </div>
            <p>
              {product?.summary ||
                t("用远控码和访问密钥直连的桌面远程控制工具，免注册、不经过第三方中转。")}
            </p>
            <dl className="community-meta-list">
              <div>
                <dt>{t("作者")}</dt>
                <dd>{product?.authorDisplayName || "—"}</dd>
              </div>
              <div>
                <dt>{t("协议")}</dt>
                <dd>{product?.licenseName || "MIT"}</dd>
              </div>
              <div>
                <dt>{t("版本")}</dt>
                <dd>{product?.version ? `v${product.version}` : "—"}</dd>
              </div>
            </dl>
            <div className="community-app-actions">
              <button
                type="button"
                className="button ghost small"
                disabled={!product?.repositoryUrl}
                onClick={() => void openSource.open("repository")}
              >
                <LinkIcon size={15} />
                {t("代码仓库")}
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={() => void openSource.open("docs")}
              >
                <BookIcon size={15} />
                {t("接入文档")}
              </button>
              <button
                type="button"
                className="button ghost small"
                disabled={!product?.downloadUrl}
                onClick={() => void openSource.open("download")}
              >
                <DownloadIcon size={15} />
                {t("下载")}
              </button>
            </div>
            <ul className="community-rules">
              <li>
                <EyeIcon size={13} />
                {t("评论公开显示在若道开源产品页")}
              </li>
              <li>
                <ChatIcon size={13} />
                {t("回复会挂在评论下方，作者也能收到")}
              </li>
              <li>
                <LockIcon size={13} />
                {t("不要公开远控码与访问密钥")}
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="panel-foot trust-row">
        <span>
          <ShieldIcon size={14} /> {t("登录令牌只保存在本机")}
        </span>
        <span>
          <ChatIcon size={14} /> {t("评论来自若道开源社区，与站点共用一份数据")}
        </span>
        <span>
          <LockIcon size={14} /> {t("评论公开可见，注意保护敏感信息")}
        </span>
      </div>
    </section>
  );
}
