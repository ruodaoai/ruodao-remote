import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export function hashAdminPassword(password: string): string {
  if (password.length < 8) {
    throw new Error("管理员密码至少需要 8 位");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

function parsePasswordHash(stored: string): {
  salt: Buffer;
  hash: Buffer;
} | null {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const hash = Buffer.from(parts[5], "base64url");
    if (salt.length < 8 || hash.length !== KEY_BYTES) return null;
    return { salt, hash };
  } catch {
    return null;
  }
}

export function verifyAdminPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const candidate = scryptSync(password, parsed.salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(candidate, parsed.hash);
}

export function isPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== null;
}

interface TokenPayload {
  v: 1;
  exp: number;
  iat: number;
  jti: string;
}

export interface AdminSession {
  token: string;
  expiresAt: number;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export class AdminAuth {
  private readonly secret = randomBytes(32);
  private readonly ttlMs: number;

  constructor(
    private readonly passwordHash: string | null,
    options: { ttlMs?: number } = {},
  ) {
    this.ttlMs = Math.max(60_000, options.ttlMs ?? DEFAULT_TTL_MS);
  }

  get configured(): boolean {
    return Boolean(this.passwordHash);
  }

  login(password: string): AdminSession | null {
    if (!verifyAdminPassword(password, this.passwordHash)) return null;
    const now = Date.now();
    const payload: TokenPayload = {
      v: 1,
      iat: now,
      exp: now + this.ttlMs,
      jti: randomBytes(12).toString("base64url"),
    };
    const body = encodeBase64Url(JSON.stringify(payload));
    const unsigned = `v1.${body}`;
    const signature = this.sign(unsigned);
    return { token: `${unsigned}.${signature}`, expiresAt: payload.exp };
  }

  verify(token: string | undefined | null): TokenPayload | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(this.sign(unsigned));
    const provided = Buffer.from(parts[2]);
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      ) as TokenPayload;
      if (payload.v !== 1 || typeof payload.exp !== "number") return null;
      if (payload.exp <= Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private sign(unsigned: string): string {
    return createHmac("sha256", this.secret).update(unsigned).digest("base64url");
  }
}
