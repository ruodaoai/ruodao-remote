/**
 * 若道开源社区对接（《开源产品接入若道社区标准》v1.0）。
 *
 * 与旧版插件市场评论的区别：
 * - 数据源改为公开接口 `/api/public/apps/{slug}` 与 `/api/public/apps/{slug}/comments`；
 * - 评论只有一份，客户端内看到的就是 ruodao.com/open-source/{slug} 下的同一条流；
 * - 互动信息（评论数、点赞数、版本、更新时间）来自产品详情接口；
 * - 身份统一走若道账号令牌，匿名读取不需要登录。
 */

import { ipcMain, shell } from "electron";
import {
  acquireAssistantLease,
  assistantApiBase,
  peekAssistantLease,
} from "./assistant";
import {
  describeOpenSourceHttpError,
  isSafeExternalUrl,
  parseOpenSourceCommentPage,
  parseOpenSourceIdentity,
  parseOpenSourceProduct,
  pickOpenSourceSlug,
  readCommentId,
  readCommentPage,
  sanitizeCommentInput,
  type OpenSourceCommentPage,
  type OpenSourceIdentity,
  type OpenSourceProduct,
} from "./open-source-protocol";
import { unwrapApiPayload } from "./assistant-protocol";

const API_BASE = assistantApiBase().replace(/\/+$/, "");
const SLUG = process.env.RUODAO_OPEN_SOURCE_SLUG?.trim() || "ruodao-remote";
const HTTP_TIMEOUT_MS = 20_000;
const PRODUCT_TTL_MS = 60_000;
const CATALOG_PAGE_SIZE = 100;

interface RawResponse {
  status: number;
  data: unknown;
}

interface ProductCache {
  slug: string;
  product: OpenSourceProduct;
  fetchedAt: number;
}

export interface OpenSourceThread extends OpenSourceCommentPage {
  product: OpenSourceProduct;
  identity: OpenSourceIdentity | null;
  signedIn: boolean;
}

let cache: ProductCache | null = null;
let inflight: Promise<ProductCache> | null = null;

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ok(result: RawResponse): boolean {
  return result.status >= 200 && result.status < 300;
}

async function httpJson(
  pathname: string,
  options: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1_000, options.timeoutMs ?? HTTP_TIMEOUT_MS),
  );
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-ruodao-client": "desktop",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接若道服务超时，请检查网络后重试。");
    }
    throw new Error("无法连接若道服务，请检查网络后重试。");
  } finally {
    clearTimeout(timer);
  }
}

function productPath(slug: string): string {
  return `/api/public/apps/${encodeURIComponent(slug)}`;
}

function commentPath(slug: string): string {
  return `/api/public/apps/${encodeURIComponent(slug)}/comments`;
}

/** 按文档要求：域名不写死，社交地址优先用详情接口返回值。 */
function absolute(value: string): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

async function fetchProductBySlug(slug: string): Promise<OpenSourceProduct | null> {
  const result = await httpJson(productPath(slug));
  if (!ok(result)) return null;
  try {
    return parseOpenSourceProduct(unwrapApiPayload(result.data), API_BASE);
  } catch {
    return null;
  }
}

/** 产品可能改过 slug，退化为目录检索，避免客户端直接报“找不到”。 */
async function discoverSlug(): Promise<string> {
  const params = new URLSearchParams({
    openSource: "true",
    page: "1",
    size: String(CATALOG_PAGE_SIZE),
  });
  const result = await httpJson(`/api/public/apps?${params.toString()}`);
  if (!ok(result)) return "";
  const payload = recordOf(unwrapApiPayload(result.data));
  return pickOpenSourceSlug(payload.items, SLUG);
}

async function resolveProduct(force = false): Promise<ProductCache> {
  if (!force && cache && Date.now() - cache.fetchedAt < PRODUCT_TTL_MS) return cache;
  if (!force && inflight) return inflight;
  const task = (async (): Promise<ProductCache> => {
    const direct = await fetchProductBySlug(SLUG);
    if (direct && direct.communityApiUrl) {
      return { slug: SLUG, product: direct, fetchedAt: Date.now() };
    }
    const discovered = await discoverSlug();
    if (discovered && discovered !== SLUG) {
      const fallback = await fetchProductBySlug(discovered);
      if (fallback) return { slug: discovered, product: fallback, fetchedAt: Date.now() };
    }
    if (direct) return { slug: SLUG, product: direct, fetchedAt: Date.now() };
    throw new Error(
      `若道还没有收录「${SLUG}」这个开源产品。请先在 ruodao.com/ai-apps/new?openSource=1 发布，或稍后再试。`,
    );
  })();
  inflight = task;
  try {
    const next = await task;
    cache = next;
    return next;
  } finally {
    inflight = null;
  }
}

async function loadIdentity(token?: string): Promise<OpenSourceIdentity | null> {
  if (!token) return null;
  try {
    const result = await httpJson("/api/public/apps/me", { token });
    if (!ok(result)) return null;
    return parseOpenSourceIdentity(unwrapApiPayload(result.data));
  } catch {
    return null;
  }
}

async function loadThread(input: unknown): Promise<OpenSourceThread> {
  const { page, size } = readCommentPage(input);
  const resolved = await resolveProduct(false);
  const lease = peekAssistantLease();
  const query = new URLSearchParams({ page: String(page), size: String(size) }).toString();
  const url = `${commentPath(resolved.slug)}?${query}`;
  let identity = await loadIdentity(lease?.token);
  let result = await httpJson(url, { token: lease?.token });
  // 令牌被服务端吊销时，读公开评论不应该一起失败：退回匿名再试一次。
  if (lease && (result.status === 401 || result.status === 403)) {
    identity = null;
    result = await httpJson(url);
  }
  if (!ok(result)) {
    throw describeOpenSourceHttpError(result.status, result.data, "读取若道社区评论失败，请稍后再试。");
  }
  const comments = parseOpenSourceCommentPage(unwrapApiPayload(result.data), { page, size });
  return {
    ...comments,
    product: resolved.product,
    identity,
    signedIn: Boolean(lease),
  };
}

async function submitComment(input: unknown): Promise<OpenSourceThread> {
  const { body, parentCommentId } = sanitizeCommentInput(input);
  const resolved = await resolveProduct(false);
  const lease = await acquireAssistantLease("请先用若道账号登录，再发表评论。");
  const payload: Record<string, unknown> = { body };
  if (parentCommentId) payload.parentCommentId = parentCommentId;
  const result = await httpJson(commentPath(resolved.slug), {
    method: "POST",
    token: lease.token,
    body: payload,
  });
  if (!ok(result)) {
    throw describeOpenSourceHttpError(result.status, result.data, "评论发布失败，请稍后再试。");
  }
  // 评论数与列表都会变化，详情走强制刷新，列表回到第一页。
  await resolveProduct(true);
  return loadThread({ page: 1 });
}

async function deleteComment(input: unknown): Promise<OpenSourceThread> {
  const commentId = readCommentId(input);
  const resolved = await resolveProduct(false);
  const lease = await acquireAssistantLease("请先用若道账号登录，再删除评论。");
  const result = await httpJson(
    `/api/public/apps/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE", token: lease.token },
  );
  if (!ok(result)) {
    throw describeOpenSourceHttpError(result.status, result.data, "删除评论失败，请稍后再试。");
  }
  await resolveProduct(true);
  return loadThread({ page: 1 });
}

/** 互动信息里的按钮：讨论页、代码仓库、下载、接入文档。 */
async function openTarget(input: unknown): Promise<{ ok: true; url: string }> {
  const record = recordOf(input);
  const target = String(record.target ?? "").trim();
  const explicit = String(record.url ?? "").trim();
  let url = explicit;
  if (!url) {
    const resolved = await resolveProduct(false).catch(() => null);
    const product = resolved?.product;
    if (target === "community") url = product?.communityUrl ?? absolute("/open-source");
    else if (target === "repository") url = product?.repositoryUrl ?? "";
    else if (target === "download") url = product?.downloadUrl ?? "";
    else if (target === "docs") url = product?.integrationDocUrl ?? absolute("/open-source/docs");
    else if (target === "catalog") url = absolute("/open-source");
  }
  if (!isSafeExternalUrl(url)) throw new Error("链接地址不合法，已取消打开。");
  await shell.openExternal(url);
  return { ok: true, url };
}

let registered = false;

export function registerOpenSourceIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("open-source:thread", (_event, input: unknown) => loadThread(input));
  ipcMain.handle("open-source:submit", (_event, input: unknown) => submitComment(input));
  ipcMain.handle("open-source:delete", (_event, input: unknown) => deleteComment(input));
  ipcMain.handle("open-source:open", (_event, input: unknown) => openTarget(input));
}
