import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";

const salt = "a".repeat(32);
const hash = "b".repeat(64);

describe("parseClientMessage", () => {
  it("parses a client hello and normalizes optional fields", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "client.hello",
        deviceId: "0b6f4f6e-3a2b-4c1d-9e8f-1234567890ab",
        deviceName: "Office PC",
        platform: "win32",
        version: "0.2.0",
        inviteCode: "ABCD-2345",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.message.type !== "client.hello") throw new Error("wrong type");
    expect(result.message.deviceId).toBe("0b6f4f6e-3a2b-4c1d-9e8f-1234567890ab");
    expect(result.message.inviteCode).toBe("ABCD-2345");
    expect(result.message.platform).toBe("win32");
  });

  it("rejects malformed client hello fields", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: "client.hello", deviceId: "x", deviceName: "PC", version: "1.0" }),
      ),
    ).toEqual({ ok: false, error: "invalid-device-id" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "client.hello", deviceId: "device-123456", deviceName: "", version: "1.0" }),
      ),
    ).toEqual({ ok: false, error: "invalid-name" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "client.hello", deviceId: "device-123456", deviceName: "PC", version: "1.0 beta" }),
      ),
    ).toEqual({ ok: false, error: "invalid-version" });
  });

  it("accepts a host registration and normalizes hex case", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "host.register",
        requestedCode: "123456789",
        keySalt: salt.toUpperCase(),
        keyHash: hash.toUpperCase(),
        deviceName: "Office PC",
        platform: "win32",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.message.type !== "host.register") throw new Error("wrong type");
    expect(result.message.keySalt).toBe(salt);
    expect(result.message.keyHash).toBe(hash);
    expect(result.message.requestedCode).toBe("123456789");
    expect(result.message.deviceName).toBe("Office PC");
    expect(result.message.platform).toBe("win32");
  });

  it("rejects invalid JSON and unknown types", () => {
    expect(parseClientMessage("{")).toEqual({ ok: false, error: "invalid-json" });
    expect(parseClientMessage("[]")).toEqual({ ok: false, error: "invalid-message" });
    expect(parseClientMessage(JSON.stringify({ type: "nope" }))).toEqual({
      ok: false,
      error: "unknown-type",
    });
  });

  it("validates salts, hashes, codes and names", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: "host.register", keySalt: "zz", keyHash: hash, deviceName: "PC" }),
      ),
    ).toEqual({ ok: false, error: "invalid-salt" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "host.register", keySalt: salt, keyHash: "b", deviceName: "PC" }),
      ),
    ).toEqual({ ok: false, error: "invalid-hash" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "host.register", keySalt: salt, keyHash: hash, deviceName: "  " }),
      ),
    ).toEqual({ ok: false, error: "invalid-name" });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "host.register",
          keySalt: salt,
          keyHash: hash,
          deviceName: "PC",
          requestedCode: "1234",
        }),
      ),
    ).toEqual({ ok: false, error: "invalid-code" });
  });

  it("parses controller lookup and connect", () => {
    const lookup = parseClientMessage(JSON.stringify({ type: "controller.lookup", code: "123456789" }));
    expect(lookup.ok).toBe(true);

    const connect = parseClientMessage(
      JSON.stringify({
        type: "controller.connect",
        code: "123456789",
        keyHash: hash,
        controllerName: "Phone",
      }),
    );
    expect(connect.ok).toBe(true);
    if (!connect.ok) return;
    if (connect.message.type !== "controller.connect") throw new Error("wrong type");
    expect(connect.message.platform).toBe("unknown");
  });

  it("rejects malformed controller codes", () => {
    expect(parseClientMessage(JSON.stringify({ type: "controller.lookup", code: 123 }))).toEqual({
      ok: false,
      error: "invalid-code",
    });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "controller.connect",
          code: "12345",
          keyHash: hash,
          controllerName: "Phone",
        }),
      ),
    ).toEqual({ ok: false, error: "invalid-code" });
  });

  it("rejects oversized or non-object signal payloads", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "signal", data: [1, 2] })),
    ).toEqual({ ok: false, error: "invalid-signal" });
    expect(parseClientMessage(JSON.stringify({ type: "signal", data: "sdp" }))).toEqual({
      ok: false,
      error: "invalid-signal",
    });
    const huge = JSON.stringify({ type: "signal", data: { sdp: "x".repeat(70 * 1024) } });
    expect(parseClientMessage(huge)).toEqual({ ok: false, error: "signal-too-large" });
  });

  it("parses control messages", () => {
    for (const type of [
      "host.unregister",
      "host.heartbeat",
      "controller.disconnect",
      "ping",
    ] as const) {
      expect(parseClientMessage(JSON.stringify({ type }))).toEqual({
        ok: true,
        message: { type },
      });
    }
  });

  it("parses resource publishing, control requests and tokens", () => {
    const publish = parseClientMessage(
      JSON.stringify({ type: "host.publish", published: true, note: " 晚间可用 " }),
    );
    expect(publish).toEqual({
      ok: true,
      message: { type: "host.publish", published: true, note: "晚间可用" },
    });

    const decision = parseClientMessage(
      JSON.stringify({
        type: "host.control-decision",
        requestId: "0b6f4f6e-3a2b-4c1d-9e8f-1234567890ab",
        accept: false,
      }),
    );
    expect(decision.ok).toBe(true);

    const request = parseClientMessage(
      JSON.stringify({
        type: "controller.request",
        hostDeviceId: "0b6f4f6e-3a2b-4c1d-9e8f-1234567890ab",
      }),
    );
    expect(request.ok).toBe(true);

    const token = "c".repeat(64);
    const connect = parseClientMessage(
      JSON.stringify({
        type: "controller.connect-token",
        token: token.toUpperCase(),
        controllerName: "Phone",
        platform: "win32",
      }),
    );
    expect(connect.ok).toBe(true);
    if (!connect.ok) return;
    if (connect.message.type !== "controller.connect-token") throw new Error("wrong type");
    expect(connect.message.token).toBe(token);
    expect(connect.message.platform).toBe("win32");
  });

  it("rejects invalid publish, decision, request and token payloads", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "host.publish", published: "yes" })),
    ).toEqual({ ok: false, error: "invalid-publish" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "host.publish", published: true, note: "x".repeat(121) }),
      ),
    ).toEqual({ ok: false, error: "invalid-note" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "host.control-decision", requestId: "x", accept: true }),
      ),
    ).toEqual({ ok: false, error: "invalid-request-id" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "controller.request", hostDeviceId: "short" }),
      ),
    ).toEqual({ ok: false, error: "invalid-device-id" });
    expect(
      parseClientMessage(
        JSON.stringify({ type: "controller.connect-token", token: "abc", controllerName: "Phone" }),
      ),
    ).toEqual({ ok: false, error: "invalid-token" });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "controller.connect-token",
          token: "c".repeat(64),
          controllerName: " ",
        }),
      ),
    ).toEqual({ ok: false, error: "invalid-name" });
  });
});
