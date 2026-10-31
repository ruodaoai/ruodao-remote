import { describe, expect, it } from "vitest";
import {
  KEY_ALPHABET,
  LoginGuard,
  RateLimiter,
  deriveKeyHash,
  generateKey,
  generateRemoteCode,
  generateSaltHex,
  isWellFormedKey,
  normalizeKey,
  sanitizeName,
  timingSafeEqualHex,
} from "../src/security";

describe("keys", () => {
  it("generates a 10 character key from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const key = generateKey();
      expect(key).toHaveLength(10);
      for (const char of key) {
        expect(KEY_ALPHABET).toContain(char);
      }
    }
  });

  it("normalizes separators and case", () => {
    expect(normalizeKey("abcd-efgh-jk")).toBe("ABCDEFGHJK");
    expect(normalizeKey(" abcd efgh jk ")).toBe("ABCDEFGHJK");
  });

  it("rejects malformed keys", () => {
    expect(isWellFormedKey("ABCDEFGHJK")).toBe(true);
    expect(isWellFormedKey("ABCD-EFGH-JK")).toBe(true);
    expect(isWellFormedKey("ABCDEFGHJ")).toBe(false);
    expect(isWellFormedKey("ABCDEFGHJ0")).toBe(false);
    expect(isWellFormedKey("ABCDEFGHJO")).toBe(false);
    expect(isWellFormedKey("")).toBe(false);
  });
});

describe("salts and hashes", () => {
  it("creates 16 byte lowercase hex salts", () => {
    const salt = generateSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSaltHex()).not.toBe(salt);
  });

  it("derives a stable 32 byte hash per key and salt", () => {
    const salt = generateSaltHex();
    const first = deriveKeyHash("ABCDEFGHJK", salt);
    const second = deriveKeyHash("abcd-efgh-jk", salt);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const otherSalt = generateSaltHex();
    expect(deriveKeyHash("ABCDEFGHJK", otherSalt)).not.toBe(first);
    expect(deriveKeyHash("ABCDEFGHJL", salt)).not.toBe(first);
  });

  it("compares hashes with constant time semantics", () => {
    const salt = generateSaltHex();
    const hash = deriveKeyHash("ABCDEFGHJK", salt);
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
    expect(timingSafeEqualHex(hash, hash.toUpperCase())).toBe(true);
    expect(timingSafeEqualHex(hash, deriveKeyHash("ABCDEFGHJL", salt))).toBe(false);
    expect(timingSafeEqualHex(hash, "not-hex")).toBe(false);
    expect(timingSafeEqualHex(hash, hash.slice(0, 62))).toBe(false);
  });
});

describe("remote codes", () => {
  it("generates nine digit codes without a leading zero", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateRemoteCode()).toMatch(/^[1-9]\d{8}$/);
    }
  });
});

describe("sanitizeName", () => {
  it("strips control characters and enforces a fallback", () => {
    expect(sanitizeName("  My PC ", "fallback")).toBe("My PC");
    expect(sanitizeName("a\u0000b", "fallback")).toBe("ab");
    expect(sanitizeName("   ", "fallback")).toBe("fallback");
    expect(sanitizeName(undefined, "fallback")).toBe("fallback");
    expect(sanitizeName("x".repeat(200), "fallback")).toHaveLength(64);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit inside the window and recovers afterwards", () => {
    let now = 1_000;
    const limiter = new RateLimiter(2, 1_000, () => now);
    expect(limiter.hit("ip")).toBe(true);
    expect(limiter.hit("ip")).toBe(true);
    expect(limiter.hit("ip")).toBe(false);
    now += 1_001;
    expect(limiter.hit("ip")).toBe(true);
    expect(limiter.hit("other")).toBe(true);
  });
});

describe("LoginGuard", () => {
  it("locks a client after repeated failures and releases after the backoff", () => {
    let now = 0;
    const guard = new LoginGuard(
      { maxFailures: 3, lockBaseMs: 1_000, lockMaxMs: 8_000, failureWindowMs: 60_000 },
      () => now,
    );

    expect(guard.fail("ip").allowed).toBe(true);
    expect(guard.fail("ip").allowed).toBe(true);
    expect(guard.check("ip").allowed).toBe(true);

    const locked = guard.fail("ip");
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterMs).toBe(1_000);
    expect(guard.check("other").allowed).toBe(true);

    now += 999;
    expect(guard.check("ip").allowed).toBe(false);
    now += 2;
    expect(guard.check("ip").allowed).toBe(true);
  });

  it("escalates the lockout and clears it on a successful login", () => {
    let now = 0;
    const guard = new LoginGuard(
      { maxFailures: 2, lockBaseMs: 1_000, lockMaxMs: 60_000, failureWindowMs: 60_000 },
      () => now,
    );

    guard.fail("ip");
    expect(guard.fail("ip").retryAfterMs).toBe(1_000);
    now += 1_001;
    guard.fail("ip");
    expect(guard.fail("ip").retryAfterMs).toBe(2_000);

    now += 2_001;
    guard.succeed("ip");
    guard.fail("ip");
    const verdict = guard.fail("ip");
    expect(verdict.retryAfterMs).toBe(1_000);
  });

  it("applies a global lock when failures rotate across many clients", () => {
    let now = 0;
    const guard = new LoginGuard(
      {
        maxFailures: 2,
        globalMaxFailures: 4,
        globalLockMs: 5_000,
        lockBaseMs: 1_000,
        failureWindowMs: 60_000,
      },
      () => now,
    );

    guard.fail("a");
    guard.fail("b");
    guard.fail("c");
    expect(guard.check("d").allowed).toBe(true);
    guard.fail("d");
    expect(guard.check("fresh-ip").allowed).toBe(false);
    now += 5_001;
    expect(guard.check("fresh-ip").allowed).toBe(true);
  });
});
