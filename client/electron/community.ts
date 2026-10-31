import { ipcMain, shell } from "electron";
import {
  acquireAssistantLease,
  assistantApiBase,
  forceRefreshAssistantLease,
  peekAssistantLease,
  type AssistantLease,
} from "./assistant";
import {
  COMMUNITY_PAGE_SIZE,
  communityAppList,
  communityNotFoundError,
  describeCommunityHttpError,
  parseCommunityApp,
  parseCommunityReview,
  parseCommunityThread,
  pickCommunityApp,
  readCommunityReviewId,
  sanitizeReviewInput,
  type CommunityApp,
  type CommunityReview,
  type CommunitySource,
  type CommunityThread,
} from "./community-protocol";
import { unwrapApiPayload } from "./assistant-protocol";

const API_BASE = assistantApiBase();
const APP_SLUG_OVERRIDE = process.env.RUODAO_COMMUNITY_APP_SLUG?.trim() ?? "";
const HTTP_TIMEOUT_MS = 20_000;
const DISCOVERY_PAGE_SIZE = 50;

interface RawResponse {
  status: number;
  data: unknown;
}

let cachedApp: CommunityApp | null = null;
let discovery: Promise<CommunityApp> | null = null;

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function apiBase(source: CommunitySource): string {
  return source === "ecosystem" ? "/api/ecosystem" : "/api/plugin-market";
}

function ok(result: RawResponse): boolean {
  return result.status >= 200 && result.status < 300;
}

function needsLogin(result: RawResponse): boolean {
  return result.status === 401 || (result.status >= 300 && result.status < 400);
}

async function httpJson(
  pathname: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
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

async function listApps(
  source: CommunitySource,
  options: { query?: string; token?: string; size?: number } = {},
): Promise<CommunityApp[]> {
  const params = new URLSearchParams({
    page: "1",
    size: String(options.size ?? DISCOVERY_PAGE_SIZE),
  });
  if (options.query) params.set("q", options.query);
  try {
    const result = await httpJson(`${apiBase(source)}/items?${params.toString()}`, {
      token: options.token,
    });
    if (!ok(result)) return [];
    return communityAppList(result.data, source);
  } catch {
    return [];
  }
}

async function listMine(
  source: CommunitySource,
  token: string,
): Promise<CommunityApp[]> {
  try {
    const result = await httpJson(`${apiBase(source)}/mine`, { token });
    if (!ok(result)) return [];
    return communityAppList(result.data, source);
  } catch {
    return [];
  }
}

async function fetchAppBySlug(slug: string): Promise<CommunityApp | null> {
  try {
    const result = await httpJson(
      `/api/plugin-market/items/${encodeURIComponent(slug)}`,
    );
    if (!ok(result)) return null;
    return parseCommunityApp(unwrapApiPayload(result.data), "plugin-market");
  } catch {
    return null;
  }
}

async function findPublicApp(): Promise<CommunityApp | null> {
  if (APP_SLUG_OVERRIDE) {
    const overridden = await fetchAppBySlug(APP_SLUG_OVERRIDE);
    if (overridden) return overridden;
  }
  const searches = ["若道远程控制", "若道远程", "若道"];
  for (const query of searches) {
    const apps = await listApps("plugin-market", { query });
    const picked = pickCommunityApp(apps);
    if (picked) return picked;
  }
  const listed = await listApps("plugin-market");
  return pickCommunityApp(listed);
}

async function findOwnedApp(lease: AssistantLease): Promise<CommunityApp | null> {
  const marketMine = await listMine("plugin-market", lease.token);
  const marketPicked = pickCommunityApp(marketMine);
  if (marketPicked) return marketPicked;

  const ecoMine = await listMine("ecosystem", lease.token);
  const ecoPicked = pickCommunityApp(ecoMine, "ecosystem");
  if (ecoPicked) return ecoPicked;

  const ecoList = await listApps("ecosystem", { token: lease.token });
  return pickCommunityApp(ecoList, "ecosystem");
}

async function discoverApp(): Promise<CommunityApp> {
  if (cachedApp) return cachedApp;
  if (discovery) return discovery;
  discovery = (async () => {
    const publicApp = await findPublicApp();
    if (publicApp) {
      cachedApp = publicApp;
      return publicApp;
    }
    const peeked = peekAssistantLease();
    if (peeked) {
      let lease = peeked;
      try {
        lease = await acquireAssistantLease();
      } catch {
        // A stale token can still fail later; public reads continue without it.
      }
      const owned = await findOwnedApp(lease);
      if (owned) {
        cachedApp = owned;
        return owned;
      }
    }
    throw communityNotFoundError();
  })();
  try {
    return await discovery;
  } finally {
    discovery = null;
  }
}

function reviewBase(app: CommunityApp): string {
  return `${apiBase(app.source)}/items/${encodeURIComponent(app.id)}`;
}

function reviewParams(page: number, size: number): string {
  return new URLSearchParams({
    page: String(page),
    size: String(size),
    sort: "latest",
  }).toString();
}

async function fetchReviews(
  app: CommunityApp,
  page: number,
  size: number,
  token?: string,
): Promise<RawResponse> {
  return httpJson(`${reviewBase(app)}/reviews?${reviewParams(page, size)}`, { token });
}

function readPage(input: unknown): number {
  const value = recordOf(input).page;
  const page = Math.round(Number(value));
  return Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1;
}

async function loadThread(input: unknown): Promise<CommunityThread> {
  const page = readPage(input);
  const app = await discoverApp();
  let lease = peekAssistantLease();
  let result = await fetchReviews(app, page, COMMUNITY_PAGE_SIZE, lease?.token);
  if (needsLogin(result) && lease) {
    try {
      lease = await forceRefreshAssistantLease();
      result = await fetchReviews(app, page, COMMUNITY_PAGE_SIZE, lease.token);
    } catch {
      lease = null;
      result = await fetchReviews(app, page, COMMUNITY_PAGE_SIZE);
    }
  }
  if (!ok(result)) {
    throw describeCommunityHttpError(result.status, result.data, "读取社区留言失败，请稍后再试。");
  }
  const current = peekAssistantLease();
  const isOwner = Boolean(
    current &&
      (app.submittedByMe ||
        (app.authorUserId && current.userId && app.authorUserId === current.userId)),
  );
  return parseCommunityThread(result.data, app, {
    page,
    size: COMMUNITY_PAGE_SIZE,
    signedIn: Boolean(current),
    isOwner,
  });
}

async function withAuthRetry(
  run: (token: string) => Promise<RawResponse>,
): Promise<RawResponse> {
  const lease = await acquireAssistantLease();
  let result = await run(lease.token);
  if (needsLogin(result)) {
    const next = await forceRefreshAssistantLease();
    result = await run(next.token);
  }
  return result;
}

async function submitReview(input: unknown): Promise<CommunityThread> {
  const { rating, content } = sanitizeReviewInput(input);
  const app = await discoverApp();
  const result = await withAuthRetry((token) =>
    httpJson(`${reviewBase(app)}/reviews`, {
      method: "PUT",
      token,
      body: { rating, content },
    }),
  );
  if (!ok(result)) {
    throw describeCommunityHttpError(result.status, result.data, "留言发布失败，请稍后再试。");
  }
  return loadThread({ page: 1 });
}

async function markHelpful(
  input: unknown,
): Promise<{ review: CommunityReview | null }> {
  const reviewId = readCommunityReviewId(input);
  const app = await discoverApp();
  const result = await withAuthRetry((token) =>
    httpJson(`${apiBase(app.source)}/reviews/${encodeURIComponent(reviewId)}/helpful`, {
      method: "POST",
      token,
    }),
  );
  if (!ok(result)) {
    throw describeCommunityHttpError(result.status, result.data, "标记失败，请稍后再试。");
  }
  const payload = unwrapApiPayload(result.data);
  return { review: parseCommunityReview(recordOf(payload).review ?? payload) };
}

async function deleteReview(input: unknown): Promise<CommunityThread> {
  const reviewId = readCommunityReviewId(input);
  const app = await discoverApp();
  const result = await withAuthRetry((token) =>
    httpJson(`${apiBase(app.source)}/reviews/${encodeURIComponent(reviewId)}`, {
      method: "DELETE",
      token,
    }),
  );
  if (!ok(result)) {
    throw describeCommunityHttpError(result.status, result.data, "删除留言失败，请稍后再试。");
  }
  return loadThread({ page: 1 });
}

async function openApp(): Promise<{ ok: true }> {
  const app = await discoverApp().catch(() => null);
  await shell.openExternal(`${API_BASE}${app?.pagePath ?? "/plugin-market"}`);
  return { ok: true };
}

async function openMarket(): Promise<{ ok: true }> {
  await shell.openExternal(`${API_BASE}/plugin-market`);
  return { ok: true };
}

let registered = false;

export function registerCommunityIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("community:thread", (_event, input: unknown) => loadThread(input));
  ipcMain.handle("community:submit", (_event, input: unknown) => submitReview(input));
  ipcMain.handle("community:helpful", (_event, input: unknown) => markHelpful(input));
  ipcMain.handle("community:delete", (_event, input: unknown) => deleteReview(input));
  ipcMain.handle("community:open-app", () => openApp());
  ipcMain.handle("community:open-market", () => openMarket());
}
