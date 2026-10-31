import { describe, expect, it } from "vitest";
import {
  ASSISTANT_HISTORY_LIMIT,
  ASSISTANT_IMAGE_LIMIT,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessages,
  collectTextModels,
  describeHttpError,
  jwtExpiresAt,
  modelAcceptsImages,
  normalizeAssistantBaseUrl,
  parseChatResponse,
  parseLoginResponse,
  redactSecrets,
  sanitizeImageDataUrls,
  sanitizeQuestion,
  tokenExpired,
  tokenNeedsRefresh,
  unwrapApiPayload,
} from "../electron/assistant-protocol";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

describe("assistant base url", () => {
  it("keeps http(s) origins and trims trailing slashes", () => {
    expect(normalizeAssistantBaseUrl("https://ruodao.com/")).toBe("https://ruodao.com");
    expect(normalizeAssistantBaseUrl("http://127.0.0.1:8080/api/")).toBe(
      "http://127.0.0.1:8080/api",
    );
  });

  it("falls back for empty or unsafe input", () => {
    expect(normalizeAssistantBaseUrl("")).toBe("https://ruodao.com");
    expect(normalizeAssistantBaseUrl("javascript:alert(1)")).toBe("https://ruodao.com");
    expect(normalizeAssistantBaseUrl("https://user:pass@ruodao.com")).toBe(
      "https://ruodao.com",
    );
    expect(normalizeAssistantBaseUrl("https://ruodao.com/?a=1")).toBe("https://ruodao.com");
  });
});

describe("assistant token helpers", () => {
  it("reads exp seconds as milliseconds", () => {
    const token = jwt({ exp: 1_800_000_000 });
    expect(jwtExpiresAt(token)).toBe(1_800_000_000_000);
    expect(jwtExpiresAt("not-a-jwt")).toBeNull();
  });

  it("treats tokens without exp as neither expiring nor expired", () => {
    expect(tokenNeedsRefresh(jwt({ sub: "u1" }))).toBe(false);
    expect(tokenExpired(jwt({ sub: "u1" }))).toBe(false);
  });

  it("flags tokens inside the refresh window", () => {
    const soon = jwt({ exp: Math.floor((Date.now() + 60_000) / 1000) });
    const later = jwt({ exp: Math.floor((Date.now() + 600_000) / 1000) });
    expect(tokenNeedsRefresh(soon)).toBe(true);
    expect(tokenNeedsRefresh(later)).toBe(false);
    expect(tokenExpired(jwt({ exp: Math.floor((Date.now() - 1_000) / 1000) }))).toBe(true);
  });
});

describe("assistant api payloads", () => {
  it("unwraps the success envelope and rejects failures", () => {
    expect(unwrapApiPayload({ success: true, data: { token: "t" } })).toEqual({ token: "t" });
    expect(unwrapApiPayload({ ok: true })).toEqual({ ok: true });
    expect(() => unwrapApiPayload({ success: false, message: "too many requests" })).toThrow(
      "尝试过于频繁，请稍后再试。",
    );
  });

  it("parses login responses with and without the envelope", () => {
    const wrapped = parseLoginResponse({
      success: true,
      data: { token: "abc", user: { id: "u1", email: "a@b.com", displayName: "阿飞" } },
    });
    expect(wrapped.token).toBe("abc");
    expect(wrapped.user).toMatchObject({ id: "u1", email: "a@b.com", displayName: "阿飞" });

    expect(parseLoginResponse({ token: "direct", user: null }).token).toBe("direct");
    expect(() => parseLoginResponse({ success: true, data: {} })).toThrow(/令牌/);
  });
});

describe("assistant model list", () => {
  it("keeps text-capable, active models and dedupes names", () => {
    const result = collectTextModels(
      {
        success: true,
        data: [
          {
            id: "cfg-1",
            provider: "DeepSeek",
            isActive: true,
            isDefault: false,
            supportedModels: ["deepseek-chat", "deepseek-reasoner"],
            generationModes: ["other"],
          },
          {
            id: "cfg-2",
            provider: "图片模型",
            isActive: true,
            isDefault: true,
            supportedModels: ["image-xl"],
            generationModes: ["image"],
          },
          {
            id: "cfg-3",
            provider: "停用",
            isActive: false,
            supportedModels: ["deepseek-chat"],
            generationModes: ["other"],
          },
        ],
      },
      {
        success: true,
        data: [
          {
            modelName: "deepseek-chat",
            label: "DeepSeek",
            generationModes: ["other"],
          },
          {
            modelName: "draft-writer",
            label: "写作",
            generationModes: ["draft"],
          },
          {
            modelName: "qwen-vl",
            label: "视觉",
            generationModes: ["image"],
          },
        ],
      },
    );
    expect(result.models.map((model) => model.modelName)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
      "draft-writer",
    ]);
    expect(result.models[0].label).toBe("DeepSeek · deepseek-chat");
    expect(result.defaultModel).toBe("deepseek-chat");
  });

  it("honours per-model capability overrides", () => {
    const result = collectTextModels(
      {
        data: [
          {
            id: "cfg-1",
            displayName: "多模态",
            isActive: true,
            isDefault: true,
            supportedModels: ["chat-a", "image-b"],
            modelCapabilities: {
              "chat-a": ["other"],
              "image-b": ["image"],
            },
          },
        ],
      },
      { data: [] },
    );
    expect(result.models.map((model) => model.modelName)).toEqual(["chat-a"]);
    expect(result.defaultModel).toBe("chat-a");
  });

  it("falls back to the first model when no default is marked", () => {
    const result = collectTextModels(
      { data: [] },
      { data: [{ modelName: "alpha", generationModes: ["other"] }] },
    );
    expect(result.defaultModel).toBe("alpha");
  });

  it("merges image capabilities from configs and catalog", () => {
    const result = collectTextModels(
      {
        data: [
          {
            id: "cfg-1",
            displayName: "视觉模型",
            isActive: true,
            isDefault: true,
            supportedModels: ["qwen-vl"],
            generationModes: ["other"],
            modelInputTypes: { "qwen-vl": ["text", "image"] },
          },
        ],
      },
      { data: [{ modelName: "qwen-vl", inputTypes: ["text"] }] },
    );
    expect(result.models).toHaveLength(1);
    expect(result.models[0].inputTypes).toEqual(["text", "image"]);
    expect(modelAcceptsImages(result.models[0])).toBe(true);
  });

  it("treats unknown input types as permissive but honours text-only", () => {
    const result = collectTextModels(
      { data: [] },
      { data: [{ modelName: "plain", generationModes: ["other"] }] },
    );
    expect(result.models[0].inputTypes).toEqual([]);
    expect(modelAcceptsImages(result.models[0])).toBe(true);
    expect(modelAcceptsImages({ ...result.models[0], inputTypes: ["text"] })).toBe(false);
  });
});

describe("assistant images", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const jpg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

  it("keeps only supported data urls and caps the count", () => {
    expect(
      sanitizeImageDataUrls([
        png,
        "https://example.com/a.png",
        "data:text/html;base64,PHNjcmlwdD4=",
        "data:image/png;base64,not base64!",
      ]),
    ).toEqual([png]);
    expect(sanitizeImageDataUrls(Array.from({ length: 5 }, () => jpg))).toHaveLength(
      ASSISTANT_IMAGE_LIMIT,
    );
    expect(sanitizeImageDataUrls("not-an-array")).toEqual([]);
  });

  it("builds OpenAI-style multimodal user content", () => {
    const messages = buildAssistantMessages("看这张截图", [], "", [png, jpg]);
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看这张截图" },
        { type: "image_url", image_url: { url: png } },
        { type: "image_url", image_url: { url: jpg } },
      ],
    });
  });

  it("allows an image-only turn but still rejects a fully empty one", () => {
    const messages = buildAssistantMessages("   ", [], "", [png]);
    expect(messages.at(-1)?.content).toEqual([
      { type: "text", text: "请结合当前状态，分析这张截图里的问题并给出处理步骤。" },
      { type: "image_url", image_url: { url: png } },
    ]);
    expect(() => buildAssistantMessages("  ", [], "", [])).toThrow("请输入你想问的问题。");
  });
});

describe("assistant http errors", () => {
  it("surfaces backend detail on 5xx and keeps the generic fallback", () => {
    expect(describeHttpError(500, { message: "模型调用失败：上游超时" }, "x").message).toBe(
      "若道服务返回错误：模型调用失败：上游超时",
    );
    expect(describeHttpError(500, { message: "Internal Server Error" }, "x").message).toBe(
      "若道服务暂时不可用，请稍后再试。",
    );
    expect(describeHttpError(500, null, "x").code).toBe("server-error");
  });

  it("maps quota problems to a recharge hint", () => {
    const error = describeHttpError(402, { message: "" }, "x");
    expect(error.code).toBe("payment-required");
    expect(error.message).toContain("额度不足");
  });
});

describe("assistant redaction", () => {
  it("hides remote codes, access keys, passwords and tokens", () => {
    const text = redactSecrets(
      [
        "远控码: 123 456 789",
        "访问密钥: ABCDE23456",
        "password=hunter2",
        "登录密码：hunter3",
        "SSH 密码: sshpass99",
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      ].join("\n"),
    );
    expect(text).not.toContain("123 456 789");
    expect(text).not.toContain("ABCDE23456");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("hunter3");
    expect(text).not.toContain("sshpass99");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).toContain("[已隐藏");
  });

  it("hides private key blocks", () => {
    const text = redactSecrets(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
    );
    expect(text).toBe("[已隐藏私钥]");
  });

  it("keeps ordinary troubleshooting text intact", () => {
    const input = "服务器 203.0.113.10 的 443 端口连接超时，Caddy 状态异常。";
    expect(redactSecrets(input)).toBe(input);
    expect(sanitizeQuestion("  怎么办？  ")).toBe("怎么办？");
  });
});

describe("assistant messages", () => {
  it("embeds the sanitized context in the system prompt", () => {
    const messages = buildAssistantMessages("部署失败怎么办？", [], "远控码: 987 654 321");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(ASSISTANT_SYSTEM_PROMPT);
    expect(messages[0].content).not.toContain("987 654 321");
    expect(messages.at(-1)).toEqual({ role: "user", content: "部署失败怎么办？" });
  });

  it("keeps only the newest history turns and drops empty ones", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `第 ${index} 条`,
    }));
    history.push({ role: "user", content: "   " });
    const messages = buildAssistantMessages("继续", history, "");
    expect(messages).toHaveLength(1 + ASSISTANT_HISTORY_LIMIT + 1);
    expect(messages[1].content).toBe("第 4 条");
  });

  it("rejects empty questions", () => {
    expect(() => buildAssistantMessages("   ", [], "")).toThrow("请输入你想问的问题。");
  });
});

describe("assistant chat replies", () => {
  it("reads OpenAI-compatible choices", () => {
    const reply = parseChatResponse(
      {
        model: "deepseek-chat",
        choices: [{ message: { role: "assistant", content: " 先检查 443 端口。 " } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      "fallback-model",
    );
    expect(reply.content).toBe("先检查 443 端口。");
    expect(reply.model).toBe("deepseek-chat");
    expect(reply.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("falls back to the requested model and rejects empty answers", () => {
    const reply = parseChatResponse(
      { success: true, data: { choices: [{ message: { content: "可以" } }] } },
      "fallback-model",
    );
    expect(reply.model).toBe("fallback-model");
    expect(reply.usage).toBeNull();
    expect(() => parseChatResponse({ choices: [{ message: { content: "" } }] }, "m")).toThrow(
      /没有返回内容/,
    );
  });
});
