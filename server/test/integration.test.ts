import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRemoteServer, type RemoteServer } from "../src/server";
import type { RegistrationMode, ServerMessage } from "../src/protocol";
import type { ServerPolicy } from "../src/store";
import { deriveKeyHash, generateSaltHex } from "../src/security";
import type { LoginGuardOptions } from "../src/security";
import type { ServerUpdateOptions } from "../src/update";

type MessageOf<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

class TestClient {
  private buffer: ServerMessage[] = [];
  private waiters: Array<{
    match: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.deliver(JSON.parse(data.toString()) as ServerMessage);
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once("open", () => resolve(new TestClient(ws)));
      ws.once("error", reject);
    });
  }

  next<T extends ServerMessage["type"]>(
    type: T,
    predicate?: (message: MessageOf<T>) => boolean,
  ): Promise<MessageOf<T>> {
    const match = (message: ServerMessage) =>
      message.type === type && (!predicate || predicate(message as MessageOf<T>));
    const index = this.buffer.findIndex(match);
    if (index >= 0) {
      const [message] = this.buffer.splice(index, 1);
      return Promise.resolve(message as MessageOf<T>);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve: resolve as (message: ServerMessage) => void,
        reject,
        timer: setTimeout(() => {
          const position = this.waiters.indexOf(waiter);
          if (position >= 0) this.waiters.splice(position, 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 5000),
      };
      this.waiters.push(waiter);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.close();
  }

  private deliver(message: ServerMessage): void {
    const index = this.waiters.findIndex((waiter) => waiter.match(message));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    this.buffer.push(message);
  }
}

const servers: RemoteServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients) {
    try {
      client.close();
    } catch {
      // already closed
    }
  }
  clients.length = 0;
  for (const server of servers) {
    await server.close();
  }
  servers.length = 0;
});

interface StartOptions {
  maxAttemptsPerMinute?: number;
  registrationMode?: RegistrationMode;
  adminPassword?: string;
  adminLoginGuard?: LoginGuardOptions;
  controlRequestTtlMs?: number;
  controlTokenTtlMs?: number;
  healthToken?: string;
  adminPath?: string;
  update?: Omit<ServerUpdateOptions, "log">;
  policy?: Partial<ServerPolicy>;
}

async function startServer(options: StartOptions = {}): Promise<RemoteServer> {
  const server = createRemoteServer({
    host: "127.0.0.1",
    port: 0,
    maxAttemptsPerMinute: options.maxAttemptsPerMinute ?? 10,
    registrationMode: options.registrationMode ?? "open",
    adminPassword: options.adminPassword,
    adminLoginGuard: options.adminLoginGuard,
    dataFile: null,
    ice: { stunUrls: ["stun:test.invalid"], turnUrls: [], turnSecret: "", turnTtlSeconds: 60 },
    controlRequestTtlMs: options.controlRequestTtlMs,
    controlTokenTtlMs: options.controlTokenTtlMs,
    healthToken: options.healthToken,
    adminPath: options.adminPath,
    policy: options.policy,
    securityLogFile: null,
    update: options.update,
  });
  servers.push(server);
  await server.listen();
  return server;
}

function portOf(server: RemoteServer): number {
  const address = server.httpServer.address();
  if (typeof address !== "object" || !address) throw new Error("server not listening");
  return address.port;
}

async function connectClient(port: number): Promise<TestClient> {
  const client = await TestClient.connect(port);
  clients.push(client);
  return client;
}

interface HelloOptions {
  deviceId?: string;
  name?: string;
  inviteCode?: string;
  expectRejection?: boolean;
}

async function sendHello(client: TestClient, options: HelloOptions = {}) {
  client.send({
    type: "client.hello",
    deviceId: options.deviceId ?? randomUUID(),
    deviceName: options.name ?? "Test Device",
    platform: "win32",
    version: "0.2.0",
    inviteCode: options.inviteCode,
  });
  if (options.expectRejection) {
    return client.next("client.rejected");
  }
  return client.next("client.welcome");
}

async function registerHost(
  port: number,
  key = "ABCDEFGHJK",
  deviceName = "Test Host",
  deviceId = randomUUID(),
) {
  const client = await connectClient(port);
  await sendHello(client, { name: deviceName, deviceId });
  const keySalt = generateSaltHex();
  const keyHash = deriveKeyHash(key, keySalt);
  client.send({
    type: "host.register",
    keySalt,
    keyHash,
    deviceName,
    platform: "win32",
  });
  const registered = await client.next("host.registered");
  return { client, keySalt, keyHash, code: registered.code, deviceId };
}

async function connectController(port: number, name = "Phone", deviceId = randomUUID()) {
  const client = await connectClient(port);
  await sendHello(client, { name, deviceId });
  return client;
}

async function adminLogin(port: number, password: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

function adminHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("signaling flow", () => {
  it("pairs a controller with code and key, relays signals, and reports disconnect", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port);
    expect(host.code).toMatch(/^\d{9}$/);

    const controller = await connectController(port);
    controller.send({ type: "controller.lookup", code: host.code });
    const challenge = await controller.next("controller.challenge");
    expect(challenge.keySalt).toBe(host.keySalt);
    expect(challenge.host.name).toBe("Test Host");

    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Phone",
      platform: "win32",
    });

    const paired = await controller.next("controller.paired");
    const hostPaired = await host.client.next("host.paired");
    expect(paired.sessionId).toBe(hostPaired.sessionId);
    expect(hostPaired.controller.name).toBe("Phone");
    expect(paired.iceServers[0]?.urls).toEqual(["stun:test.invalid"]);

    controller.send({ type: "signal", data: { kind: "offer", sdp: "v=0-a" } });
    const offer = await host.client.next("signal");
    expect(offer.data).toEqual({ kind: "offer", sdp: "v=0-a" });

    host.client.send({ type: "signal", data: { kind: "answer", sdp: "v=0-b" } });
    const answer = await controller.next("signal");
    expect(answer.data).toEqual({ kind: "answer", sdp: "v=0-b" });

    controller.send({ type: "controller.disconnect" });
    const left = await host.client.next("peer.left");
    expect(left.reason).toBe("controller-left");

    controller.send({ type: "controller.lookup", code: host.code });
    const secondChallenge = await controller.next("controller.challenge");
    expect(secondChallenge.keySalt).toBe(host.keySalt);
  });

  it("rejects a wrong key, a busy host, and signals outside a session", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port);

    const first = await connectController(port, "First");
    first.send({ type: "controller.lookup", code: host.code });
    await first.next("controller.challenge");
    first.send({
      type: "controller.connect",
      code: host.code,
      keyHash: deriveKeyHash("WRONGWRONG", host.keySalt),
      controllerName: "First",
    });
    const rejected = await first.next("controller.rejected");
    expect(rejected.reason).toBe("invalid-key");

    first.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "First",
    });
    await first.next("controller.paired");
    await host.client.next("host.paired");

    const second = await connectController(port, "Second");
    second.send({ type: "controller.lookup", code: host.code });
    await second.next("controller.challenge");
    second.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Second",
    });
    const busy = await second.next("controller.rejected");
    expect(busy.reason).toBe("busy");

    second.send({ type: "signal", data: { kind: "offer" } });
    const error = await second.next("error");
    expect(error.code).toBe("not-in-session");

    first.close();
  });

  it("drops the session when the key is rotated and rejects the old key", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port);

    const controller = await connectController(port);
    controller.send({ type: "controller.lookup", code: host.code });
    await controller.next("controller.challenge");
    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Phone",
    });
    await controller.next("controller.paired");
    await host.client.next("host.paired");

    const newSalt = generateSaltHex();
    const newHash = deriveKeyHash("NEWKEYWXYZ", newSalt);
    host.client.send({ type: "host.update-key", keySalt: newSalt, keyHash: newHash });
    await host.client.next("host.key-updated");
    const left = await controller.next("peer.left");
    expect(left.reason).toBe("key-rotated");

    controller.send({ type: "controller.lookup", code: host.code });
    const challenge = await controller.next("controller.challenge");
    expect(challenge.keySalt).toBe(newSalt);

    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Phone",
    });
    expect((await controller.next("controller.rejected")).reason).toBe("invalid-key");

    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: newHash,
      controllerName: "Phone",
    });
    await controller.next("controller.paired");
  });

  it("notifies the controller when the host goes offline and stops resolving its code", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port);
    const controller = await connectController(port);

    controller.send({ type: "controller.lookup", code: host.code });
    await controller.next("controller.challenge");
    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Phone",
    });
    await controller.next("controller.paired");
    await host.client.next("host.paired");

    host.client.close();
    const left = await controller.next("peer.left");
    expect(left.reason).toBe("host-closed");

    controller.send({ type: "controller.lookup", code: host.code });
    expect((await controller.next("controller.rejected")).reason).toBe("not-found");
  });

  it("rate limits repeated key attempts", async () => {
    const server = await startServer({ maxAttemptsPerMinute: 3 });
    const port = portOf(server);
    const host = await registerHost(port);
    const controller = await connectController(port);
    controller.send({ type: "controller.lookup", code: host.code });
    await controller.next("controller.challenge");

    const reasons: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      controller.send({
        type: "controller.connect",
        code: host.code,
        keyHash: deriveKeyHash("WRONGWRONG", host.keySalt),
        controllerName: "Phone",
      });
      const rejected = await controller.next("controller.rejected");
      reasons.push(rejected.reason);
    }
    expect(reasons).toEqual(["invalid-key", "invalid-key", "invalid-key", "rate-limited"]);
  });

  it("requires a client hello before registering or looking up", async () => {
    const server = await startServer();
    const port = portOf(server);
    const client = await connectClient(port);
    client.send({ type: "host.register", keySalt: generateSaltHex(), keyHash: "a".repeat(64), deviceName: "PC" });
    const error = await client.next("error");
    expect(error.code).toBe("hello-required");
  });

  it("serves health over HTTP without leaking ICE credentials or service metadata", async () => {
    const server = await startServer();
    const port = portOf(server);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; hosts: number; onlineDevices: number };
    expect(body.ok).toBe(true);
    expect(body.hosts).toBe(0);
    expect(body.onlineDevices).toBe(0);

    const ice = await fetch(`http://127.0.0.1:${port}/api/ice`);
    expect(ice.status).toBe(404);

    const root = await fetch(`http://127.0.0.1:${port}/`);
    expect(root.status).toBe(404);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  it("hides health, version and admin behind the configured secrets", async () => {
    const server = await startServer({
      healthToken: "health-token-for-test",
      adminPath: "/manage-secret123",
    });
    const port = portOf(server);

    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/api/version`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/admin`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/api/admin/overview`)).status).toBe(404);

    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-ruodao-health": "health-token-for-test" },
    });
    expect(health.status).toBe(200);

    const admin = await fetch(`http://127.0.0.1:${port}/manage-secret123`);
    expect(admin.status).toBe(200);
    const html = await admin.text();
    expect(html).toContain("/manage-secret123/api/overview");
    expect(html).not.toContain('"/api/admin/overview"');
  });
});

describe("invite and approval access", () => {
  it("requires and consumes invite codes for new devices", async () => {
    const server = await startServer({ registrationMode: "invite" });
    const port = portOf(server);

    const noInvite = await connectClient(port);
    const required = await sendHello(noInvite, { expectRejection: true });
    expect(required.type).toBe("client.rejected");
    if (required.type === "client.rejected") expect(required.reason).toBe("invite-required");

    const badInvite = await connectClient(port);
    const invalid = await sendHello(badInvite, { inviteCode: "ZZZZZZZZ", expectRejection: true });
    if (invalid.type === "client.rejected") expect(invalid.reason).toBe("invite-invalid");

    const invite = server.store.createInvite({
      label: "Test",
      createdBy: "test",
      maxUses: 1,
      expiresInMs: null,
    });
    const deviceId = randomUUID();
    const first = await connectClient(port);
    const firstWelcome = await sendHello(first, { deviceId, inviteCode: invite.code });
    if (firstWelcome.type === "client.welcome") {
      expect(firstWelcome.device.status).toBe("approved");
    }

    const reconnect = await connectClient(port);
    const reuse = await sendHello(reconnect, { deviceId, inviteCode: invite.code });
    if (reuse.type === "client.welcome") expect(reuse.device.status).toBe("approved");

    const second = await connectClient(port);
    const exhausted = await sendHello(second, { inviteCode: invite.code, expectRejection: true });
    if (exhausted.type === "client.rejected") expect(exhausted.reason).toBe("invite-invalid");
  });

  it("holds approval-mode devices until an admin approves or blocks them", async () => {
    const server = await startServer({
      registrationMode: "approval",
      adminPassword: "admin-pass-123",
    });
    const port = portOf(server);
    const deviceId = randomUUID();
    const client = await connectClient(port);
    const welcome = await sendHello(client, { deviceId, name: "Waiting PC" });
    if (welcome.type === "client.welcome") expect(welcome.device.status).toBe("pending");

    client.send({
      type: "host.register",
      keySalt: generateSaltHex(),
      keyHash: "a".repeat(64),
      deviceName: "Waiting PC",
    });
    const pendingError = await client.next("error");
    expect(pendingError.code).toBe("device-pending");

    const token = await adminLogin(port, "admin-pass-123");
    const approved = await fetch(`http://127.0.0.1:${port}/api/admin/devices/${deviceId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status: "approved" }),
    });
    expect(approved.status).toBe(200);

    const keySalt = generateSaltHex();
    const keyHash = deriveKeyHash("ABCDEFGHJK", keySalt);
    client.send({ type: "host.register", keySalt, keyHash, deviceName: "Waiting PC" });
    await client.next("host.registered");

    const blocked = await fetch(`http://127.0.0.1:${port}/api/admin/devices/${deviceId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status: "blocked" }),
    });
    expect(blocked.status).toBe(200);
    const kicked = await client.next("client.rejected");
    if (kicked.type === "client.rejected") expect(kicked.reason).toBe("blocked");

    const reconnected = await connectClient(port);
    const rejected = await sendHello(reconnected, { deviceId, expectRejection: true });
    if (rejected.type === "client.rejected") expect(rejected.reason).toBe("blocked");
  });
});

describe("published resources", () => {
  it("publishes a host to approved members without exposing codes or keys", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port, "ABCDEFGHJK", "Shared PC");
    const member = await connectController(port, "Member", randomUUID());
    const snapshot = await member.next("catalog.snapshot");
    expect(snapshot.hosts).toEqual([]);

    host.client.send({ type: "host.publish", published: true, note: " 晚间可用 " });
    const state = await host.client.next("host.publish-state");
    expect(state.published).toBe(true);
    expect(state.note).toBe("晚间可用");

    const updated = await member.next("catalog.updated", (message) => message.hosts.length === 1);
    expect(updated.hosts[0]).toEqual({
      deviceId: host.deviceId,
      name: "Shared PC",
      platform: "win32",
      note: "晚间可用",
      busy: false,
      publishedAt: expect.any(Number),
    });
    const serialized = JSON.stringify(updated);
    expect(serialized).not.toContain(host.code);
    expect(serialized).not.toContain(host.keySalt);
    expect(serialized).not.toContain(host.keyHash);
    expect(updated.hosts[0]).not.toHaveProperty("ip");

    host.client.send({ type: "host.publish", published: false });
    await host.client.next("host.publish-state");
    const cleared = await member.next("catalog.updated", (message) => message.hosts.length === 0);
    expect(cleared.hosts).toEqual([]);
  });

  it("requires host approval and a one-time token before opening a session", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port, "ABCDEFGHJK", "Shared PC");
    const controllerId = randomUUID();
    const controller = await connectController(port, "Phone", controllerId);
    const observer = await connectController(port, "Observer", randomUUID());
    await controller.next("catalog.snapshot");
    await observer.next("catalog.snapshot");

    host.client.send({ type: "host.publish", published: true, note: "在线可申请" });
    await host.client.next("host.publish-state");
    await controller.next("catalog.updated", (message) => message.hosts.length === 1);
    await observer.next("catalog.updated", (message) => message.hosts.length === 1);

    controller.send({ type: "controller.request", hostDeviceId: host.deviceId });
    const sent = await controller.next("controller.request-sent");
    expect(sent.host.name).toBe("Shared PC");
    const request = await host.client.next("host.control-request");
    expect(request.request.controllerName).toBe("Phone");
    expect(request.request.expiresAt).toBeGreaterThan(Date.now());

    host.client.send({
      type: "host.control-decision",
      requestId: request.request.id,
      accept: true,
    });
    await host.client.next("host.control-approved");
    const accepted = await controller.next("controller.request-accepted");
    expect(accepted.host.name).toBe("Shared PC");
    expect(accepted.token).toMatch(/^[0-9a-f]{64}$/);
    const busy = await observer.next(
      "catalog.updated",
      (message) => message.hosts[0]?.busy === true,
    );
    expect(busy.hosts[0]?.busy).toBe(true);

    controller.send({
      type: "controller.connect-token",
      token: accepted.token,
      controllerName: "Phone",
      platform: "win32",
    });
    const paired = await controller.next("controller.paired");
    const hostPaired = await host.client.next("host.paired");
    expect(paired.sessionId).toBe(hostPaired.sessionId);

    const replay = await connectController(port, "Phone", controllerId);
    replay.send({
      type: "controller.connect-token",
      token: accepted.token,
      controllerName: "Phone",
    });
    const denied = await replay.next("controller.request-denied");
    expect(denied.reason).toBe("token-invalid");

    controller.send({ type: "signal", data: { kind: "offer", sdp: "v=0" } });
    const signal = await host.client.next("signal");
    expect(signal.data).toEqual({ kind: "offer", sdp: "v=0" });

    controller.send({ type: "controller.disconnect" });
    await host.client.next("peer.left");
    const idle = await observer.next(
      "catalog.updated",
      (message) => message.hosts[0]?.busy === false,
    );
    expect(idle.hosts[0]?.busy).toBe(false);
  });

  it("denies self, unpublished, and busy hosts", async () => {
    const server = await startServer();
    const port = portOf(server);
    const host = await registerHost(port, "ABCDEFGHJK", "Shared PC");
    const sameDevice = await connectController(port, "Same Device", host.deviceId);
    host.client.send({ type: "host.publish", published: true });
    await host.client.next("host.publish-state");

    sameDevice.send({ type: "controller.request", hostDeviceId: host.deviceId });
    const self = await sameDevice.next("controller.request-denied");
    expect(self.reason).toBe("self");

    const member = await connectController(port, "Member", randomUUID());
    await member.next("catalog.snapshot", (message) => message.hosts.length === 1);
    host.client.send({ type: "host.publish", published: false });
    await host.client.next("host.publish-state");
    member.send({ type: "controller.request", hostDeviceId: host.deviceId });
    const unpublished = await member.next("controller.request-denied");
    expect(unpublished.reason).toBe("not-published");

    host.client.send({ type: "host.publish", published: true });
    await host.client.next("host.publish-state");
    const manual = await connectController(port, "Manual", randomUUID());
    manual.send({ type: "controller.lookup", code: host.code });
    await manual.next("controller.challenge");
    manual.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Manual",
    });
    await manual.next("controller.paired");
    member.send({ type: "controller.request", hostDeviceId: host.deviceId });
    const busy = await member.next("controller.request-denied");
    expect(busy.reason).toBe("busy");
  });

  it("expires stale control requests and approval tokens", async () => {
    const server = await startServer({
      controlRequestTtlMs: 80,
      controlTokenTtlMs: 80,
    });
    const port = portOf(server);
    const host = await registerHost(port, "ABCDEFGHJK", "Shared PC");
    const controller = await connectController(port, "Phone", randomUUID());
    host.client.send({ type: "host.publish", published: true });
    await host.client.next("host.publish-state");

    controller.send({ type: "controller.request", hostDeviceId: host.deviceId });
    await controller.next("controller.request-sent");
    const request = await host.client.next("host.control-request");
    const expired = await controller.next("controller.request-denied");
    expect(expired.reason).toBe("expired");
    await host.client.next("host.control-closed", (message) => message.reason === "expired");

    controller.send({ type: "controller.request", hostDeviceId: host.deviceId });
    await controller.next("controller.request-sent");
    const second = await host.client.next("host.control-request");
    expect(second.request.id).not.toBe(request.request.id);
    host.client.send({
      type: "host.control-decision",
      requestId: second.request.id,
      accept: true,
    });
    const accepted = await controller.next("controller.request-accepted");
    await wait(150);
    controller.send({
      type: "controller.connect-token",
      token: accepted.token,
      controllerName: "Phone",
    });
    const tokenExpired = await controller.next("controller.request-denied");
    expect(tokenExpired.reason).toBe("token-invalid");
    await host.client.next("host.control-closed", (message) => message.reason === "timeout");
  });
});

describe("admin api", () => {
  it("authenticates, lists online clients and sessions, and manages settings", async () => {
    const server = await startServer({ adminPassword: "admin-pass-123" });
    const port = portOf(server);

    const wrong = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(wrong.status).toBe(401);

    const token = await adminLogin(port, "admin-pass-123");
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/overview`);
    expect(unauthorized.status).toBe(401);

    const host = await registerHost(port);
    const controller = await connectController(port);
    controller.send({ type: "controller.lookup", code: host.code });
    await controller.next("controller.challenge");
    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Phone",
    });
    await controller.next("controller.paired");

    const overviewResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
      headers: adminHeaders(token),
    });
    expect(overviewResponse.status).toBe(200);
    const overview = (await overviewResponse.json()) as {
      stats: { onlineDevices: number; activeSessions: number };
    };
    expect(overview.stats.onlineDevices).toBe(2);
    expect(overview.stats.activeSessions).toBe(1);

    host.client.send({ type: "host.publish", published: true, note: "管理可见" });
    await host.client.next("host.publish-state");
    const publishedOverview = (await (
      await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
        headers: adminHeaders(token),
      })
    ).json()) as { stats: { publishedHosts: number } };
    expect(publishedOverview.stats.publishedHosts).toBe(1);
    const publishedDevices = (await (
      await fetch(`http://127.0.0.1:${port}/api/admin/devices`, {
        headers: adminHeaders(token),
      })
    ).json()) as {
      devices: Array<{ id: string; published: boolean; publishedNote: string }>;
    };
    const hostDevice = publishedDevices.devices.find((device) => device.id === host.deviceId);
    expect(hostDevice?.published).toBe(true);
    expect(hostDevice?.publishedNote).toBe("管理可见");

    const devicesResponse = await fetch(`http://127.0.0.1:${port}/api/admin/devices`, {
      headers: adminHeaders(token),
    });
    const devices = (await devicesResponse.json()) as {
      devices: Array<{ online: boolean; roles: string[] }>;
    };
    expect(devices.devices).toHaveLength(2);
    expect(devices.devices.every((device) => device.online)).toBe(true);
    expect(devices.devices.some((device) => device.roles.includes("host"))).toBe(true);

    const sessionsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/sessions`, {
      headers: adminHeaders(token),
    });
    const sessions = (await sessionsResponse.json()) as { sessions: Array<{ id: string }> };
    expect(sessions.sessions).toHaveLength(1);

    const endResponse = await fetch(
      `http://127.0.0.1:${port}/api/admin/sessions/${sessions.sessions[0].id}/end`,
      { method: "POST", headers: adminHeaders(token) },
    );
    expect(endResponse.status).toBe(200);
    await controller.next("peer.left");

    const inviteResponse = await fetch(`http://127.0.0.1:${port}/api/admin/invites`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ label: "Demo", maxUses: 3, expiresInDays: 7 }),
    });
    expect(inviteResponse.status).toBe(201);
    const inviteBody = (await inviteResponse.json()) as { invite: { code: string; active?: boolean } };
    expect(inviteBody.invite.code).toMatch(/^[A-Z2-9]{8}$/);

    const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ registrationMode: "invite", serverName: "测试服务" }),
    });
    expect(settingsResponse.status).toBe(200);
    const settings = (await settingsResponse.json()) as {
      settings: { registrationMode: string; serverName: string };
    };
    expect(settings.settings.registrationMode).toBe("invite");
    expect(settings.settings.serverName).toBe("测试服务");

    const html = await fetch(`http://127.0.0.1:${port}/admin`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await html.text()).toContain("管理后台");
  });

  it("locks the login endpoint after repeated wrong passwords", async () => {
    const server = await startServer({
      adminPassword: "admin-pass-123",
      adminLoginGuard: { maxFailures: 3, lockBaseMs: 300, lockMaxMs: 300 },
    });
    const port = portOf(server);

    const attempt = (password: string) =>
      fetch(`http://127.0.0.1:${port}/api/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

    expect((await attempt("wrong")).status).toBe(401);
    expect((await attempt("wrong")).status).toBe(401);
    const locked = await attempt("wrong");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toMatch(/^\d+$/);
    const lockedBody = (await locked.json()) as { error: string; retryAfter: number };
    expect(lockedBody.error).toBe("login-locked");
    expect(lockedBody.retryAfter).toBeGreaterThan(0);

    const blockedCorrect = await attempt("admin-pass-123");
    expect(blockedCorrect.status).toBe(429);

    await wait(350);
    const ok = await attempt("admin-pass-123");
    expect(ok.status).toBe(200);
  });
});

describe("server update endpoints", () => {
  it("publishes version metadata and reports disabled updates", async () => {
    const server = await startServer({ adminPassword: "update-pass-123" });
    const port = portOf(server);

    const version = await fetch(`http://127.0.0.1:${port}/api/version`);
    expect(version.status).toBe(200);
    const versionBody = (await version.json()) as {
      version: string;
      updateAvailable: boolean;
    };
    expect(versionBody.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(versionBody.updateAvailable).toBe(false);

    const token = await adminLogin(port, "update-pass-123");
    const status = await fetch(`http://127.0.0.1:${port}/api/admin/update`, {
      headers: adminHeaders(token),
    });
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      update: { supported: boolean; currentVersion: string };
    };
    expect(statusBody.update.supported).toBe(false);
    expect(statusBody.update.currentVersion).toBe(versionBody.version);

    const check = await fetch(`http://127.0.0.1:${port}/api/admin/update/check`, {
      method: "POST",
      headers: adminHeaders(token),
    });
    expect(check.status).toBe(503);
  });

  it("checks, downloads and stages an update through the admin API", async () => {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "ruodao-srv-http-"));
    const bundle = "console.log('server bundle');\n";
    const digest = createHash("sha256").update(bundle).digest("hex");
    const manifest = {
      success: true,
      data: {
        version: "0.9.0",
        notes: "测试更新",
        assets: [
          {
            name: "server-0.9.0.cjs",
            kind: "server-cjs",
            platform: "linux",
            arch: "x64",
            url: "https://cdn.ruodao.com/server-0.9.0.cjs",
            size: Buffer.byteLength(bundle),
            sha256: digest,
          },
        ],
      },
    };
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/desktop/releases")) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(bundle, { status: 200 });
    }) as typeof fetch;

    const server = await startServer({
      adminPassword: "update-pass-456",
      update: {
        currentVersion: "0.1.0",
        enabled: true,
        baseUrl: "https://ruodao.com",
        channel: "stable",
        platform: "linux",
        arch: "x64",
        entryFile: "/opt/ruodao/server.cjs",
        serviceName: "ruodao-remote",
        stageDir,
        applyCommand: null,
        autoApply: false,
        checkIntervalMs: 0,
        fetchImpl: fakeFetch,
      },
    });
    const port = portOf(server);
    const token = await adminLogin(port, "update-pass-456");

    const checked = await fetch(`http://127.0.0.1:${port}/api/admin/update/check`, {
      method: "POST",
      headers: adminHeaders(token),
    });
    expect(checked.status).toBe(200);
    const checkedBody = (await checked.json()) as {
      update: { phase: string; latest: { version: string } | null };
    };
    expect(checkedBody.update.phase).toBe("available");
    expect(checkedBody.update.latest?.version).toBe("0.9.0");

    const downloaded = await fetch(`http://127.0.0.1:${port}/api/admin/update/download`, {
      method: "POST",
      headers: adminHeaders(token),
    });
    expect(downloaded.status).toBe(200);
    const downloadedBody = (await downloaded.json()) as {
      update: { phase: string; staged: { sha256: string; path: string } | null };
    };
    expect(downloadedBody.update.phase).toBe("ready");
    expect(downloadedBody.update.staged?.sha256).toBe(digest);
    expect(await fs.readFile(downloadedBody.update.staged!.path, "utf8")).toBe(bundle);

    const applied = await fetch(`http://127.0.0.1:${port}/api/admin/update/apply`, {
      method: "POST",
      headers: adminHeaders(token),
    });
    expect(applied.status).toBe(200);
    const appliedBody = (await applied.json()) as {
      result: { mode: string; command: string | null };
    };
    expect(appliedBody.result.mode).toBe("manual");
    expect(appliedBody.result.command).toContain("systemctl restart");

    await fs.rm(stageDir, { recursive: true, force: true });
  });
});

describe("risk control", () => {
  async function pair(
    port: number,
    host: { code: string; keyHash: string; client: TestClient },
    name: string,
  ) {
    const controller = await connectController(port, name);
    controller.send({ type: "controller.lookup", code: host.code });
    await controller.next("controller.challenge");
    controller.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: name,
      platform: "win32",
    });
    return controller;
  }

  it("rejects new controllers when the concurrent session limit is reached", async () => {
    const server = await startServer({ policy: { maxSessions: 1 } });
    const port = portOf(server);
    const host = await registerHost(port);

    const first = await pair(port, host, "First");
    await first.next("controller.paired");
    await host.client.next("host.paired");

    const second = await connectController(port, "Second");
    second.send({ type: "controller.lookup", code: host.code });
    await second.next("controller.challenge");
    second.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Second",
      platform: "win32",
    });
    const full = await second.next("controller.rejected");
    expect(full.reason).toBe("server-full");
    expect(full.message).toContain("上限");

    first.send({ type: "controller.disconnect" });
    await host.client.next("peer.left");

    second.send({ type: "controller.lookup", code: host.code });
    await second.next("controller.challenge");
    second.send({
      type: "controller.connect",
      code: host.code,
      keyHash: host.keyHash,
      controllerName: "Second",
      platform: "win32",
    });
    await second.next("controller.paired");
    await host.client.next("host.paired");
  });

  it("blocks a device from logging in and exposes limits in server info", async () => {
    const server = await startServer({ adminPassword: "risk-pass-123" });
    const port = portOf(server);
    const token = await adminLogin(port, "risk-pass-123");
    const deviceId = randomUUID();

    const info = await fetch(`http://127.0.0.1:${port}/api/server-info`);
    expect(info.status).toBe(200);
    const infoBody = (await info.json()) as {
      maxSessions: number;
      remainingSlots: number | null;
      acceptingSessions: boolean;
    };
    expect(infoBody.maxSessions).toBe(0);
    expect(infoBody.remainingSlots).toBeNull();
    expect(infoBody.acceptingSessions).toBe(true);

    const controller = await connectClient(port);
    await sendHello(controller, { deviceId, name: "Blocked Device" });

    const blocked = await fetch(`http://127.0.0.1:${port}/api/admin/blocks`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ kind: "device", value: deviceId, permanent: true }),
    });
    expect(blocked.status).toBe(201);

    const reconnect = await connectClient(port);
    const rejected = await sendHello(reconnect, {
      deviceId,
      name: "Blocked Device",
      expectRejection: true,
    });
    if (rejected.type !== "client.rejected") throw new Error("期望客户端被拒绝");
    expect(rejected.reason).toBe("blocked");

    const list = await fetch(`http://127.0.0.1:${port}/api/admin/blocks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = (await list.json()) as { blocks: Array<{ value: string }> };
    expect(listBody.blocks.some((block) => block.value === deviceId)).toBe(true);
  });

  it("persists and reports policy limits through the admin API", async () => {
    const server = await startServer({ adminPassword: "policy-pass-123" });
    const port = portOf(server);
    const token = await adminLogin(port, "policy-pass-123");

    const patched = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({
        maxSessions: 3,
        sessionLimitMinutes: 30,
        cooldownMinutes: 5,
        freezeMinutes: 10,
      }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      policy: { maxSessions: number; sessionLimitMinutes: number };
    };
    expect(patchedBody.policy.maxSessions).toBe(3);
    expect(patchedBody.policy.sessionLimitMinutes).toBe(30);

    const overview = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const overviewBody = (await overview.json()) as {
      policy: { maxSessions: number; cooldownMinutes: number };
      stats: { remainingSlots: number | null; maxSessions: number };
    };
    expect(overviewBody.policy.cooldownMinutes).toBe(5);
    expect(overviewBody.stats.maxSessions).toBe(3);
    expect(overviewBody.stats.remainingSlots).toBe(3);
  });
});
