export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const KEY_LENGTH = 10;
export const PBKDF2_ITERATIONS = 210_000;
export const KEY_HASH_BYTES = 32;
export const KEY_SALT_BYTES = 16;

export function normalizeKeyInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, KEY_LENGTH);
}

export function isCompleteKey(input: string): boolean {
  const key = normalizeKeyInput(input);
  if (key.length !== KEY_LENGTH) return false;
  for (const char of key) {
    if (!KEY_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function formatKey(input: string): string {
  const key = normalizeKeyInput(input);
  if (key.length <= 5) return key;
  return `${key.slice(0, 5)} ${key.slice(5)}`;
}

export function normalizeCodeInput(input: string): string {
  return input.replace(/\D/g, "").slice(0, 9);
}

export function isCompleteCode(input: string): boolean {
  return /^\d{9}$/.test(normalizeCodeInput(input));
}

export function formatCode(input: string): string {
  const code = normalizeCodeInput(input);
  const groups = code.match(/.{1,3}/g);
  return groups ? groups.join(" ") : "";
}

export function generateAccessKey(): string {
  const bytes = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let key = "";
  for (const byte of bytes) {
    key += KEY_ALPHABET[byte % KEY_ALPHABET.length];
  }
  return key;
}

export function generateSaltHex(): string {
  const bytes = new Uint8Array(KEY_SALT_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveKeyHash(key: string, saltHex: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeKeyInput(key)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    KEY_HASH_BYTES * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}
