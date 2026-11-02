/**
 * 若道开源产品公开接口（`/api/public/apps`）的纯协议层。
 *
 * 对应《开源产品接入若道社区标准》v1.0：
 * https://ruodao.com/open-source/docs
 *
 * 这一层不依赖 Electron，负责把服务端返回的结构收敛成客户端内部类型，
 * 并把错误码翻译成可以直接展示给用户的中文提示，便于单元测试。
 */

export const OPEN_SOURCE_SLUG_ENV = "RUODAO_OPEN_SOURCE_SLUG";
export const OPEN_SOURCE_DEFAULT_SLUG = "ruodao-remote";
export const OPEN_SOURCE_PAGE_SIZE = 10;
export const OPEN_SOURCE_MAX_PAGE_SIZE = 50;
export const OPEN_SOURCE_COMMENT_LIMIT = 1000;
export const OPEN_SOURCE_DOC_PATH = "/open-source/docs";
export const OPEN_SOURCE_CATALOG_PATH = "/open-source";

export interface OpenSourceIdentity {
  userId: string;
  displayName: string;
  avatarUrl: string;
  maskedEmail: string;
}

export interface OpenSourceProduct {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  version: string;
  authorDisplayName: string;
  authorAvatarUrl: string;
  licenseName: string;
  repositoryUrl: string;
  communityUrl: string;
  communityApiUrl: string;
  integrationDocUrl: string;
  downloadUrl: string;
  changelog: string;
  commentCount: number;
  likeCount: number;
  official: boolean;
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface OpenSourceComment {
  id: string;
  userId: string;
  authorName: string;
  authorAvatarUrl: string;
  /** 服务端已消毒的 HTML，渲染前仍由渲染层按白名单转换。 */
  body: string;
  owner: boolean;
  parentCommentId: string;
  replyToName: string;
  replyCount: number;
  createdAt: string;
  replies: OpenSourceComment[];
}

export interface OpenSourceCommentPage {
  items: OpenSourceComment[];
  total: number;
  page: number;
  size: number;
}

export interface OpenSourceApiError extends Error {
  status: number;
  code: string;
}

function apiError(message: string, status = 0, code = "open-source-error"): OpenSourceApiError {
  const error = new Error(message) as OpenSourceApiError;
  error.status = status;
  error.code = code;
  return error;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Math.round(numberOf(value, fallback));
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
}

function booleanOf(value: unknown): boolean {
  return value === true || value === "true";
}

/** 把 `/uploads/x.png` 之类的相对地址补全为绝对地址。 */
export function absoluteUrl(base: string, value: unknown): string {
  const raw = textOf(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${base.replace(/\/+$/, "")}${raw}`;
  return "";
}

function tagsOf(value: unknown): string[] {
  const raw = textOf(value);
  if (!raw) return [];
  return raw
    .split(/[,，、]/)
    .map((tag) => tag.trim())
    .filter((tag, index, list) => Boolean(tag) && list.indexOf(tag) === index)
    .slice(0, 12);
}

export function parseOpenSourceProduct(value: unknown, baseUrl = ""): OpenSourceProduct {
  const record = recordOf(value);
  const slug = textOf(record.slug);
  const id = textOf(record.id);
  if (!slug && !id) {
    throw apiError("若道返回的开源产品数据缺少标识，请稍后重试。", 0, "invalid-product");
  }
  const communityUrl =
    textOf(record.communityUrl) || (slug ? `${baseUrl.replace(/\/+$/, "")}/open-source/${slug}` : "");
  return {
    id,
    slug,
    title: textOf(record.title) || textOf(record.productName) || slug || "开源产品",
    summary: textOf(record.summary),
    tags: tagsOf(record.appTags),
    category: textOf(record.category),
    version: textOf(record.version),
    authorDisplayName: textOf(record.authorDisplayName),
    authorAvatarUrl: absoluteUrl(baseUrl, record.authorAvatarUrl),
    licenseName: textOf(record.licenseName),
    repositoryUrl: textOf(record.repositoryUrl),
    communityUrl,
    communityApiUrl: textOf(record.communityApiUrl),
    integrationDocUrl: textOf(record.integrationDocUrl) || `${baseUrl.replace(/\/+$/, "")}${OPEN_SOURCE_DOC_PATH}`,
    downloadUrl: textOf(record.downloadUrl),
    changelog: textOf(record.changelog),
    commentCount: Math.max(0, Math.round(numberOf(record.commentCount))),
    likeCount: Math.max(0, Math.round(numberOf(record.likeCount))),
    official: booleanOf(record.official),
    featured: booleanOf(record.featured),
    publishedAt: textOf(record.publishedAt),
    updatedAt: textOf(record.updatedAt),
  };
}

/** 目录接口里挑出目标条目：先精确匹配 slug，再退化为包含匹配。 */
export function pickOpenSourceSlug(items: unknown, slug: string): string {
  const list = Array.isArray(items) ? items : [];
  const wanted = slug.trim().toLowerCase();
  const slugs = list.map((item) => {
    const record = recordOf(item);
    return { slug: textOf(record.slug), openSource: booleanOf(record.openSource) };
  });
  const exact = slugs.find((entry) => entry.slug.toLowerCase() === wanted);
  if (exact) return exact.slug;
  const contains = slugs.find(
    (entry) =>
      entry.slug &&
      entry.openSource !== false &&
      (entry.slug.toLowerCase().includes(wanted) || wanted.includes(entry.slug.toLowerCase())),
  );
  return contains ? contains.slug : "";
}

export function parseOpenSourceComment(value: unknown): OpenSourceComment | null {
  const record = recordOf(value);
  const id = textOf(record.id) || textOf(record.commentId);
  if (!id) return null;
  const replies = Array.isArray(record.replies)
    ? record.replies
        .map((reply) => parseOpenSourceComment(reply))
        .filter((reply): reply is OpenSourceComment => reply !== null)
    : [];
  return {
    id,
    userId: textOf(record.userId),
    authorName: textOf(record.userDisplayName) || textOf(record.userName) || "若道用户",
    authorAvatarUrl: textOf(record.userAvatarUrl),
    body: typeof record.body === "string" ? record.body : "",
    owner: booleanOf(record.owner),
    parentCommentId: textOf(record.parentCommentId),
    replyToName: textOf(record.replyToUserDisplayName),
    replyCount: Math.max(0, Math.round(numberOf(record.replyCount, replies.length))),
    createdAt: textOf(record.createdAt),
    replies,
  };
}

export function parseOpenSourceCommentPage(
  value: unknown,
  fallback: { page: number; size: number },
): OpenSourceCommentPage {
  const record = recordOf(value);
  const items = Array.isArray(record.items)
    ? record.items
        .map((item) => parseOpenSourceComment(item))
        .filter((item): item is OpenSourceComment => item !== null)
    : [];
  return {
    items,
    total: Math.max(0, Math.round(numberOf(record.total, items.length))),
    page: positiveInt(record.page, fallback.page, 500),
    size: positiveInt(record.size, fallback.size, OPEN_SOURCE_MAX_PAGE_SIZE),
  };
}

/** 匿名访问返回 `data: null`，不视为错误。 */
export function parseOpenSourceIdentity(value: unknown): OpenSourceIdentity | null {
  const record = recordOf(value);
  const userId = textOf(record.userId) || textOf(record.sub);
  if (!userId) return null;
  return {
    userId,
    displayName: textOf(record.displayName) || textOf(record.nickname) || "若道用户",
    avatarUrl: textOf(record.avatarUrl),
    maskedEmail: textOf(record.maskedEmail),
  };
}

export function readCommentPage(value: unknown): { page: number; size: number } {
  const record = recordOf(value);
  return {
    page: positiveInt(record.page, 1, 500),
    size: positiveInt(record.size, OPEN_SOURCE_PAGE_SIZE, OPEN_SOURCE_MAX_PAGE_SIZE),
  };
}

/** 按文档约束校验提交内容：必填、最长 1000 字。 */
export function sanitizeCommentInput(input: unknown, field: "body" = "body"): {
  body: string;
  parentCommentId: string;
} {
  const record = recordOf(input);
  const body = String(record[field] ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) throw apiError("评论内容不能为空。", 400, "empty-comment");
  if (body.length > OPEN_SOURCE_COMMENT_LIMIT) {
    throw apiError(`评论最多 ${OPEN_SOURCE_COMMENT_LIMIT} 字，请精简后再发布。`, 400, "comment-too-long");
  }
  const parentCommentId = textOf(record.parentCommentId);
  return { body, parentCommentId };
}

export function readCommentId(input: unknown): string {
  const record = recordOf(input);
  const id = textOf(record.commentId) || textOf(record.id);
  if (!id) throw apiError("缺少评论标识，无法删除。", 400, "missing-comment-id");
  return id;
}

/**
 * 把 HTTP 状态码与错误体翻译成用户看得懂的提示。
 *
 * 文档约定：401 未登录 / 令牌失效，403 scope 不足，400 资源不存在、内容不合法。
 */
export function describeOpenSourceHttpError(
  status: number,
  data: unknown,
  fallback: string,
): OpenSourceApiError {
  const record = recordOf(recordOf(data).error ? recordOf(data).error : data);
  const serverMessage = textOf(record.message) || textOf(record.msg);
  const code = textOf(record.errorCode) || textOf(record.code);
  if (status === 401 || status === 403) {
    if (status === 403) {
      const missingScope = /scope/i.test(serverMessage) || code === "FORBIDDEN";
      return apiError(
        missingScope
          ? "当前若道账号没有「开源产品评论」权限（缺少 app:comments），请重新授权后再试。"
          : serverMessage || "当前若道账号没有执行该操作的权限。",
        status,
        "forbidden",
      );
    }
    return apiError("若道登录已过期，请重新登录后再试。", status, "unauthorized");
  }
  if (status === 400) {
    return apiError(serverMessage || "操作没有通过服务端校验，请检查内容后重试。", status, "bad-request");
  }
  if (status === 404) {
    return apiError("若道没有找到这个开源产品，可能尚未收录或已下架。", status, "not-found");
  }
  if (status === 429) {
    return apiError("操作太频繁了，请稍后再试。", status, "rate-limited");
  }
  if (status >= 500) {
    return apiError("若道服务暂时不可用，请稍后再试。", status, "server-error");
  }
  return apiError(serverMessage || fallback, status, code || "open-source-error");
}

/** 只允许 http/https 外链，避免把 `javascript:` 之类的地址交给系统打开。 */
export function isSafeExternalUrl(value: unknown): boolean {
  const raw = textOf(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
