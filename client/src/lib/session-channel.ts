import type { QualityPreset } from "../types";
import { isRendererInputEvent, type InputEventPayload } from "./input";

export const CHAT_TEXT_LIMIT = 2000;
export const CLIPBOARD_TEXT_LIMIT = 64 * 1024;

export type SessionMessage =
  | { kind: "chat"; text: string; at: number }
  | { kind: "clipboard"; text: string }
  | { kind: "clipboard-pref"; enabled: boolean }
  | { kind: "session-state"; inputPaused: boolean; clipboard: boolean }
  | { kind: "quality"; preset: QualityPreset };

export type SessionFrame =
  | { type: "input"; event: InputEventPayload }
  | { type: "message"; message: SessionMessage };

const QUALITY_PRESETS: readonly QualityPreset[] = ["smooth", "balanced", "sharp"];

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === "string" && (QUALITY_PRESETS as readonly string[]).includes(value);
}

export function sanitizeChatText(value: string): string {
  return value.replace(/\u0000/g, "").trim().slice(0, CHAT_TEXT_LIMIT);
}

export function sanitizeClipboardText(value: string): string {
  return value.replace(/\u0000/g, "").slice(0, CLIPBOARD_TEXT_LIMIT);
}

export function clipboardKey(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function readTime(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now();
}

function readSessionMessage(value: unknown): SessionMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case "chat": {
      if (typeof raw.text !== "string") return null;
      const text = sanitizeChatText(raw.text);
      if (!text) return null;
      return { kind: "chat", text, at: readTime(raw.at) };
    }
    case "clipboard": {
      if (typeof raw.text !== "string") return null;
      const text = sanitizeClipboardText(raw.text);
      if (!text) return null;
      return { kind: "clipboard", text };
    }
    case "clipboard-pref":
      return typeof raw.enabled === "boolean"
        ? { kind: "clipboard-pref", enabled: raw.enabled }
        : null;
    case "session-state":
      return typeof raw.inputPaused === "boolean" && typeof raw.clipboard === "boolean"
        ? { kind: "session-state", inputPaused: raw.inputPaused, clipboard: raw.clipboard }
        : null;
    case "quality":
      return isQualityPreset(raw.preset) ? { kind: "quality", preset: raw.preset } : null;
    default:
      return null;
  }
}

export function parseSessionFrame(raw: unknown): SessionFrame | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isRendererInputEvent(value)) return { type: "input", event: value };
  const message = readSessionMessage(value);
  return message ? { type: "message", message } : null;
}

export function encodeSessionMessage(message: SessionMessage): string {
  return JSON.stringify(message);
}
