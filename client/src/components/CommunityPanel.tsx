import { useEffect, useRef, useState } from "react";
import type { AssistantController } from "../hooks/useAssistant";
import type { CommunityController } from "../hooks/useCommunity";
import type { CommunityReview } from "../types";
import {
  AlertIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  LockIcon,
  RefreshIcon,
  SendIcon,
  ShieldIcon,
  StarIcon,
  ThumbUpIcon,
  UserIcon,
} from "./icons";
import { InlineAlert } from "./ui";

interface CommunityPanelProps {
  assistant: AssistantController;
  community: CommunityController;
}

const RATING_LABELS = ["", "很不满意", "不太满意", "一般", "比较满意", "非常满意"];
const CONTENT_LIMIT = 1000;

function formatAgo(value: string): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <span
      className="community-stars"
      aria-label={value > 0 ? `${value.toFixed(1)} 星` : "尚未评分"}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon
          key={star}
          size={size}
          filled={star <= rounded}
          className={star <= rounded ? "star-on" : "star-off"}
        />
      ))}
    </span>
  );
}

function StarPicker({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="community-star-picker">
      <div
        className="community-star-buttons"
        role="radiogroup"
        aria-label="评分"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} 星`}
            data-testid={`community-star-${star}`}
            className={`community-star-button${star <= shown ? " on" : ""}`}
            disabled={disabled}
            onMouseEnter={() => setHover(star)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(star)}
          >
            <StarIcon size={27} filled={star <= shown} />
          </button>
        ))}
      </div>
      <span className="community-star-label">{RATING_LABELS[value]}</span>
    </div>
  );
}

export function CommunityPanel({ assistant, community }: CommunityPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(true);
  const authSeen = useRef<boolean | null>(null);

  const signedIn = Boolean(assistant.status?.authenticated);
  const expired = Boolean(
    assistant.status && !assistant.status.authenticated && assistant.status.sessionExpired,
  );
  const thread = community.thread;
  const myReview = thread?.myReview ?? null;
  const isOwner = Boolean(thread?.isOwner);
  const items = thread?.items ?? [];
  const summary = thread?.summary;
  const ratingCount = summary?.ratingCount ?? 0;
  const ratingAvg = summary?.ratingAvg ?? 0;
  const distribution = summary?.distribution ?? [0, 0, 0, 0, 0];
  const loadedCount = items.length + (myReview ? 1 : 0);
  const hasMore = Boolean(thread && loadedCount < thread.total);
  const appName = thread?.app.name || "若道远程控制";

  useEffect(() => {
    void assistant.ensureLoaded();
    void community.ensureLoaded();
  }, [assistant.ensureLoaded, community.ensureLoaded]);

  useEffect(() => {
    const previous = authSeen.current;
    authSeen.current = signedIn;
    if (previous !== null && previous === signedIn) return;
    if (!community.thread || community.thread.signedIn === signedIn) return;
    void community.refresh();
  }, [signedIn, community.refresh, community.thread]);

  useEffect(() => {
    if (community.error && /登录|过期/.test(community.error)) {
      void assistant.refresh();
    }
  }, [community.error, assistant.refresh]);

  useEffect(() => {
    if (signedIn) return;
    const saved = assistant.status?.email;
    if (saved) setEmail((current) => current || saved);
  }, [signedIn, assistant.status?.email]);

  useEffect(() => {
    const mine = community.thread?.myReview ?? null;
    setRating(mine && mine.rating > 0 ? mine.rating : 5);
    setContent(mine?.content ?? "");
    setEditing(!mine);
  }, [community.thread?.app.id, community.thread?.myReview?.id]);

  async function submitLogin(): Promise<void> {
    if (assistant.loginBusy) return;
    const ok = await assistant.login(email, password);
    if (ok) setPassword("");
  }

  async function submitReview(): Promise<void> {
    if (community.submitting) return;
    const ok = await community.submit(rating, content.trim());
    if (ok) setEditing(false);
  }

  async function deleteReview(review: CommunityReview): Promise<void> {
    if (community.deletingId) return;
    if (!window.confirm("删除后评分与文字会从应用中移除。确定删除这条留言？")) return;
    await community.remove(review.id);
  }

  function cancelEdit(): void {
    setRating(myReview && myReview.rating > 0 ? myReview.rating : 5);
    setContent(myReview?.content ?? "");
    setEditing(false);
  }

  return (
    <section className="panel community-panel" data-testid="community-panel">
      <div className="panel-heading community-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <ChatIcon size={14} />
            </span>
            社区留言
          </span>
          <h1>看看大家怎么用若道远程</h1>
          <p>
            这里同步若道插件市场「{appName}」的评论区。登录若道账号后，可以直接在客户端里留下体验、更新评分或回复讨论。
          </p>
        </div>
        <div className="community-heading-actions">
          <button
            type="button"
            className="button ghost small"
            disabled={community.refreshing || community.loading}
            onClick={() => void community.refresh()}
          >
            {community.refreshing ? (
              <span className="spinner small" />
            ) : (
              <RefreshIcon size={15} />
            )}
            刷新
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void community.openApp()}
          >
            <LinkIcon size={15} />
            在若道查看
          </button>
        </div>
      </div>

      {community.error && thread && <InlineAlert>{community.error}</InlineAlert>}
      {community.notice && <InlineAlert kind="info">{community.notice}</InlineAlert>}

      <div className="community-layout">
        <div className="community-main">
          {community.loading && !thread ? (
            <div className="community-loading">
              <span className="spinner large" />
              <p>正在读取若道插件市场的留言…</p>
            </div>
          ) : !thread ? (
            <div className="community-empty large">
              <span className="community-empty-icon error">
                <AlertIcon size={26} />
              </span>
              <h2>暂时读不到社区留言</h2>
              <p>{community.error ?? "社区留言暂时不可用，请稍后再试。"}</p>
              <div className="community-empty-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={community.refreshing || community.loading}
                  onClick={() => void community.refresh()}
                >
                  {community.refreshing ? (
                    <span className="spinner" />
                  ) : (
                    <RefreshIcon size={16} />
                  )}
                  重新读取
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => void community.openMarket()}
                >
                  <LinkIcon size={16} />
                  打开插件市场
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="community-summary">
                <div className="community-score">
                  <strong>{ratingCount > 0 ? ratingAvg.toFixed(1) : "—"}</strong>
                  <StarRow value={ratingAvg} size={16} />
                  <span>{ratingCount > 0 ? `${ratingCount} 条评分` : "还没有评分"}</span>
                </div>
                <div className="community-bars">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = distribution[star - 1] ?? 0;
                    return (
                      <div className="community-bar-row" key={star}>
                        <span>{star} 星</span>
                        <i>
                          <b
                            style={{
                              width: `${Math.round((count / Math.max(1, ratingCount)) * 100)}%`,
                            }}
                          />
                        </i>
                        <em>{count}</em>
                      </div>
                    );
                  })}
                </div>
                <div className="community-summary-note">
                  <ShieldIcon size={17} />
                  <div>
                    <strong>真实安装，真实体验</strong>
                    <span>“已安装”标记来自若道安装记录，评分会直接影响应用在插件市场的排序。</span>
                  </div>
                </div>
              </div>

              <div className="community-discussions">
                <div className="community-section-head">
                  <div>
                    <ChatIcon size={16} />
                    <strong>大家的讨论</strong>
                    <span className="community-count">{thread.total} 条留言</span>
                  </div>
                  <span className="community-sort">按最新排序</span>
                </div>

                {items.length === 0 ? (
                  <div className="community-empty">
                    <span className="community-empty-icon">
                      <ChatIcon size={24} />
                    </span>
                    <h2>还没有人留言</h2>
                    <p>
                      {signedIn
                        ? "如果你已经用过若道远程控制，欢迎在右侧写下第一条经验或问题。"
                        : "登录若道账号后，可以在右侧写下第一条留言。"}
                    </p>
                  </div>
                ) : (
                  <div className="community-review-list">
                    {items.map((review) => (
                      <article className="community-review" key={review.id}>
                        <header>
                          <span className="community-avatar" aria-hidden>
                            {review.userLabel.trim().slice(0, 1) || "用"}
                          </span>
                          <div className="community-review-who">
                            <strong>
                              {review.userLabel}
                              {review.verified && (
                                <em
                                  className="community-verified"
                                  title="评价者安装过该应用"
                                >
                                  <CheckIcon size={11} />
                                  已安装
                                </em>
                              )}
                            </strong>
                            <span>
                              <StarRow value={review.rating} size={13} />
                              <span title={review.createdAt}>
                                {formatAgo(review.createdAt)}
                              </span>
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`community-helpful${review.helpful ? " on" : ""}`}
                            disabled={!signedIn || community.helpfulId === review.id}
                            title={
                              !signedIn
                                ? "登录后可标记这条留言有帮助"
                                : review.helpful
                                  ? "取消标记"
                                  : "这条留言有帮助"
                            }
                            onClick={() => void community.markHelpful(review)}
                          >
                            {community.helpfulId === review.id ? (
                              <span className="spinner small" />
                            ) : (
                              <ThumbUpIcon size={13} />
                            )}
                            <span>
                              {review.helpfulCount > 0 ? review.helpfulCount : "有帮助"}
                            </span>
                          </button>
                        </header>
                        <p className={`community-review-text${review.content ? "" : " muted"}`}>
                          {review.content || "只留下了评分。"}
                        </p>
                        {review.authorReply && (
                          <div className="community-author-reply">
                            <strong>
                              <ShieldIcon size={12} />
                              作者回复
                            </strong>
                            <p>{review.authorReply.content}</p>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}

                {hasMore && (
                  <button
                    type="button"
                    className="button ghost wide community-load-more"
                    disabled={community.loadingMore}
                    onClick={() => void community.loadMore()}
                  >
                    {community.loadingMore ? (
                      <span className="spinner small" />
                    ) : (
                      <ChevronDownIcon size={16} />
                    )}
                    {community.loadingMore ? "正在加载…" : "加载更多留言"}
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
              <p>正在检查若道登录状态…</p>
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
                <UserIcon size={15} /> 若道账号
              </span>
              <h3>登录后参与讨论</h3>
              <p>登录只用于向若道提交评论，留言会显示你的昵称，作者可以直接回复。</p>
              {expired && (
                <InlineAlert kind="info">登录已过期，请重新输入密码。远控连接不受影响。</InlineAlert>
              )}
              <label className="field">
                <div className="field-label">
                  <span>邮箱</span>
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
                  <span>密码</span>
                </div>
                <div className="input-shell">
                  <LockIcon size={17} />
                  <input
                    data-testid="community-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="若道账号密码"
                    autoComplete="current-password"
                    maxLength={256}
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
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
                {assistant.loginBusy ? "正在登录…" : "登录若道账号"}
              </button>
              <div className="community-login-links">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void assistant.openAccount("register")}
                >
                  注册若道账号
                </button>
                <span>·</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void assistant.openAccount("login")}
                >
                  在浏览器中登录
                </button>
              </div>
            </form>
          ) : isOwner ? (
            <div className="community-card community-owner-card">
              <span className="community-owner-icon">
                <ShieldIcon size={19} />
              </span>
              <h3>这是你发布的应用</h3>
              <p>
                创作者不能给自己的应用评分。你可以在左侧查看大家的反馈，并在若道应用详情页逐条回复。
              </p>
              <button
                type="button"
                className="button ghost small"
                onClick={() => void community.openApp()}
              >
                <LinkIcon size={15} />
                在若道回复评论
              </button>
            </div>
          ) : (
            <section className="community-card community-composer">
              <div className="community-composer-head">
                <div>
                  <span className="community-kicker">
                    <ChatIcon size={15} /> 我的留言
                  </span>
                  <h3>{myReview ? "我的评价" : "写下我的使用感受"}</h3>
                </div>
                {myReview && !editing && (
                  <div className="community-my-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditing(true)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={Boolean(community.deletingId)}
                      onClick={() => void deleteReview(myReview)}
                    >
                      {community.deletingId === myReview.id ? "删除中…" : "删除"}
                    </button>
                  </div>
                )}
              </div>

              {myReview && !editing ? (
                <div className="community-my-review">
                  <div className="community-my-meta">
                    <StarRow value={myReview.rating} size={16} />
                    <span>{formatAgo(myReview.createdAt)}</span>
                  </div>
                  <p className={myReview.content ? undefined : "muted"}>
                    {myReview.content || "只留下了评分。"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="community-field-label">给 {appName} 打分</div>
                  <StarPicker
                    value={rating}
                    disabled={community.submitting}
                    onChange={setRating}
                  />
                  <label className="community-textarea">
                    <textarea
                      data-testid="community-content"
                      value={content}
                      maxLength={CONTENT_LIMIT}
                      rows={5}
                      placeholder="这个应用帮你解决了什么问题？也可以写下遇到的问题或希望改进的地方。"
                      onChange={(event) => setContent(event.target.value)}
                    />
                    <span className="community-char-count">
                      {content.length} / {CONTENT_LIMIT}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="button primary wide"
                    data-testid="community-submit"
                    disabled={community.submitting}
                    onClick={() => void submitReview()}
                  >
                    {community.submitting ? (
                      <span className="spinner" />
                    ) : (
                      <SendIcon size={16} />
                    )}
                    {community.submitting
                      ? "正在提交…"
                      : myReview
                        ? "更新留言"
                        : "发布留言"}
                  </button>
                  {myReview && (
                    <button
                      type="button"
                      className="button ghost wide"
                      disabled={community.submitting}
                      onClick={cancelEdit}
                    >
                      取消编辑
                    </button>
                  )}
                  <p className="community-composer-hint">
                    <LockIcon size={13} />
                    评论会公开显示，请不要填写远控码、访问密钥或登录密码。
                  </p>
                </>
              )}
            </section>
          )}

          <div className="community-card community-app-card">
            <div className="community-app-head">
              <span className="community-app-mark">
                <LinkIcon size={19} />
              </span>
              <div>
                <strong>{appName}</strong>
                <span>
                  {thread?.app.source === "ecosystem"
                    ? "若道开放生态 · 评论区同步"
                    : "若道功能插件 · 评论区同步"}
                </span>
              </div>
            </div>
            <p>
              {thread?.app.summary ||
                "用远控码和访问密钥直连的桌面远程控制工具，免注册、不经过第三方中转。"}
            </p>
            <div className="community-app-actions">
              <button
                type="button"
                className="button ghost small"
                onClick={() => void community.openApp()}
              >
                <LinkIcon size={15} />
                在若道查看
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={() => void community.openMarket()}
              >
                插件市场
              </button>
            </div>
            <ul className="community-rules">
              <li>
                <EyeIcon size={13} />
                评论公开显示在若道应用详情页
              </li>
              <li>
                <ChatIcon size={13} />
                作者回复会出现在留言下方
              </li>
              <li>
                <LockIcon size={13} />
                不要公开远控码与访问密钥
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="panel-foot trust-row">
        <span>
          <ShieldIcon size={14} /> 登录令牌只保存在本机
        </span>
        <span>
          <ChatIcon size={14} /> 留言来自若道插件市场评论区
        </span>
        <span>
          <LockIcon size={14} /> 评论公开可见，注意保护敏感信息
        </span>
      </div>
    </section>
  );
}
