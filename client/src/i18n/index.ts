/**
 * 轻量国际化：以中文原文作为 key，英文词典做映射。
 *
 * 这样组件里可以直接写 t("开始被控")，中文模式下零开销，
 * 英文模式下按词典替换；缺失的词条自动回退中文原文。
 *
 * 语言变化通过 subscribe 通知 React 重新渲染（App 用 key 强制重挂载子树）。
 */
import { EN } from "./en";

export type Language = "zh" | "en";

const STORAGE_KEY = "ruodao-remote.language";

function detectInitial(): Language {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // localStorage 不可用时按系统语言判断。
  }
  const locale = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "zh").toLowerCase();
  return locale.startsWith("zh") ? "zh" : "en";
}

let current: Language = detectInitial();
const listeners = new Set<() => void>();

/** 统一空白，避免 JSX 换行导致的缩进差异让词条失配。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const EN_INDEX = new Map<string, string>(
  Object.entries(EN).map(([key, value]) => [normalize(key), value]),
);

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  applyDocumentLanguage();
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 忽略存储失败。
  }
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 切换界面语言并刷新渲染进程。
 * 部分文案（使用指南、内置步骤）在模块加载时就已完成翻译，重新加载最稳妥。
 */
export function changeLanguage(next: Language): void {
  if (next === current) return;
  setLanguage(next);
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export function applyDocumentLanguage(): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  }
}

if (typeof window !== "undefined") applyDocumentLanguage();

/** 翻译单条文案。中文原文即 key。 */
export function t(text: string): string {
  if (current === "zh") return text;
  return EN_INDEX.get(normalize(text)) ?? text;
}

/**
 * 带占位符的翻译，模板里用 {0} {1} 表示参数。
 * 英文词条可以调整语序，例如 "已连接 {0}" → "Connected to {0}"。
 */
export function tf(template: string, ...values: Array<string | number>): string {
  const text = t(template);
  if (values.length === 0) return text;
  return text.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/** 把可能来自主进程 / 服务端的消息翻译成当前语言（无词条时原样返回）。 */
export const translateMessage = t;

export function formatList(values: string[], language: Language = current): string {
  if (values.length === 0) return "";
  if (language === "zh") return values.join("、");
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
