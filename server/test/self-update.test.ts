import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSelfUpdate, type SelfUpdateOptions } from "../src/self-update";

const OLD_BUNDLE = "console.log('ruodao remote server 0.1.0');\n";
const NEW_BUNDLE = "console.log('ruodao remote server 0.2.0');\n";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifest(version: string, options: { sha?: string; size?: number } = {}) {
  return {
    success: true,
    data: {
      version,
      channel: "stable",
      notes: "服务端自动更新测试",
      publishedAt: "2026-10-31T10:00:00Z",
      assets: [
        {
          name: `server-${version}.cjs`,
          kind: "server-cjs",
          platform: "linux",
          arch: "x64",
          url: `https://cdn.ruodao.com/ruodao-remote/${version}/server.cjs`,
          size: options.size ?? Buffer.byteLength(NEW_BUNDLE),
          sha256: options.sha ?? sha256(NEW_BUNDLE),
        },
      ],
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("服务端自更新", () => {
  let root = "";
  let entryFile = "";
  let stageDir = "";
  let installedVersion = "0.1.0";
  let sessions = 0;
  let restartCalls = 0;
  let fetchUrls: string[] = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ruodao-self-update-"));
    entryFile = path.join(root, "server.cjs");
    stageDir = path.join(root, "updates");
    await fs.writeFile(entryFile, OLD_BUNDLE, "utf8");
    installedVersion = "0.1.0";
    sessions = 0;
    restartCalls = 0;
    fetchUrls = [];
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function fakeFetch(releaseVersion: string, options: { sha?: string; alwaysOld?: boolean } = {}): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes("/api/desktop/releases")) {
        return jsonResponse(manifest(releaseVersion, { sha: options.sha }));
      }
      if (url.includes("/health")) {
        return jsonResponse({ ok: true, version: installedVersion, sessions });
      }
      return new Response(NEW_BUNDLE, { status: 200 });
    }) as typeof fetch;
  }

  function createOptions(overrides: Partial<SelfUpdateOptions> = {}): SelfUpdateOptions {
    return {
      currentVersion: "0.1.0",
      enabled: true,
      baseUrl: "https://ruodao.com",
      channel: "stable",
      platform: "linux",
      arch: "x64",
      entryFile,
      serviceName: "ruodao-remote",
      stageDir,
      requireIdle: true,
      healthUrl: "http://127.0.0.1:8787/health",
      healthToken: "test-health-token",
      healthTimeoutMs: 200,
      fetchImpl: fakeFetch("0.2.0"),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1))),
      commandRunner: async () => {
        restartCalls += 1;
        const content = await fs.readFile(entryFile, "utf8");
        installedVersion = content.includes("0.2.0") ? "0.2.0" : "0.1.0";
      },
      log: () => {},
      ...overrides,
    };
  }

  it("已是最新版本时不下载也不重启", async () => {
    const result = await runSelfUpdate(createOptions({ fetchImpl: fakeFetch("0.1.0") }));
    expect(result.status).toBe("up-to-date");
    expect(restartCalls).toBe(0);
    expect(await fs.readFile(entryFile, "utf8")).toBe(OLD_BUNDLE);
  });

  it("空闲时替换程序、重启并确认新版本", async () => {
    const result = await runSelfUpdate(createOptions());
    expect(result.status).toBe("updated");
    expect(result.targetVersion).toBe("0.2.0");
    expect(restartCalls).toBe(1);
    expect(await fs.readFile(entryFile, "utf8")).toBe(NEW_BUNDLE);
    const backup = await fs.readFile(`${entryFile}.bak`, "utf8");
    expect(backup).toBe(OLD_BUNDLE);
  });

  it("有远控会话时不下载也不替换", async () => {
    sessions = 2;
    const result = await runSelfUpdate(createOptions());
    expect(result.status).toBe("deferred");
    expect(restartCalls).toBe(0);
    expect(await fs.readFile(entryFile, "utf8")).toBe(OLD_BUNDLE);
    expect(fetchUrls.some((url) => url.includes("/server.cjs"))).toBe(false);
  });

  it("校验失败时保留旧程序", async () => {
    const result = await runSelfUpdate(
      createOptions({ fetchImpl: fakeFetch("0.2.0", { sha: "f".repeat(64) }) }),
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("校验失败");
    expect(restartCalls).toBe(0);
    expect(await fs.readFile(entryFile, "utf8")).toBe(OLD_BUNDLE);
  });

  it("新版本健康检查失败时自动回滚", async () => {
    const result = await runSelfUpdate(
      createOptions({
        fetchImpl: fakeFetch("0.2.0", { alwaysOld: true }),
        healthTimeoutMs: 20,
        commandRunner: async () => {
          restartCalls += 1;
          installedVersion = "0.1.0";
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("回滚");
    expect(restartCalls).toBe(2);
    expect(await fs.readFile(entryFile, "utf8")).toBe(OLD_BUNDLE);
  });
});
