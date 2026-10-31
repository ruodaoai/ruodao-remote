import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { AssistantController } from "../hooks/useAssistant";
import type { Diagnosis } from "../lib/diagnosis";
import {
  ASSISTANT_IMAGE_LIMIT,
  assistantImageError,
  prepareImageDataUrl,
  prepareImageFile,
} from "../lib/assistant-image";
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  RefreshIcon,
  SendIcon,
  ShieldIcon,
  SparkIcon,
  UserIcon,
  XIcon,
} from "./icons";
import { InlineAlert } from "./ui";

interface AssistantDialogProps {
  open: boolean;
  assistant: AssistantController;
  diagnosis: Diagnosis;
  seed: { id: number; question: string } | null;
  onClose: () => void;
  onOpenGuide: () => void;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  images?: string[];
}

interface FailedTurn {
  text: string;
  images: string[];
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return <span key={key}>{part}</span>;
  });
}

function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className="assistant-message-content">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim());
        if (lines.length === 0) return null;
        if (lines.every((line) => /^[-*•]\s+/.test(line.trim()))) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, index) => (
                <li key={index}>
                  {renderInline(line.trim().replace(/^[-*•]\s+/, ""), `${blockIndex}-${index}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\d+[.、)]\s*/.test(line.trim()))) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, index) => (
                <li key={index}>
                  {renderInline(line.trim().replace(/^\d+[.、)]\s*/, ""), `${blockIndex}-${index}`)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, index) => (
              <span key={index}>
                {index > 0 && <br />}
                {renderInline(line, `${blockIndex}-${index}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function AssistantDialog({
  open,
  assistant,
  diagnosis,
  seed,
  onClose,
  onOpenGuide,
}: AssistantDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<string[]>([]);
  const nextId = useRef(1);
  const autoQuestion = useRef<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [showContext, setShowContext] = useState(false);

  const status = assistant.status;
  const loggedIn = Boolean(status?.authenticated);
  const expired = Boolean(status && !status.authenticated && status.sessionExpired);
  const selectedModel = status?.models.find((item) => item.modelName === model) ?? null;
  const selectedInputTypes = selectedModel?.inputTypes ?? [];
  const modelSupportsImages = selectedInputTypes.length === 0 || selectedInputTypes.includes("image");

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  function applyImages(next: string[]): void {
    imagesRef.current = next;
    setImages(next);
  }

  function removeImage(index: number): void {
    applyImages(images.filter((_, itemIndex) => itemIndex !== index));
    setImageError(null);
  }

  function appendPreparedImages(urls: string[]): void {
    const existing = new Set(imagesRef.current);
    const fresh = urls.filter((url) => !existing.has(url));
    const room = ASSISTANT_IMAGE_LIMIT - imagesRef.current.length;
    if (room <= 0) {
      setImageError(`最多添加 ${ASSISTANT_IMAGE_LIMIT} 张图片，请先移除一张。`);
      return;
    }
    const accepted = fresh.slice(0, room);
    if (accepted.length < fresh.length) {
      setImageError(`最多添加 ${ASSISTANT_IMAGE_LIMIT} 张图片，多余的已忽略。`);
    }
    if (accepted.length > 0) applyImages([...imagesRef.current, ...accepted]);
  }

  async function addImageFiles(files: File[]): Promise<void> {
    if (assistant.chatBusy || imageBusy || files.length === 0) return;
    setImageBusy(true);
    setImageError(null);
    const prepared: string[] = [];
    const errors: string[] = [];
    try {
      for (const file of files.slice(0, ASSISTANT_IMAGE_LIMIT + 1)) {
        const invalid = assistantImageError(file);
        if (invalid) {
          errors.push(invalid);
          continue;
        }
        try {
          prepared.push(await prepareImageFile(file));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "图片处理失败，请换一张再试。");
        }
      }
      if (prepared.length > 0) appendPreparedImages(prepared);
      if (errors.length > 0) setImageError(errors[0]);
    } finally {
      setImageBusy(false);
    }
  }

  async function pasteClipboardImage(): Promise<void> {
    if (assistant.chatBusy || imageBusy) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const dataUrl = await window.remote.readClipboardImage();
      if (!dataUrl) {
        setImageError("剪贴板里没有图片，请先截图或复制图片。");
        return;
      }
      appendPreparedImages([await prepareImageDataUrl(dataUrl)]);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "读取剪贴板图片失败。");
    } finally {
      setImageBusy(false);
    }
  }

  async function copyImage(dataUrl: string): Promise<void> {
    let ok = false;
    try {
      ok = await window.remote.writeClipboardImage(dataUrl);
    } catch {
      ok = false;
    }
    setCopyNotice(ok ? "已复制图片" : "复制图片失败");
    window.setTimeout(() => setCopyNotice(null), 2200);
  }

  function handlePickImages(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addImageFiles(files);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length > 0) {
      event.preventDefault();
      void addImageFiles(files);
      return;
    }
    const hasText = Boolean(event.clipboardData?.getData("text/plain"));
    if (!hasText) {
      event.preventDefault();
      void pasteClipboardImage();
    }
  }

  function handleComposerDragOver(event: DragEvent<HTMLFormElement>): void {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function handleComposerDragLeave(event: DragEvent<HTMLFormElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function handleComposerDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDragging(false);
    if (assistant.chatBusy) return;
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) {
      setImageError("请拖入图片文件（PNG、JPG、WebP 或 GIF）。");
      return;
    }
    void addImageFiles(files);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void assistant.ensureLoaded();
    setChatError(null);
    setFailedTurn(null);
    setPassword("");
    setShowContext(false);
  }, [open, assistant.ensureLoaded]);

  useEffect(() => {
    if (!open) return;
    setMessages([]);
    setChatError(null);
    setFailedTurn(null);
    setImageError(null);
    applyImages([]);
    if (seed) {
      setDraft(seed.question);
      autoQuestion.current = seed.question;
    } else {
      setDraft("");
      autoQuestion.current = null;
    }
    nextId.current = 1;
  }, [open, seed?.id]);

  useEffect(() => {
    if (!status) return;
    setModel((current) => {
      if (status.models.some((item) => item.modelName === current)) return current;
      return status.model || status.defaultModel;
    });
    if (!status.authenticated && status.email) {
      setEmail((current) => current || status.email);
    }
  }, [status]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, assistant.chatBusy, open]);

  const suggestions = useMemo(() => diagnosis.suggestions.slice(0, 4), [diagnosis.suggestions]);

  async function ask(
    question: string,
    attached: string[] = [],
    options: { appendUser?: boolean } = {},
  ): Promise<void> {
    const text = question.trim();
    const imageList = attached.slice();
    if ((!text && imageList.length === 0) || assistant.chatBusy || imageBusy || !loggedIn) return;
    if (imageList.length > 0 && !modelSupportsImages) {
      setImageError("当前模型不支持图片输入，请先切换到支持图片的模型。");
      return;
    }
    const appendUser = options.appendUser !== false;
    if (appendUser) {
      setDraft("");
      applyImages([]);
      setImageError(null);
    }
    setChatError(null);
    setFailedTurn(null);
    const historySource =
      !appendUser && messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages;
    const history = historySource.slice(-8).map(({ role, content }) => ({ role, content }));
    if (appendUser) {
      const userMessage: ChatMessage = {
        id: nextId.current++,
        role: "user",
        content: text,
        images: imageList,
      };
      setMessages((list) => [...list, userMessage]);
    }
    try {
      const reply = await assistant.send({
        question: text,
        context: diagnosis.context,
        history,
        model,
        images: imageList,
      });
      setMessages((list) => [
        ...list,
        { id: nextId.current++, role: "assistant", content: reply.content, model: reply.model },
      ]);
    } catch {
      setFailedTurn({ text, images: imageList });
    }
  }

  useEffect(() => {
    if (!open || !loggedIn || !autoQuestion.current || assistant.chatBusy) return;
    const question = autoQuestion.current;
    autoQuestion.current = null;
    void ask(question);
  }, [open, loggedIn, assistant.chatBusy]);

  async function submitLogin(): Promise<void> {
    if (assistant.loginBusy) return;
    const ok = await assistant.login(email, password);
    if (ok) setPassword("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft, images);
    }
  }

  const errorText = assistant.error ?? chatError;
  const modelError = status?.modelsError;
  const canSend =
    !assistant.chatBusy &&
    !imageBusy &&
    (draft.trim().length > 0 || images.length > 0) &&
    (status?.models.length ?? 0) > 0 &&
    (images.length === 0 || modelSupportsImages);

  return (
    <dialog
      ref={dialogRef}
      className="assistant-dialog"
      data-testid="assistant-dialog"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="assistant-shell">
        <header className="assistant-head">
          <span className="assistant-head-icon">
            <SparkIcon size={22} />
          </span>
          <div className="assistant-head-copy">
            <span className="eyebrow">AI 使用助手</span>
            <h2>{loggedIn ? "哪里看不懂，直接问我" : "登录若道账号，让 AI 帮你判断"}</h2>
            <p>结合当前连接与部署状态回答，只讨论若道远程的安装、配置与使用。</p>
          </div>
          <div className="assistant-head-actions">
            <button type="button" className="button ghost small" onClick={onOpenGuide}>
              <BookIcon size={15} />
              使用指南
            </button>
            <button type="button" className="icon-button" aria-label="关闭 AI 助手" onClick={onClose}>
              <XIcon size={18} />
            </button>
          </div>
        </header>

        {!status && assistant.loading ? (
          <div className="assistant-loading">
            <span className="spinner large" />
            <p>正在检查若道登录状态…</p>
          </div>
        ) : !loggedIn ? (
          <div className="assistant-login">
            <div className="assistant-login-copy">
              <span className="assistant-kicker">
                <ShieldIcon size={15} /> 只发送必要信息
              </span>
              <h3>AI 能看到什么？</h3>
              <ul className="assistant-facts">
                <li>
                  <CheckIcon size={15} />
                  客户端版本、服务器地址、连接状态和最近错误
                </li>
                <li>
                  <LockIcon size={15} />
                  不包含密码、访问密钥、远控码、邀请码或 SSH 私钥
                </li>
                <li>
                  <EyeIcon size={15} />
                  发送前可以在对话页展开“查看将发送的状态”
                </li>
                <li>
                  <ShieldIcon size={15} />
                  登录令牌使用系统加密存储保存在本机，不保存账号密码
                </li>
              </ul>
              <div className="assistant-login-note">
                <InfoIcon size={15} />
                <span>
                  没有若道账号也可以继续使用远控功能。只有 AI 助手需要登录，用于调用你账号下的模型。
                </span>
              </div>
              <div className="assistant-login-links">
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
            </div>

            <form
              className="assistant-login-card"
              onSubmit={(event) => {
                event.preventDefault();
                void submitLogin();
              }}
            >
              <span className="assistant-kicker">
                <UserIcon size={15} /> 若道账号
              </span>
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
                    data-testid="assistant-email"
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
                    data-testid="assistant-password"
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
              {errorText && <InlineAlert>{errorText}</InlineAlert>}
              <button
                type="submit"
                className="button primary wide"
                data-testid="assistant-login"
                disabled={assistant.loginBusy || !email.trim() || !password}
              >
                {assistant.loginBusy ? <span className="spinner" /> : <SparkIcon size={16} />}
                {assistant.loginBusy ? "正在登录…" : "登录并开始提问"}
              </button>
              <p className="assistant-login-hint">
                登录后会读取你账号下可用于文本问答的模型；没有模型时可在“我的模型”中添加。
              </p>
            </form>
          </div>
        ) : (
          <>
            <div className="assistant-account">
              <div className="assistant-user">
                <span className="assistant-avatar">
                  <UserIcon size={16} />
                </span>
                <div>
                  <strong>{status?.user?.displayName || status?.email || "若道账号"}</strong>
                  <span>{status?.email}</span>
                </div>
              </div>
              <div className="assistant-account-actions">
                {status && status.models.length > 0 && (
                  <label className="assistant-model">
                    <span>模型</span>
                    <select
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      aria-label="选择 AI 模型"
                    >
                      {status.models.map((item) => (
                        <option key={item.id} value={item.modelName}>
                          {item.inputTypes.includes("image") ? `${item.label} · 支持图片` : item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="icon-button subtle"
                  title="刷新模型列表"
                  aria-label="刷新模型列表"
                  disabled={assistant.loading}
                  onClick={() => void assistant.refreshModels()}
                >
                  <RefreshIcon size={16} />
                </button>
                <button type="button" className="text-button" onClick={() => void assistant.logout()}>
                  退出
                </button>
              </div>
            </div>

            <div className="assistant-body">
              <div className="assistant-context-bar">
                <div>
                  <InfoIcon size={14} />
                  <span>
                    本次对话会附带当前状态摘要，文字会自动隐藏密码、密钥和邀请码；图片会原样发送，请先遮挡敏感内容。
                  </span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowContext((value) => !value)}
                  aria-expanded={showContext}
                >
                  {showContext ? "收起状态" : "查看将发送的状态"}
                </button>
              </div>
              {showContext && <pre className="assistant-context">{diagnosis.context}</pre>}

              <div className="assistant-transcript" ref={transcriptRef}>
                {messages.length === 0 ? (
                  <div className="assistant-welcome">
                    <span className="assistant-welcome-icon">
                      <SparkIcon size={24} />
                    </span>
                    <h3>说说你卡在哪一步</h3>
                    <p>
                      我可以结合当前状态和截图判断连接失败、部署报错、邀请码和审批等问题。
                      可以直接粘贴截图或拖入图片，但请先遮挡密码、访问密钥和远控码。
                    </p>
                    <div className="assistant-suggestions">
                      {suggestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          className="assistant-suggestion"
                          onClick={() => void ask(question)}
                          disabled={assistant.chatBusy}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                    {modelError && (
                      <div className="assistant-model-error">
                        <InlineAlert>{modelError}</InlineAlert>
                        <div className="assistant-model-error-actions">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void assistant.refreshModels()}
                          >
                            刷新模型
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void assistant.openAccount("models")}
                          >
                            打开若道「我的模型」
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={`assistant-message role-${message.role}`}>
                      <span className="assistant-message-who">
                        {message.role === "assistant" ? <SparkIcon size={14} /> : <UserIcon size={14} />}
                      </span>
                      <div className="assistant-message-bubble">
                        {message.images && message.images.length > 0 && (
                          <div className="assistant-message-images">
                            {message.images.map((image, index) => (
                              <div className="assistant-message-image" key={index}>
                                <img
                                  src={image}
                                  alt={`发送的截图 ${index + 1}`}
                                  onClick={() => void copyImage(image)}
                                />
                                <button
                                  type="button"
                                  className="assistant-message-image-copy"
                                  title="复制这张图片"
                                  aria-label={`复制第 ${index + 1} 张图片`}
                                  onClick={() => void copyImage(image)}
                                >
                                  <CopyIcon size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {message.content && <MessageContent content={message.content} />}
                        {message.role === "assistant" && message.model && (
                          <span className="assistant-message-model">{message.model}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {assistant.chatBusy && (
                  <div className="assistant-message role-assistant">
                    <span className="assistant-message-who">
                      <SparkIcon size={14} />
                    </span>
                    <div className="assistant-message-bubble assistant-thinking">
                      <span className="spinner small" />
                      正在结合当前状态分析…
                    </div>
                  </div>
                )}
                {failedTurn && !assistant.chatBusy && (
                  <div className="assistant-retry">
                    <InlineAlert>{errorText || "这次没有收到回答，请稍后再试。"}</InlineAlert>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() =>
                        void ask(failedTurn.text, failedTurn.images, { appendUser: false })
                      }
                    >
                      <RefreshIcon size={14} />
                      重试这个问题
                    </button>
                  </div>
                )}
                {modelError && messages.length > 0 && (
                  <div className="assistant-model-error">
                    <InlineAlert>{modelError}</InlineAlert>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void assistant.refreshModels()}
                    >
                      刷新模型
                    </button>
                  </div>
                )}
              </div>

              <form
                className="assistant-composer"
                data-dragging={dragging || undefined}
                onDragOver={handleComposerDragOver}
                onDragLeave={handleComposerDragLeave}
                onDrop={handleComposerDrop}
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(draft, images);
                }}
              >
                {images.length > 0 && (
                  <div className="assistant-attachments" data-testid="assistant-attachments">
                    {images.map((image, index) => (
                      <div className="assistant-attachment" key={index}>
                        <img src={image} alt={`待发送截图 ${index + 1}`} />
                        <button
                          type="button"
                          className="assistant-attachment-remove"
                          aria-label={`移除第 ${index + 1} 张图片`}
                          disabled={assistant.chatBusy}
                          onClick={() => removeImage(index)}
                        >
                          <XIcon size={12} />
                        </button>
                      </div>
                    ))}
                    <span className="assistant-attachments-hint">
                      {images.length}/{ASSISTANT_IMAGE_LIMIT} 张，随问题一起发送
                    </span>
                  </div>
                )}
                {imageError && <InlineAlert>{imageError}</InlineAlert>}
                {images.length > 0 && !modelSupportsImages && (
                  <InlineAlert kind="info">
                    当前模型不支持图片输入，切换到支持图片的模型后才能发送。
                  </InlineAlert>
                )}
                <textarea
                  data-testid="assistant-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handleComposerPaste}
                  placeholder="描述你看到的现象，例如：部署到“配置网站入口”时失败了…（可粘贴或拖入截图）"
                  rows={2}
                  maxLength={2000}
                  disabled={assistant.chatBusy}
                />
                <div className="assistant-composer-foot">
                  <span>Enter 发送 · Shift + Enter 换行 · 图片请先遮挡密钥</span>
                  <div className="assistant-composer-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      hidden
                      onChange={handlePickImages}
                    />
                    <button
                      type="button"
                      className="text-button assistant-image-button"
                      title={
                        modelSupportsImages
                          ? "添加图片（也可以直接粘贴或拖入）"
                          : "当前模型不支持图片输入，请先切换模型"
                      }
                      disabled={
                        assistant.chatBusy ||
                        imageBusy ||
                        !modelSupportsImages ||
                        images.length >= ASSISTANT_IMAGE_LIMIT
                      }
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon size={15} />
                      {imageBusy ? "处理中…" : "图片"}
                    </button>
                    {messages.length > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={assistant.chatBusy}
                        onClick={() => {
                          setMessages([]);
                          setChatError(null);
                          setFailedTurn(null);
                          setDraft("");
                          setImageError(null);
                          applyImages([]);
                        }}
                      >
                        新对话
                      </button>
                    )}
                    <button
                      type="submit"
                      className="button primary small"
                      data-testid="assistant-send"
                      disabled={!canSend}
                    >
                      <SendIcon size={15} />
                      发送
                    </button>
                  </div>
                </div>
                {copyNotice && <div className="assistant-toast">{copyNotice}</div>}
              </form>
            </div>
          </>
        )}

        <footer className="assistant-foot">
          <span>
            <AlertIcon size={13} />
            AI 回答可能出错，涉及删除数据、开放公网或修改防火墙时请先确认影响。
          </span>
          <span className="assistant-foot-account">
            {status?.apiBaseUrl ? `若道服务：${status.apiBaseUrl}` : "若道账号体系"}
          </span>
        </footer>
      </div>
    </dialog>
  );
}
