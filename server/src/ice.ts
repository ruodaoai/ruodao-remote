import { createHmac } from "node:crypto";
import type { IceServer } from "./protocol";

export const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

export interface IceOptions {
  stunUrls: string[];
  turnUrls: string[];
  turnSecret: string;
  turnTtlSeconds: number;
}

export function parseIceEnv(env: NodeJS.ProcessEnv): IceOptions {
  const splitList = (value: string | undefined): string[] =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const stunUrls = splitList(env.STUN_URLS);
  const turnTtl = Number(env.TURN_TTL_SECONDS);
  return {
    stunUrls: stunUrls.length > 0 ? stunUrls : [...DEFAULT_STUN_URLS],
    turnUrls: splitList(env.TURN_URLS),
    turnSecret: (env.TURN_SECRET ?? "").trim(),
    turnTtlSeconds: Number.isFinite(turnTtl) && turnTtl > 0 ? turnTtl : 3600,
  };
}

export function buildIceServers(
  options: IceOptions,
  identity: string,
): IceServer[] {
  const servers: IceServer[] = [];
  if (options.stunUrls.length > 0) {
    servers.push({ urls: [...options.stunUrls] });
  }
  if (options.turnUrls.length > 0 && options.turnSecret) {
    const ttl = Math.max(60, Math.floor(options.turnTtlSeconds));
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const safeIdentity = identity.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 48) || "user";
    const username = `${expiry}:${safeIdentity}`;
    const credential = createHmac("sha1", options.turnSecret)
      .update(username)
      .digest("base64");
    servers.push({ urls: [...options.turnUrls], username, credential });
  }
  return servers;
}
