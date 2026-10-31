import { app, shell } from "electron";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface SessionLogDangerEvent {
  at: number;
  action: string;
  label: string;
}

export interface SessionLogEntry {
  id: string;
  recordedAt: number;
  startedAt: number;
  durationMs: number;
  role: "host" | "controller";
  peerName: string;
  peerIp: string | null;
  peerPlatform: string;
  sessionId: string;
  reason: string;
  dangerEvents: SessionLogDangerEvent[];
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_DANGER_EVENTS = 50;

function logFile(): string {
  return path.join(app.getPath("userData"), "session-log.jsonl");
}

function logFolder(): string {
  return app.getPath("userData");
}

function clampText(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function safeTimestamp(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, Date.now() + 60_000);
}

function sanitizeDangerEvents(value: unknown): SessionLogDangerEvent[] {
  if (!Array.isArray(value)) return [];
  const events: SessionLogDangerEvent[] = [];
  for (const item of value.slice(-MAX_DANGER_EVENTS)) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const action = clampText(raw.action, 32);
    if (!/^[a-z0-9-]{1,32}$/.test(action)) continue;
    events.push({
      at: safeTimestamp(raw.at, Date.now()),
      action,
      label: clampText(raw.label, 80, action),
    });
  }
  return events;
}

function sanitizeEntry(value: unknown): SessionLogEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("会话日志格式不正确");
  }
  const raw = value as Record<string, unknown>;
  const startedAt = safeTimestamp(raw.startedAt, Date.now());
  const durationMs = Math.max(0, Math.min(Number(raw.durationMs) || 0, 7 * 24 * 3600 * 1000));
  const role = raw.role === "host" ? "host" : "controller";
  return {
    id: clampText(raw.id, 80, randomUUID()),
    recordedAt: Date.now(),
    startedAt,
    durationMs,
    role,
    peerName: clampText(raw.peerName, 64, "未知用户"),
    peerIp: clampText(raw.peerIp, 64) || null,
    peerPlatform: clampText(raw.peerPlatform, 20, "unknown"),
    sessionId: clampText(raw.sessionId, 80, "-"),
    reason: clampText(raw.reason, 40, "ended"),
    dangerEvents: sanitizeDangerEvents(raw.dangerEvents),
  };
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < MAX_FILE_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // Rotation is best effort; appending keeps working either way.
  }
}

export function appendSessionLog(value: unknown): { ok: true; entry: SessionLogEntry } {
  const entry = sanitizeEntry(value);
  const file = logFile();
  mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ok: true, entry };
}

export function listSessionLogs(limit: unknown): SessionLogEntry[] {
  const max = Math.max(1, Math.min(Number(limit) || 200, MAX_LIST_ENTRIES));
  const file = logFile();
  if (!existsSync(file)) return [];
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: SessionLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as SessionLogEntry);
    } catch {
      // Skip corrupted lines instead of failing the whole log.
    }
  }
  return entries.slice(-max).reverse();
}

export async function openSessionLogFolder(): Promise<{ ok: boolean; error?: string }> {
  const folder = logFolder();
  mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  return error ? { ok: false, error } : { ok: true };
}
