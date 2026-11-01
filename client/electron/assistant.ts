import { ipcMain, shell } from "electron";
import {
  buildAssistantMessages,
  collectTextModels,
  describeHttpError,
  modelAcceptsImages,
  normalizeAssistantBaseUrl,
  parseChatResponse,
  parseLoginResponse,
  sanitizeImageDataUrls,
  tokenExpired,
  tokenNeedsRefresh,
  unwrapApiPayload,
  type AssistantApiError,
  type AssistantChatTurn,
  type AssistantModel,
  type AssistantUser,
  type ChatReply,
} from "./assistant-protocol";
import {
  assistantPersistAvailable,
  clearAssistantAuth,
  loadAssistantAuth,
  saveAssistantAuth,
} from "./assistant-store";

const API_BASE = normalizeAssistantBaseUrl(
  process.env.RUODAO_API_BASE_URL?.trim() ||
    (process.env.RUODAO_LOCAL_TEST === "1" ? "http://127.0.0.1:8080" : "https://ruodao.com"),
);
export function assistantApiBase(): string {
  return API_BASE;
}

const HTTP_TIMEOUT_MS = 25_000;
const CHAT_TIMEOUT_MS = 120_000;
const ACCOUNT_PATHS: Record<string, string> = {
  login: "/login",
  register: "/register",
  models: "/models",
  usage: "/usage",
};

interface Session {
  email: string;
  token: string;
  user: AssistantUser | null;
  model: string;
  expired: boolean;
}

export interface AssistantStatus {
  authenticated: boolean;
  sessionExpired: boolean;
  email: string;
  user: AssistantUser | null;
  models: AssistantModel[];
  defaultModel: string;
  model: string;
  modelsError: string | null;
  persistAvailable: boolean;
  apiBaseUrl: string;
}

let loaded = false;
let session: Session | null = null;
let models: AssistantModel[] = [];
let defaultModel = "";
let modelsError: string | null = null;
let modelsLoaded = false;
let modelsLoading: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "AI 助手暂时不可用，请稍后再试。";
}

function authError(message = "若道登录已过期，请重新登录。", status = 401): AssistantApiError {
  const error = new Error(message) as AssistantApiError;
  error.status = status;
  error.code = "unauthorized";
  return error;
}

function isAuthError(error: unknown): boolean {
  return (error as AssistantApiError | undefined)?.status === 401;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const auth = loadAssistantAuth(API_BASE);
  if (auth) {
    session = {
      email: auth.email,
      token: auth.token,
      user: auth.user,
      model: auth.model,
      expired: tokenExpired(auth.token),
    };
  }
}

function markExpired(): void {
  if (session) session.expired = true;
  models = [];
  defaultModel = "";
  modelsLoaded = false;
  modelsError = null;
}

function persistSession(): void {
  if (!session) return;
  saveAssistantAuth(API_BASE, {
    email: session.email,
    token: session.token,
    user: session.user,
    model: session.model,
  });
}

interface RawResponse {
  status: number;
  data: unknown;
}

async function httpJson(
  pathname: string,
  options: { method?: string; token?: string; body?: unknown; timeoutMs?: number },
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
      redirect: "error",
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

async function refreshModels(): Promise<void> {
  if (!session || session.expired) return;
  if (modelsLoaded) return;
  if (modelsLoading) return modelsLoading;
  const token = session.token;
  modelsLoading = (async () => {
    const results = await Promise.allSettled([
      httpJson("/api/model-configs", { token }),
      httpJson("/api/model-catalog", { token }),
    ]);
    const firstAuthFailure = results.find(
      (result) => result.status === "fulfilled" && result.value.status === 401,
    );
    if (firstAuthFailure) throw authError();

    const failures: string[] = [];
    const payloadFor = (index: number): unknown => {
      const result = results[index];
      if (result.status === "rejected") {
        failures.push(errorMessage(result.reason));
        return [];
      }
      if (result.value.status < 200 || result.value.status >= 300) {
        failures.push(
          describeHttpError(result.value.status, result.value.data, "读取模型列表失败。").message,
        );
        return [];
      }
      try {
        return unwrapApiPayload(result.value.data);
      } catch (error) {
        failures.push(errorMessage(error));
        return [];
      }
    };
    const configs = payloadFor(0);
    const catalog = payloadFor(1);
    if (failures.length === results.length) throw new Error(failures[0]);

    const collected = collectTextModels(configs, catalog);
    models = collected.models;
    defaultModel = collected.defaultModel;
    modelsLoaded = true;
    modelsError =
      models.length === 0
        ? "若道账号下没有可用于问答的文本模型，请先在若道「我的模型」中添加，再回来刷新。"
        : failures[0] ?? null;
  })()
    .catch((error) => {
      models = [];
      defaultModel = "";
      modelsError = errorMessage(error);
      if (isAuthError(error)) markExpired();
      throw error;
    })
    .finally(() => {
      modelsLoading = null;
    });
  return modelsLoading;
}

async function refreshSession(force = false): Promise<void> {
  if (!session || session.expired) throw authError();
  if (!force && !tokenNeedsRefresh(session.token)) return;
  const result = await httpJson("/api/auth/refresh", {
    method: "POST",
    token: session.token,
  });
  if (result.status < 200 || result.status >= 300) {
    markExpired();
    throw authError();
  }
  try {
    const auth = parseLoginResponse(result.data);
    session = {
      email: session.email || auth.user.email,
      token: auth.token,
      user: auth.user,
      model: session.model,
      expired: false,
    };
    persistSession();
  } catch {
    markExpired();
    throw authError();
  }
}

function currentStatus(): AssistantStatus {
  const active = Boolean(session && !session.expired);
  const selected =
    session?.model && models.some((model) => model.modelName === session?.model)
      ? session.model
      : defaultModel;
  return {
    authenticated: active,
    sessionExpired: Boolean(session?.expired),
    email: session?.email ?? session?.user?.email ?? "",
    user: session?.user ?? null,
    models,
    defaultModel,
    model: selected,
    modelsError: active ? modelsError : null,
    persistAvailable: assistantPersistAvailable(),
    apiBaseUrl: API_BASE,
  };
}

async function status(): Promise<AssistantStatus> {
  ensureLoaded();
  if (session && !session.expired) {
    try {
      await refreshModels();
    } catch {
      // Status still returns the account plus a readable modelsError.
    }
  }
  return currentStatus();
}

export interface AssistantLease {
  token: string;
  email: string;
  userId: string;
}

function leaseOf(active: Session): AssistantLease {
  return {
    token: active.token,
    email: active.email,
    userId: active.user?.id ?? "",
  };
}

/** 只读取当前会话，不触发网络请求；用于可选登录的公开接口。 */
export function peekAssistantLease(): AssistantLease | null {
  ensureLoaded();
  if (!session || session.expired) return null;
  return leaseOf(session);
}

/** 需要登录的接口使用：必要时先刷新令牌。 */
export async function acquireAssistantLease(
  message = "请先登录若道账号后再留言。",
): Promise<AssistantLease> {
  ensureLoaded();
  if (!session || session.expired) throw authError(message);
  if (tokenNeedsRefresh(session.token)) {
    try {
      await refreshSession(true);
    } catch {
      throw authError(message);
    }
  }
  if (!session || session.expired) throw authError(message);
  return leaseOf(session);
}

/** 接口返回 401 时强制换一次令牌，避免沿用已失效的会话。 */
export async function forceRefreshAssistantLease(
  message = "若道登录已过期，请重新登录后再留言。",
): Promise<AssistantLease> {
  ensureLoaded();
  if (!session || session.expired) throw authError(message);
  try {
    await refreshSession(true);
  } catch {
    throw authError(message);
  }
  if (!session || session.expired) throw authError(message);
  return leaseOf(session);
}

async function login(input: unknown): Promise<AssistantStatus> {
  ensureLoaded();
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请输入有效的邮箱地址。");
  if (!password) throw new Error("请输入若道账号密码。");
  if (password.length > 256) throw new Error("密码过长。");

  const result = await httpJson("/api/auth/login", {
    method: "POST",
    body: { email, password },
    timeoutMs: 30_000,
  });
  if (result.status < 200 || result.status >= 300) {
    const error = describeHttpError(result.status, result.data, "登录失败，请检查邮箱与密码。");
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      error.message = "邮箱或密码不正确。";
    }
    throw error;
  }
  let auth: { token: string; user: AssistantUser };
  try {
    auth = parseLoginResponse(result.data);
  } catch (error) {
    throw new Error(errorMessage(error) || "登录响应格式不正确。");
  }
  session = {
    email: auth.user.email || email,
    token: auth.token,
    user: auth.user,
    model: "",
    expired: false,
  };
  models = [];
  defaultModel = "";
  modelsLoaded = false;
  modelsError = null;
  persistSession();
  try {
    await refreshModels();
  } catch {
    // A model list failure should not turn a successful login into an error.
  }
  return currentStatus();
}

async function logout(): Promise<{ ok: true }> {
  session = null;
  models = [];
  defaultModel = "";
  modelsLoaded = false;
  modelsError = null;
  clearAssistantAuth();
  return { ok: true };
}

async function chat(input: unknown): Promise<ChatReply> {
  ensureLoaded();
  if (!session || session.expired) throw authError("请先登录若道账号，再使用 AI 助手。");
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const question = String(raw.question ?? "");
  const context = String(raw.context ?? "");
  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const images = sanitizeImageDataUrls(rawImages);
  if (rawImages.length > 0 && images.length === 0) {
    throw new Error("图片格式不受支持或文件过大，请使用 PNG、JPG 或 WebP 图片。");
  }
  const history: AssistantChatTurn[] = Array.isArray(raw.history)
    ? raw.history
        .map((turn) => {
          const record =
            typeof turn === "object" && turn !== null ? (turn as Record<string, unknown>) : {};
          return {
            role: record.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(record.content ?? ""),
          };
        })
        .filter((turn) => turn.content.trim())
    : [];
  const messages = buildAssistantMessages(question, history, context, images);

  if (!modelsLoaded) {
    try {
      await refreshModels();
    } catch (error) {
      throw new Error(modelsError || errorMessage(error));
    }
  }
  if (models.length === 0) {
    throw new Error(
      modelsError ||
        "当前若道账号下没有可用的文本模型，请先在若道「我的模型」中添加文本模型。",
    );
  }
  const requested = String(raw.model ?? "").trim();
  const selected =
    models.find((model) => model.modelName === requested)?.modelName ||
    models.find((model) => model.modelName === defaultModel)?.modelName ||
    models[0].modelName;
  if (images.length > 0 && !modelAcceptsImages(models.find((item) => item.modelName === selected))) {
    throw new Error("当前模型不支持图片输入，请先切换到支持图片的模型。");
  }

  const body = {
    model: selected,
    messages,
    temperature: 0.3,
    maxTokens: 1400,
  };

  const send = async (token: string): Promise<RawResponse> =>
    httpJson("/api/desktop-agent/llm/chat/completions", {
      method: "POST",
      token,
      body,
      timeoutMs: CHAT_TIMEOUT_MS,
    });

  let result: RawResponse;
  try {
    if (tokenNeedsRefresh(session.token)) await refreshSession(true);
    result = await send(session.token);
    if (result.status === 401) {
      await refreshSession(true);
      result = await send(session.token);
    }
  } catch (error) {
    if (isAuthError(error)) {
      markExpired();
      throw authError();
    }
    throw new Error(errorMessage(error));
  }
  if (result.status < 200 || result.status >= 300) {
    throw describeHttpError(result.status, result.data, "AI 暂时没有返回结果，请稍后再试。");
  }
  const reply = parseChatResponse(result.data, selected);
  if (session) {
    session.model = reply.model || selected;
    persistSession();
  }
  return reply;
}

async function refreshModelList(): Promise<AssistantStatus> {
  ensureLoaded();
  modelsLoaded = false;
  modelsError = null;
  if (session && !session.expired) {
    try {
      await refreshModels();
    } catch {
      // The status exposes modelsError.
    }
  }
  return currentStatus();
}

async function openAccount(input: unknown): Promise<{ ok: true }> {
  const raw = typeof input === "string" ? input : "";
  const pathname = ACCOUNT_PATHS[raw];
  if (!pathname) throw new Error("账号页面参数不合法。");
  await shell.openExternal(`${API_BASE}${pathname}`);
  return { ok: true };
}

let registered = false;

export function registerAssistantIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("assistant:status", () => status());
  ipcMain.handle("assistant:login", (_event, input: unknown) => login(input));
  ipcMain.handle("assistant:logout", () => logout());
  ipcMain.handle("assistant:models", () => refreshModelList());
  ipcMain.handle("assistant:chat", (_event, input: unknown) => chat(input));
  ipcMain.handle("assistant:open-account", (_event, input: unknown) => openAccount(input));
}
