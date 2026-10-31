import { randomBytes, randomInt, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const KEY_LENGTH = 10;
export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PBKDF2_ITERATIONS = 210_000;
export const PBKDF2_DIGEST = "sha256";
export const KEY_HASH_BYTES = 32;
export const KEY_SALT_BYTES = 16;

export function generateKey(length = KEY_LENGTH): string {
  let key = "";
  for (let i = 0; i < length; i += 1) {
    key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  }
  return key;
}

export function normalizeKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, KEY_LENGTH);
}

export function isWellFormedKey(input: string): boolean {
  const normalized = normalizeKey(input);
  if (normalized.length !== KEY_LENGTH) return false;
  for (const char of normalized) {
    if (!KEY_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function generateSaltHex(): string {
  return randomBytes(KEY_SALT_BYTES).toString("hex");
}

export function deriveKeyHash(key: string, saltHex: string): string {
  return pbkdf2Sync(
    normalizeKey(key),
    Buffer.from(saltHex, "hex"),
    PBKDF2_ITERATIONS,
    KEY_HASH_BYTES,
    PBKDF2_DIGEST,
  ).toString("hex");
}

export function timingSafeEqualHex(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  if (!/^[0-9a-f]+$/i.test(expectedHex) || !/^[0-9a-f]+$/i.test(providedHex)) {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function generateRemoteCode(): string {
  return String(randomInt(100_000_000, 1_000_000_000));
}

export function sanitizeName(input: string | undefined, fallback: string): string {
  const cleaned = (input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

export interface LoginGuardOptions {
  maxFailures?: number;
  failureWindowMs?: number;
  lockBaseMs?: number;
  lockMaxMs?: number;
  resetAfterMs?: number;
  globalMaxFailures?: number;
  globalWindowMs?: number;
  globalLockMs?: number;
}

export interface LoginGuardVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

interface LoginGuardEntry {
  failures: number[];
  strikes: number;
  lockedUntil: number;
  lastFailureAt: number;
}

const LOGIN_DEFAULTS = {
  maxFailures: 5,
  failureWindowMs: 10 * 60_000,
  lockBaseMs: 60_000,
  lockMaxMs: 30 * 60_000,
  resetAfterMs: 60 * 60_000,
  globalMaxFailures: 50,
  globalWindowMs: 10 * 60_000,
  globalLockMs: 60_000,
};

/**
 * Blocks repeated admin login failures per client and escalates the lockout.
 * A global budget also covers distributed attempts that rotate source IPs.
 */
export class LoginGuard {
  private readonly entries = new Map<string, LoginGuardEntry>();
  private globalFailures: number[] = [];
  private globalLockedUntil = 0;

  constructor(
    private readonly options: LoginGuardOptions = {},
    private readonly now: () => number = Date.now,
  ) {}

  private get maxFailures(): number {
    return Math.max(1, this.options.maxFailures ?? LOGIN_DEFAULTS.maxFailures);
  }

  check(key: string): LoginGuardVerdict {
    const now = this.now();
    const until = Math.max(this.entries.get(key)?.lockedUntil ?? 0, this.globalLockedUntil);
    if (until > now) return { allowed: false, retryAfterMs: until - now };
    return { allowed: true, retryAfterMs: 0 };
  }

  fail(key: string): LoginGuardVerdict {
    const now = this.now();
    const resetAfterMs = this.options.resetAfterMs ?? LOGIN_DEFAULTS.resetAfterMs;
    const failureWindowMs = this.options.failureWindowMs ?? LOGIN_DEFAULTS.failureWindowMs;
    let entry = this.entries.get(key);
    if (!entry || now - entry.lastFailureAt > resetAfterMs) {
      entry = { failures: [], strikes: 0, lockedUntil: 0, lastFailureAt: 0 };
    }
    entry.failures = entry.failures.filter((ts) => now - ts < failureWindowMs);
    entry.failures.push(now);
    entry.lastFailureAt = now;

    if (entry.failures.length >= this.maxFailures) {
      entry.strikes += 1;
      const lockMs = Math.min(
        (this.options.lockBaseMs ?? LOGIN_DEFAULTS.lockBaseMs) * 2 ** (entry.strikes - 1),
        this.options.lockMaxMs ?? LOGIN_DEFAULTS.lockMaxMs,
      );
      entry.lockedUntil = now + lockMs;
      entry.failures = [];
    }
    this.entries.set(key, entry);
    if (this.entries.size > 5000) this.prune(now);

    const globalWindowMs = this.options.globalWindowMs ?? LOGIN_DEFAULTS.globalWindowMs;
    this.globalFailures = this.globalFailures.filter((ts) => now - ts < globalWindowMs);
    this.globalFailures.push(now);
    if (this.globalFailures.length >= (this.options.globalMaxFailures ?? LOGIN_DEFAULTS.globalMaxFailures)) {
      this.globalLockedUntil = Math.max(
        this.globalLockedUntil,
        now + (this.options.globalLockMs ?? LOGIN_DEFAULTS.globalLockMs),
      );
      this.globalFailures = [];
    }

    return this.check(key);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    const idleMs = this.options.resetAfterMs ?? LOGIN_DEFAULTS.resetAfterMs;
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.lastFailureAt > idleMs) {
        this.entries.delete(key);
      }
    }
  }
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true when the call is allowed, false when the key is over budget. */
  hit(key: string): boolean {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart);
    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const alive = timestamps.filter((ts) => ts > windowStart);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }
}

export function timingSafeEqualString(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ConnectionGuardOptions {
  maxConnectionsPerIp?: number;
  maxTotalConnections?: number;
  messageLimit?: number;
  messageWindowMs?: number;
  banBaseMs?: number;
  banMaxMs?: number;
  now?: () => number;
  onBan?: (ip: string, reason: string, durationMs: number) => void;
}

interface BanRecord {
  until: number;
  strikes: number;
  lastAt: number;
}

const CONNECTION_DEFAULTS = {
  maxConnectionsPerIp: 8,
  maxTotalConnections: 400,
  messageLimit: 120,
  messageWindowMs: 10_000,
  banBaseMs: 10 * 60_000,
  banMaxMs: 24 * 60 * 60_000,
};

/**
 * Tracks WebSocket connections per source address, throttles message floods and
 * applies escalating temporary bans. Bans are memory-only so a restart clears them.
 */
export class ConnectionGuard {
  private readonly perIp = new Map<string, number>();
  private readonly messages = new Map<string, number[]>();
  private readonly bans = new Map<string, BanRecord>();
  private readonly now: () => number;
  private total = 0;

  constructor(private readonly options: ConnectionGuardOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private get maxPerIp(): number {
    return Math.max(1, this.options.maxConnectionsPerIp ?? CONNECTION_DEFAULTS.maxConnectionsPerIp);
  }

  private get maxTotal(): number {
    return Math.max(
      this.maxPerIp,
      this.options.maxTotalConnections ?? CONNECTION_DEFAULTS.maxTotalConnections,
    );
  }

  private get messageLimit(): number {
    return Math.max(10, this.options.messageLimit ?? CONNECTION_DEFAULTS.messageLimit);
  }

  check(ip: string): { allowed: boolean; reason: "banned" | "ip-limit" | "server-full" | null; retryAfterMs: number } {
    const now = this.now();
    const ban = this.bans.get(ip);
    if (ban && ban.until > now) {
      return { allowed: false, reason: "banned", retryAfterMs: ban.until - now };
    }
    if ((this.perIp.get(ip) ?? 0) >= this.maxPerIp) {
      return { allowed: false, reason: "ip-limit", retryAfterMs: 0 };
    }
    if (this.total >= this.maxTotal) {
      return { allowed: false, reason: "server-full", retryAfterMs: 0 };
    }
    return { allowed: true, reason: null, retryAfterMs: 0 };
  }

  connect(ip: string): void {
    this.total += 1;
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
  }

  disconnect(ip: string): void {
    this.total = Math.max(0, this.total - 1);
    const count = (this.perIp.get(ip) ?? 0) - 1;
    if (count <= 0) this.perIp.delete(ip);
    else this.perIp.set(ip, count);
  }

  /** Returns false when this IP exceeded its message budget and was banned. */
  allowMessage(ip: string): boolean {
    const now = this.now();
    const ban = this.bans.get(ip);
    if (ban && ban.until > now) return false;
    const windowMs = this.options.messageWindowMs ?? CONNECTION_DEFAULTS.messageWindowMs;
    const timestamps = (this.messages.get(ip) ?? []).filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    if (timestamps.length > this.messageLimit) {
      this.messages.delete(ip);
      this.ban(ip, "message-flood");
      return false;
    }
    this.messages.set(ip, timestamps);
    if (this.messages.size > 5000) this.prune(now);
    return true;
  }

  ban(ip: string, reason: string): number {
    const now = this.now();
    const previous = this.bans.get(ip);
    const fresh = !previous || now - previous.lastAt > 60 * 60_000;
    const strikes = fresh ? 1 : previous.strikes + 1;
    const base = this.options.banBaseMs ?? CONNECTION_DEFAULTS.banBaseMs;
    const max = this.options.banMaxMs ?? CONNECTION_DEFAULTS.banMaxMs;
    const duration = Math.min(base * 2 ** (strikes - 1), max);
    this.bans.set(ip, { until: now + duration, strikes, lastAt: now });
    if (this.bans.size > 5000) this.prune(now);
    this.options.onBan?.(ip, reason, duration);
    return duration;
  }

  banned(ip: string): { banned: boolean; retryAfterMs: number } {
    const ban = this.bans.get(ip);
    if (!ban) return { banned: false, retryAfterMs: 0 };
    const remain = ban.until - this.now();
    return remain > 0 ? { banned: true, retryAfterMs: remain } : { banned: false, retryAfterMs: 0 };
  }

  stats(): { connections: number; trackedIps: number; activeBans: number } {
    const now = this.now();
    let activeBans = 0;
    for (const ban of this.bans.values()) {
      if (ban.until > now) activeBans += 1;
    }
    return { connections: this.total, trackedIps: this.perIp.size, activeBans };
  }

  private prune(now: number): void {
    const windowMs = this.options.messageWindowMs ?? CONNECTION_DEFAULTS.messageWindowMs;
    for (const [ip, timestamps] of this.messages) {
      if (timestamps.every((ts) => now - ts >= windowMs)) this.messages.delete(ip);
    }
    for (const [ip, ban] of this.bans) {
      if (ban.until <= now && now - ban.lastAt > 60 * 60_000) this.bans.delete(ip);
    }
  }
}

/**
 * JSON-lines security log for fail2ban/journal integration. Each line starts with
 * stable keys (ts, event, ip) so offline filters can match without parsing order.
 */
export class SecurityLogWriter {
  constructor(
    private readonly filePath: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return Boolean(this.filePath);
  }

  write(event: string, ip: string, meta: Record<string, unknown> = {}): void {
    if (!this.filePath) return;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o750 });
      const line = JSON.stringify({
        ts: new Date(this.now()).toISOString(),
        event,
        ip,
        ...meta,
      });
      appendFileSync(this.filePath, `${line}\n`, { encoding: "utf8", mode: 0o640 });
    } catch {
      // Security logging must never take the server down.
    }
  }
}
