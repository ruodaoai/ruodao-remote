import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KEY_ALPHABET,
  KEY_HASH_BYTES,
  PBKDF2_ITERATIONS,
  deriveKeyHash,
  formatCode,
  formatKey,
  generateAccessKey,
  generateSaltHex,
  isCompleteCode,
  isCompleteKey,
  normalizeCodeInput,
  normalizeKeyInput,
} from "../src/lib/key";

describe("access key", () => {
  it("matches Node PBKDF2-SHA256 byte for byte", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const key = "ABCDE23456";
    const expected = pbkdf2Sync(
      key,
      Buffer.from(salt, "hex"),
      PBKDF2_ITERATIONS,
      KEY_HASH_BYTES,
      "sha256",
    ).toString("hex");
    await expect(deriveKeyHash(key, salt)).resolves.toBe(expected);
  });

  it("normalizes case and separators but keeps the alphabet intact", () => {
    expect(normalizeKeyInput("abcde-fghij")).toBe("ABCDEFGHIJ");
    expect(normalizeKeyInput("abcd efgh ijkl")).toBe("ABCDEFGHIJ");
    expect(normalizeKeyInput("abc0o1i2345")).toBe("ABC0O1I234");
    expect(isCompleteKey("abc0o1i2345")).toBe(false);
  });

  it("accepts only complete keys from the alphabet", () => {
    expect(isCompleteKey("ABCDE 23456")).toBe(true);
    expect(isCompleteKey("ABCDE2345")).toBe(false);
    expect(isCompleteKey("ABCDE2345O")).toBe(false);
  });

  it("formats keys in two groups of five", () => {
    expect(formatKey("ABCDE23456")).toBe("ABCDE 23456");
    expect(formatKey("ABC")).toBe("ABC");
  });

  it("generates keys from the configured alphabet", () => {
    for (let index = 0; index < 40; index += 1) {
      const key = generateAccessKey();
      expect(key).toHaveLength(10);
      for (const char of key) expect(KEY_ALPHABET).toContain(char);
    }
  });

  it("generates 16-byte hex salts", () => {
    const salt = generateSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSaltHex()).not.toBe(salt);
  });
});

describe("remote code", () => {
  it("keeps nine digits and ignores formatting", () => {
    expect(normalizeCodeInput("123 456 789")).toBe("123456789");
    expect(normalizeCodeInput("123-456-7890")).toBe("123456789");
    expect(normalizeCodeInput("12a34b56")).toBe("123456");
    expect(isCompleteCode("123 456 789")).toBe(true);
    expect(isCompleteCode("123 456 78")).toBe(false);
  });

  it("formats codes in three groups", () => {
    expect(formatCode("123456789")).toBe("123 456 789");
    expect(formatCode("12345")).toBe("123 45");
  });
});
