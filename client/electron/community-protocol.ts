/** 若道插件市场评论区的纯协议层：不依赖 Electron，便于单元测试。 */

import { unwrapApiPayload } from "./assistant-protocol";

export const COMMUNITY_APP_NAME = "若道远程控制";
export const COMMUNITY_APP_ALIASES = [
  "若道远程控制",
  "若道远程",
  "若道远控",
  "ruodao remote control",
  "ruodao remote",
  "ruodao-remote",
  "ruodao-remote-control",
];
export const COMMUNITY_PAGE_SIZE = 8;
export const COMMUNITY_CONTENT_LIMIT = 1000;
export const COMMUNITY_NOT_FOUND_MESSAGE =
  "没有找到「若道远程控制」的评论区。应用可能尚未在若道插件市场上架，或需要使用作者账号登录后查看。发布后点“刷新”再试。";

export type CommunitySource = "plugin-market" | "ecosystem";

export interface CommunityApp {
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl: string;
  pagePath: string;
  source: CommunitySource;
  authorUserId: string;
  submittedByMe: boolean;
}

export interface CommunityReply {
  content: string;
  createdAt: string;
}

export interface CommunityReview {
  id: string;
  rating: number;
  content: string;
  userLabel: string;
  userAvatarUrl: string;
  verified: boolean;
  createdAt: string;
  helpful: boolean;
  helpfulCount: number;
  authorReply: CommunityReply | null;
  mine: boolean;
}

export interface CommunitySummary {
  ratingAvg: number;
  ratingCount: number;
  distribution: number[];
  tipCount: number;
  tipTotal: number;
}

export interface CommunityThread {
  app: CommunityApp;
  summary: CommunitySummary;
  items: CommunityReview[];
  myReview: CommunityReview | null;
  total: number;
  page: number;
  size: number;
  signedIn: boolean;
  isOwner: boolean;
}

export interface CommunityApiError extends Error {
  status: number;
  code: string;
}

function apiError(message: string, status = 0, code = "community-error"): CommunityApiError {
  const error = new Error(message) as CommunityApiError;
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

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.round(numberOf(value, fallback));
  return parsed >= 1 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCommunityName(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\u3000·・\-_/\\|（）()【】\[\]「」:：,，.。!！?？]+/g, "");
}

export function parseCommunityApp(
  value: unknown,
  source: CommunitySource = "plugin-market",
): CommunityApp | null {
  const record = recordOf(value);
  const id = textOf(record.id) || textOf(record.itemId);
  const slug = textOf(record.slug) || id;
  if (!id && !slug) return null;
  const name =
    textOf(record.displayName) ||
    textOf(record.name) ||
    textOf(record.title) ||
    COMMUNITY_APP_NAME;
  return {
    id: id || slug,
    slug,
    name,
    summary: textOf(record.summary) || textOf(record.description),
    iconUrl: textOf(record.iconUrl),
    pagePath:
      source === "ecosystem"
        ? `/ecosystem/items/${encodeURIComponent(slug)}`
        : `/plugin-market/items/${encodeURIComponent(slug)}`,
    source,
    authorUserId:
      textOf(record.authorUserId) ||
      textOf(record.ownerUserId) ||
      textOf(record.creatorUserId),
    submittedByMe: record.submittedByMe === true,
  };
}

export function communityAppList(
  payload: unknown,
  source: CommunitySource = "plugin-market",
): CommunityApp[] {
  const value = unwrapApiPayload(payload);
  const record = recordOf(value);
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.apps)
        ? record.apps
        : Array.isArray(record.list)
          ? record.list
          : [];
  return raw
    .map((item) => parseCommunityApp(item, source))
    .filter((item): item is CommunityApp => item !== null);
}

/** 从列表里挑出「若道远程控制」；只认品牌相关名称，避免误选其他若道插件。 */
export function pickCommunityApp(
  items: unknown[],
  source: CommunitySource = "plugin-market",
  aliases: string[] = COMMUNITY_APP_ALIASES,
): CommunityApp | null {
  const wanted = aliases.map((alias) => normalizeCommunityName(alias)).filter(Boolean);
  if (wanted.length === 0) return null;
  let best: { app: CommunityApp; score: number } | null = null;
  for (const raw of items) {
    const app = parseCommunityApp(raw, source);
    if (!app) continue;
    const name = normalizeCommunityName(app.name);
    const slug = normalizeCommunityName(app.slug);
    let score = 0;
    for (const alias of wanted) {
      if (name === alias || slug === alias) score = Math.max(score, 100);
      else if (name.includes(alias) || (alias.length >= 5 && alias.includes(name))) {
        score = Math.max(score, 60 + alias.length);
      } else if (slug.includes(alias)) {
        score = Math.max(score, 40 + alias.length);
      }
    }
    if (score > (best?.score ?? 0)) best = { app, score };
  }
  return best?.app ?? null;
}

function parseReply(value: unknown): CommunityReply | null {
  if (typeof value === "string") {
    const content = value.trim();
    return content ? { content, createdAt: "" } : null;
  }
  const record = recordOf(value);
  const content = textOf(record.content) || textOf(record.reply) || textOf(record.text);
  return content ? { content, createdAt: textOf(record.createdAt) } : null;
}

export function parseCommunityReview(value: unknown): CommunityReview | null {
  const record = recordOf(value);
  const id = textOf(record.id) || textOf(record.reviewId);
  if (!id) return null;
  const rawRating = numberOf(record.rating);
  const numericHelpful = typeof record.helpful === "number" ? Math.round(record.helpful) : 0;
  return {
    id,
    rating: rawRating > 0 ? clamp(Math.round(rawRating), 1, 5) : 0,
    content: textOf(record.content).slice(0, COMMUNITY_CONTENT_LIMIT),
    userLabel:
      textOf(record.userLabel) ||
      textOf(record.displayName) ||
      textOf(record.userName) ||
      "若道用户",
    userAvatarUrl: textOf(record.userAvatarUrl) || textOf(record.avatarUrl),
    verified: record.verified === true,
    createdAt: textOf(record.createdAt),
    helpful: record.helpful === true,
    helpfulCount: Math.max(
      0,
      Math.round(numberOf(record.helpfulCount, numericHelpful)),
    ),
    authorReply: parseReply(record.authorReply),
    mine: record.mine === true,
  };
}

export function parseCommunitySummary(payload: unknown): CommunitySummary {
  const data = recordOf(unwrapApiPayload(payload));
  const raw = Array.isArray(data.distribution) ? data.distribution : [];
  return {
    ratingAvg: clamp(numberOf(data.ratingAvg), 0, 5),
    ratingCount: Math.max(0, Math.round(numberOf(data.ratingCount))),
    distribution: Array.from({ length: 5 }, (_, index) =>
      Math.max(0, Math.round(numberOf(raw[index]))),
    ),
    tipCount: Math.max(0, Math.round(numberOf(data.tipCount))),
    tipTotal: Math.max(0, numberOf(data.tipTotal)),
  };
}

export function parseCommunityThread(
  payload: unknown,
  app: CommunityApp,
  options: { page: number; size: number; signedIn: boolean; isOwner: boolean },
): CommunityThread {
  const data = recordOf(unwrapApiPayload(payload));
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const myReview = parseCommunityReview(data.myReview);
  const seen = new Set<string>();
  const items: CommunityReview[] = [];
  for (const raw of rawItems) {
    const review = parseCommunityReview(raw);
    if (!review || review.mine) continue;
    if (myReview && review.id === myReview.id) continue;
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    items.push(review);
  }
  return {
    app,
    summary: parseCommunitySummary(data),
    items,
    myReview,
    total: Math.max(0, Math.round(numberOf(data.total, items.length))),
    page: positiveInt(data.page, options.page),
    size: positiveInt(data.size, options.size),
    signedIn: options.signedIn,
    isOwner: options.isOwner,
  };
}

export function sanitizeReviewInput(input: unknown): { rating: number; content: string } {
  const record = recordOf(input);
  const rating = Number(record.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw apiError("请先选择 1–5 星评分。", 400, "invalid-rating");
  }
  const content = String(record.content ?? "")
    .replace(/\u0000/g, "")
    .trim();
  if (content.length > COMMUNITY_CONTENT_LIMIT) {
    throw apiError(`留言最多 ${COMMUNITY_CONTENT_LIMIT} 字，请精简后再发布。`, 400, "too-long");
  }
  return { rating, content };
}

export function readCommunityReviewId(input: unknown): string {
  const value =
    typeof input === "string" ? input : textOf(recordOf(input).reviewId);
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(value)) {
    throw apiError("留言标识不合法，请刷新后再试。", 400, "invalid-review-id");
  }
  return value;
}

function readableServerMessage(value: unknown): string {
  const text = textOf(value).replace(/\s+/g, " ");
  if (!text || /^(internal (server )?error|error|forbidden|unauthorized)$/i.test(text)) {
    return "";
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function describeCommunityHttpError(
  status: number,
  payload: unknown,
  fallback: string,
): CommunityApiError {
  const message = readableServerMessage(recordOf(payload).message);
  if (status === 401) {
    return apiError("若道登录已过期，请重新登录后再留言。", 401, "unauthorized");
  }
  if (status === 403) {
    if (/own|自己|作者/.test(message)) {
      return apiError(message, 403, "forbidden");
    }
    return apiError(message || "没有权限执行该操作。应用作者不能给自己的应用留言。", 403, "forbidden");
  }
  if (status === 404) {
    return apiError(message || "应用或留言不存在，可能已被删除。", 404, "not-found");
  }
  if (status === 409) {
    return apiError(message || "操作冲突，请刷新后再试。", 409, "conflict");
  }
  if (status === 429) {
    return apiError("操作过于频繁，请稍后再试。", 429, "rate-limited");
  }
  if (status >= 500) {
    return apiError(
      message ? `若道服务返回错误：${message}` : "若道服务暂时不可用，请稍后再试。",
      status,
      "server-error",
    );
  }
  return apiError(message || fallback, status, "http-error");
}

export function communityNotFoundError(): CommunityApiError {
  return apiError(COMMUNITY_NOT_FOUND_MESSAGE, 404, "app-not-found");
}
