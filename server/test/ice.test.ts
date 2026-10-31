import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_STUN_URLS, buildIceServers, parseIceEnv } from "../src/ice";

describe("parseIceEnv", () => {
  it("falls back to public STUN servers", () => {
    const ice = parseIceEnv({});
    expect(ice.stunUrls).toEqual(DEFAULT_STUN_URLS);
    expect(ice.turnUrls).toEqual([]);
    expect(ice.turnSecret).toBe("");
    expect(ice.turnTtlSeconds).toBe(3600);
  });

  it("parses comma separated lists and ttl", () => {
    const ice = parseIceEnv({
      STUN_URLS: "stun:a.example:3478, stun:b.example:3478",
      TURN_URLS: "turn:a.example:3478?transport=udp",
      TURN_SECRET: "secret",
      TURN_TTL_SECONDS: "600",
    });
    expect(ice.stunUrls).toEqual(["stun:a.example:3478", "stun:b.example:3478"]);
    expect(ice.turnUrls).toEqual(["turn:a.example:3478?transport=udp"]);
    expect(ice.turnTtlSeconds).toBe(600);
  });
});

describe("buildIceServers", () => {
  it("returns STUN only when TURN is not configured", () => {
    const servers = buildIceServers(
      { stunUrls: ["stun:example.org"], turnUrls: [], turnSecret: "", turnTtlSeconds: 3600 },
      "host-123",
    );
    expect(servers).toEqual([{ urls: ["stun:example.org"] }]);
  });

  it("issues time limited TURN REST credentials", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const servers = buildIceServers(
      {
        stunUrls: ["stun:example.org"],
        turnUrls: ["turn:turn.example.org:3478"],
        turnSecret: "unit-test-secret",
        turnTtlSeconds: 600,
      },
      "controller-abc",
    );
    const turn = servers.find((server) => JSON.stringify(server.urls).includes("turn"));
    expect(turn?.username).toBeDefined();
    expect(turn?.credential).toBeDefined();
    const [expiry, identity] = String(turn?.username).split(":");
    expect(identity).toBe("controller-abc");
    expect(Number(expiry)).toBeGreaterThanOrEqual(nowSeconds + 540);
    const expected = createHmac("sha1", "unit-test-secret")
      .update(String(turn?.username))
      .digest("base64");
    expect(turn?.credential).toBe(expected);
  });

  it("sanitizes the TURN identity", () => {
    const servers = buildIceServers(
      {
        stunUrls: [],
        turnUrls: ["turn:turn.example.org:3478"],
        turnSecret: "s",
        turnTtlSeconds: 60,
      },
      "bad:identity with spaces",
    );
    expect(servers[0]?.username?.endsWith(":badidentitywithspaces")).toBe(true);
  });
});
