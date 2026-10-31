/** 若道账号与 AI 助手的纯协议层：不依赖 Electron，便于单元测试。 */

export interface AssistantUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: string;
}

export interface AssistantModel {
  id: string;
  label: string;
  modelName: string;
  modelConfigId: string;
  inputTypes: string[];
}

export interface AssistantChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const ASSISTANT_CONTEXT_LIMIT = 6000;
export const ASSISTANT_QUESTION_LIMIT = 2000;
export const ASSISTANT_HISTORY_LIMIT = 8;
export const ASSISTANT_HISTORY_ITEM_LIMIT = 3000;
export const ASSISTANT_MODEL_LIMIT = 30;
export const ASSISTANT_IMAGE_LIMIT = 3;
export const ASSISTANT_IMAGE_DATA_URL_LIMIT = 4_000_000;

const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export const ASSISTANT_SYSTEM_PROMPT = `你是「若道远程」的安装与使用助手。若道远程是一个免注册的桌面远控工具：被控端在「本机被控」页生成 9 位远控码和 10 位访问密钥，控制端输入这两项后，通过自建信令服务器建立 WebRTC 加密连接；服务器管理员可以管理已接入客户端、邀请码和远程会话；客户端支持在 Linux 云服务器上一键部署服务端（Node.js + Caddy + TURN），也支持在本机启动服务端。

你的任务：根据用户的问题、附带的运行状态和截图，判断最可能的问题，给出可以照着操作的解决步骤。

要求：
- 用简体中文回答，先给结论，再给 1-4 个按顺序的步骤；必要时说明如何验证是否解决。
- 只讨论若道远程的安装、配置、连接、部署、安全与使用；与产品无关的话题礼貌拒绝。
- 绝不索取密码、访问密钥、远控码、邀请码、SSH 私钥或若道登录令牌；如果用户主动粘贴了这类信息，提醒其尽快更换。
- 用户可能发送界面截图。只根据图中确实可见的内容分析，不要编造截图中不存在的按钮或报错；如果图片看不清，说明需要哪部分信息，并提醒用户遮挡图中的密码、密钥、验证码等敏感内容。
- 不要编造界面中不存在的按钮。不确定时明确说明，并建议查看「使用指南」或补充所需信息。
- 涉及删除服务器数据、开放公网、修改防火墙等高风险操作时，提醒用户先确认影响。
- 回答尽量控制在 400 字以内，避免重复用户已经知道的信息。`;

export interface AssistantApiError extends Error {
  status: number;
  code: string;
}

function apiError(message: string, status = 0, code = "assistant-error"): AssistantApiError {
  const error = new Error(message) as AssistantApiError;
  error.status = status;
  error.code = code;
  return error;
}

export function normalizeAssistantBaseUrl(input: string | undefined | null): string {
  const fallback = "https://ruodao.com";
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return fallback;
    if (url.username || url.password || url.search || url.hash) return fallback;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return fallback;
  }
}

export function jwtExpiresAt(token: string): number | null {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    const exp = Number(payload.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function tokenNeedsRefresh(token: string, safetyMs = 120_000): boolean {
  const expiresAt = jwtExpiresAt(token);
  return expiresAt !== null && expiresAt - Date.now() <= safetyMs;
}

export function tokenExpired(token: string): boolean {
  const expiresAt = jwtExpiresAt(token);
  return expiresAt !== null && expiresAt <= Date.now();
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 若道接口统一包一层 { success, data, message }；聊天接口则直接返回结果。 */
export function unwrapApiPayload(payload: unknown): unknown {
  const record = recordOf(payload);
  if (record.success === false) {
    throw apiError(
      friendlyBackendMessage(record.message, "若道服务返回了错误，请稍后再试。"),
      0,
      String(record.errorCode ?? "api-error"),
    );
  }
  return "data" in record ? record.data : payload;
}

function friendlyBackendMessage(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/invalid credentials|bad credentials|incorrect password|password.*incorrect/i.test(text)) {
    return "邮箱或密码不正确。";
  }
  if (/account.*(disabled|locked|banned|inactive)/i.test(text)) {
    return "该若道账号当前不可登录，请到若道官网查看账号状态。";
  }
  if (/too many|rate limit/i.test(text)) return "尝试过于频繁，请稍后再试。";
  if (/model.*(not found|unsupported|not available)/i.test(text)) {
    return "当前账号没有可用的文本模型，请先在若道「我的模型」中添加。";
  }
  return text;
}

function readableServerMessage(value: unknown): string {
  const text = friendlyBackendMessage(value, "").replace(/\s+/g, " ").trim();
  if (!text || /^(internal (server )?error|error)$/i.test(text)) return "";
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function describeHttpError(status: number, payload: unknown, fallback: string): AssistantApiError {
  const record = recordOf(payload);
  const serverMessage = readableServerMessage(record.message);
  if (status === 401) return apiError("若道登录已过期，请重新登录。", 401, "unauthorized");
  if (status === 402) {
    return apiError(
      serverMessage || "当前若道账号的模型额度不足，请充值或换用其他模型。",
      402,
      "payment-required",
    );
  }
  if (status === 403) return apiError("当前若道账号没有使用该模型的权限。", 403, "forbidden");
  if (status === 404) return apiError("若道服务接口不存在，请检查服务地址或稍后再试。", 404, "not-found");
  if (status === 429) return apiError("请求过于频繁，请稍后再试。", 429, "rate-limited");
  if (status >= 500) {
    return apiError(
      serverMessage
        ? `若道服务返回错误：${serverMessage}`
        : "若道服务暂时不可用，请稍后再试。",
      status,
      "server-error",
    );
  }
  return apiError(serverMessage || fallback, status, "http-error");
}

export function parseLoginResponse(payload: unknown): { token: string; user: AssistantUser } {
  const data = recordOf(unwrapApiPayload(payload));
  const token = String(data.token ?? "").trim();
  if (!token) {
    throw apiError(
      friendlyBackendMessage(data.message, "登录响应中缺少会话令牌，请稍后再试。"),
      0,
      "missing-token",
    );
  }
  const user = recordOf(data.user);
  return {
    token,
    user: {
      id: String(user.id ?? "").trim(),
      email: String(user.email ?? "").trim(),
      displayName: String(user.displayName ?? "").trim(),
      avatarUrl: String(user.avatarUrl ?? "").trim(),
      role: String(user.role ?? "").trim(),
    },
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function supportsText(generationModes: unknown, capabilities?: unknown): boolean {
  const modes = [...stringList(generationModes), ...stringList(capabilities)];
  return modes.includes("other") || modes.includes("draft");
}

function modelsOfConfig(entry: Record<string, unknown>): string[] {
  const supported = stringList(entry.supportedModels);
  if (supported.length > 0) return supported;
  const name = String(entry.modelName ?? "").trim();
  return name ? [name] : [];
}

function inputTypesFor(source: unknown, modelName: string): string[] {
  if (Array.isArray(source)) {
    return [...new Set(stringList(source).map((value) => value.toLowerCase()))];
  }
  const record = recordOf(source);
  const direct = stringList(record.inputTypes);
  const perModel = stringList(record[modelName]);
  return [...new Set([...direct, ...perModel].map((value) => value.toLowerCase()))];
}

function mergeInputTypes(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

/** 合并用户自己的模型配置与平台模型目录，只保留可用于文本问答的模型。 */
export function collectTextModels(
  configsPayload: unknown,
  catalogPayload: unknown,
): { models: AssistantModel[]; defaultModel: string } {
  const configsValue = unwrapApiPayload(configsPayload);
  const catalogValue = unwrapApiPayload(catalogPayload);
  const configs = Array.isArray(configsValue) ? configsValue : [];
  const catalog = Array.isArray(catalogValue) ? catalogValue : [];
  const models: AssistantModel[] = [];
  const indexByName = new Map<string, AssistantModel>();
  let defaultModel = "";

  const push = (entry: AssistantModel, isDefault: boolean) => {
    const key = entry.modelName.toLowerCase();
    if (!key) return;
    const existing = indexByName.get(key);
    if (existing) {
      existing.inputTypes = mergeInputTypes(existing.inputTypes, entry.inputTypes);
    } else {
      indexByName.set(key, entry);
      models.push(entry);
    }
    if (isDefault && !defaultModel) defaultModel = entry.modelName;
  };

  for (const raw of configs) {
    const config = recordOf(raw);
    if (config.isActive === false) continue;
    const modelConfigId = String(config.id ?? config.modelConfigId ?? "").trim();
    const configLabel = String(config.displayName ?? config.provider ?? "若道模型").trim();
    const capabilities = recordOf(config.modelCapabilities);
    const inputTypes = recordOf(config.modelInputTypes);
    const baseModes = config.generationModes ?? config.capabilities;
    const supported = modelsOfConfig(config);
    for (const modelName of supported) {
      const perModel = capabilities[modelName];
      if (!supportsText(perModel ?? baseModes, perModel ? undefined : config.capabilities)) continue;
      push(
        {
          id: `${modelConfigId || "config"}:${modelName}`,
          modelConfigId,
          modelName,
          label: configLabel && configLabel !== modelName ? `${configLabel} · ${modelName}` : modelName,
          inputTypes: inputTypesFor(inputTypes, modelName),
        },
        config.isDefault === true,
      );
    }
  }

  for (const raw of catalog) {
    const entry = recordOf(raw);
    const modelName = String(entry.modelName ?? entry.model ?? "").trim();
    if (!modelName) continue;
    if (!supportsText(entry.generationModes, entry.capabilities)) continue;
    const modelConfigId = String(entry.modelConfigId ?? entry.id ?? "").trim();
    const label = String(entry.label ?? entry.displayName ?? entry.provider ?? "若道模型").trim();
    push(
      {
        id: `${modelConfigId || "catalog"}:${modelName}`,
        modelConfigId,
        modelName,
        label: label && label !== modelName ? `${label} · ${modelName}` : modelName,
        inputTypes: inputTypesFor(entry.inputTypes, modelName),
      },
      entry.isDefault === true,
    );
  }

  const limited = models.slice(0, ASSISTANT_MODEL_LIMIT);
  if (!defaultModel || !limited.some((model) => model.modelName === defaultModel)) {
    defaultModel = limited[0]?.modelName ?? "";
  }
  return { models: limited, defaultModel };
}

export function redactSecrets(input: string): string {
  let text = String(input ?? "");
  text = text.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
    "[已隐藏私钥]",
  );
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[已隐藏令牌]",
  );
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[已隐藏]");
  text = text.replace(
    /\b(password|passwd|passphrase|secret|token|api[_-]?key)\b(\s*[:=：]\s*)([^\s,，;；]+)/gi,
    "$1$2[已隐藏]",
  );
  text = text.replace(
    /(远控码|访问密钥|管理员密码|登录密码|SSH\s*密码|密码|私钥口令|口令)(\s*[:：=]?\s*)([A-Za-z0-9@#$%^&*._+-]{4,})/gi,
    "$1$2[已隐藏]",
  );
  text = text.replace(/\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g, "[已隐藏号码]");
  return text;
}

export function sanitizeAssistantContext(input: unknown): string {
  const text = redactSecrets(String(input ?? "")).trim();
  return text.length > ASSISTANT_CONTEXT_LIMIT
    ? `${text.slice(0, ASSISTANT_CONTEXT_LIMIT)}\n…（状态信息过长，已截断）`
    : text;
}

export function sanitizeQuestion(input: unknown): string {
  return redactSecrets(String(input ?? "")).trim().slice(0, ASSISTANT_QUESTION_LIMIT);
}

export function sanitizeImageDataUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const images: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const url = item.trim();
    if (!url || url.length > ASSISTANT_IMAGE_DATA_URL_LIMIT) continue;
    if (!IMAGE_DATA_URL_PATTERN.test(url)) continue;
    images.push(url);
    if (images.length >= ASSISTANT_IMAGE_LIMIT) break;
  }
  return images;
}

export function modelAcceptsImages(model: AssistantModel | null | undefined): boolean {
  if (!model) return true;
  if (model.inputTypes.length === 0) return true;
  return model.inputTypes.includes("image");
}

type AssistantUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export function buildAssistantMessages(
  question: string,
  history: AssistantChatTurn[],
  context: string,
  images: unknown = [],
): Array<{ role: "system" | "user" | "assistant"; content: AssistantUserContent }> {
  const cleanQuestion = sanitizeQuestion(question);
  const cleanImages = sanitizeImageDataUrls(images);
  if (!cleanQuestion && cleanImages.length === 0) {
    throw apiError("请输入你想问的问题。", 400, "empty-question");
  }
  const cleanContext = sanitizeAssistantContext(context);
  const turns = history
    .filter(
      (turn) =>
        (turn?.role === "user" || turn?.role === "assistant") &&
        typeof turn?.content === "string" &&
        turn.content.trim(),
    )
    .slice(-ASSISTANT_HISTORY_LIMIT)
    .map((turn) => ({
      role: turn.role,
      content: redactSecrets(turn.content).trim().slice(0, ASSISTANT_HISTORY_ITEM_LIMIT),
    }));
  const system = cleanContext
    ? `${ASSISTANT_SYSTEM_PROMPT}\n\n【当前运行状态（客户端自动附带，已隐藏敏感信息）】\n${cleanContext}`
    : ASSISTANT_SYSTEM_PROMPT;
  const userText = cleanQuestion || "请结合当前状态，分析这张截图里的问题并给出处理步骤。";
  const userContent: AssistantUserContent =
    cleanImages.length === 0
      ? userText
      : [
          { type: "text" as const, text: userText },
          ...cleanImages.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ];
  return [{ role: "system", content: system }, ...turns, { role: "user", content: userContent }];
}

export interface ChatReply {
  content: string;
  model: string;
  modelConfigId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export function parseChatResponse(payload: unknown, requestedModel: string): ChatReply {
  const data = recordOf(unwrapApiPayload(payload));
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = recordOf(choices[0]);
  const message = recordOf(first.message);
  const content = String(message.content ?? "").trim();
  if (!content) {
    throw apiError("AI 没有返回内容，请换个问法或稍后再试。", 0, "empty-answer");
  }
  const usage = recordOf(data.usage);
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  const totalTokens = Number(usage.total_tokens);
  return {
    content,
    model: String(data.model ?? requestedModel).trim() || requestedModel,
    modelConfigId: String(data.modelConfigId ?? "").trim(),
    usage:
      Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? {
            promptTokens,
            completionTokens,
            totalTokens: Number.isFinite(totalTokens)
              ? totalTokens
              : promptTokens + completionTokens,
          }
        : null,
  };
}
