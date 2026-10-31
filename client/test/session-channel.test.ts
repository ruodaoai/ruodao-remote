import { describe, expect, it } from "vitest";
import {
  CHAT_TEXT_LIMIT,
  CLIPBOARD_TEXT_LIMIT,
  clipboardKey,
  encodeSessionMessage,
  parseSessionFrame,
  sanitizeClipboardText,
} from "../src/lib/session-channel";
import { QUALITY_ORDER, QUALITY_PROFILES } from "../src/lib/webrtc";

function parseMessage(raw: unknown) {
  const frame = parseSessionFrame(JSON.stringify(raw));
  if (!frame || frame.type !== "message") return null;
  return frame.message;
}

describe("session channel protocol", () => {
  it("keeps input frames compatible with the existing wire format", () => {
    const frame = parseSessionFrame(JSON.stringify({ kind: "mouse-move", x: 0.25, y: 0.75 }));
    expect(frame).toEqual({ type: "input", event: { kind: "mouse-move", x: 0.25, y: 0.75 } });
  });

  it("rejects malformed frames and unknown message kinds", () => {
    expect(parseSessionFrame("not json")).toBeNull();
    expect(parseSessionFrame("")).toBeNull();
    expect(parseSessionFrame("42")).toBeNull();
    expect(parseSessionFrame(JSON.stringify({ kind: "unknown" }))).toBeNull();
    expect(parseSessionFrame(JSON.stringify({ kind: "key", action: "down", vk: "x" }))).toBeNull();
  });

  it("trims and caps chat text", () => {
    expect(parseMessage({ kind: "chat", text: "  hello  ", at: 1000 })).toEqual({
      kind: "chat",
      text: "hello",
      at: 1000,
    });
    expect(parseMessage({ kind: "chat", text: "   " })).toBeNull();
    const long = "x".repeat(CHAT_TEXT_LIMIT + 40);
    const message = parseMessage({ kind: "chat", text: long });
    expect(message && message.kind === "chat" ? message.text.length : 0).toBe(CHAT_TEXT_LIMIT);
    const fallback = parseMessage({ kind: "chat", text: "hi", at: "later" });
    expect(fallback && fallback.kind === "chat" ? fallback.at : 0).toBeGreaterThan(0);
  });

  it("caps clipboard text and normalizes line endings for echo checks", () => {
    const long = "a".repeat(CLIPBOARD_TEXT_LIMIT + 10);
    expect(sanitizeClipboardText(long).length).toBe(CLIPBOARD_TEXT_LIMIT);
    expect(sanitizeClipboardText("a\u0000b")).toBe("ab");
    expect(clipboardKey("a\r\nb\r\nc")).toBe("a\nb\nc");
    expect(parseMessage({ kind: "clipboard", text: "" })).toBeNull();
    expect(parseMessage({ kind: "clipboard", text: 5 })).toBeNull();
  });

  it("validates session state and clipboard preferences", () => {
    expect(parseMessage({ kind: "session-state", inputPaused: true, clipboard: false })).toEqual({
      kind: "session-state",
      inputPaused: true,
      clipboard: false,
    });
    expect(parseMessage({ kind: "session-state", inputPaused: "yes", clipboard: false })).toBeNull();
    expect(parseMessage({ kind: "clipboard-pref", enabled: true })).toEqual({
      kind: "clipboard-pref",
      enabled: true,
    });
    expect(parseMessage({ kind: "clipboard-pref", enabled: 1 })).toBeNull();
  });

  it("only accepts known quality presets", () => {
    expect(parseMessage({ kind: "quality", preset: "sharp" })).toEqual({
      kind: "quality",
      preset: "sharp",
    });
    expect(parseMessage({ kind: "quality", preset: "ultra" })).toBeNull();
  });

  it("round-trips encoded messages", () => {
    const message = { kind: "quality" as const, preset: "smooth" as const };
    expect(parseSessionFrame(encodeSessionMessage(message))).toEqual({
      type: "message",
      message,
    });
  });
});

describe("quality profiles", () => {
  it("exposes increasing bitrate budgets for every preset", () => {
    expect(QUALITY_ORDER).toEqual(["smooth", "balanced", "sharp"]);
    const bitrates = QUALITY_ORDER.map((preset) => QUALITY_PROFILES[preset].maxBitrate);
    expect(bitrates[0]).toBeLessThan(bitrates[1]);
    expect(bitrates[1]).toBeLessThan(bitrates[2]);
    for (const preset of QUALITY_ORDER) {
      expect(QUALITY_PROFILES[preset].label.length).toBeGreaterThan(0);
      expect(QUALITY_PROFILES[preset].maxFramerate).toBeGreaterThan(0);
    }
  });
});
