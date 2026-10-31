import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerUpdateService, type ServerUpdateOptions } from "../src/update";

const BUNDLE = "console.log('ruodao remote server 0.2.0');\n";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifest(version: string, options: { url?: string; sha?: string; size?: number } = {}) {
  return {
    success: true,
    data: {
      version,
      channel: "stable",
      notes: "修复远程连接稳定性问题",
      publishedAt: "2026-10-30T10:00:00Z",
      assets: [
        {
          name: `server-${version}.cjs`,
          kind: "server-cjs",
          platform: "linux",
          arch: "x64",
          url: options.url ?? `https://cdn.ruodao.com/ruodao-remote/${version}/server.cjs`,
          size: options.size ?? Buffer.byteLength(BUNDLE),
          sha256: options.sha ?? sha256(BUNDLE),
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

function bundleResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/javascript" } });
}

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: string | URL | Request) => handler(String(input))) as typeof fetch;
}

describe("服务端更新服务", () => {
  let stageDir = "";

  beforeEach(async () => {
    stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "ruodao-update-"));
  });

  afterEach(async () => {
    await fs.rm(stageDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createService(overrides: Partial<ServerUpdateOptions> = {}): ReturnType<typeof createServerUpdateService> {
    return createServerUpdateService({
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
      fetchImpl: fakeFetch((url) =>
        url.includes("/api/desktop/releases") ? jsonResponse(manifest("0.2.0")) : bundleResponse(BUNDLE),
      ),
      ...overrides,
    });
  }

  it("发现新版本并下载校验后暂存", async () => {
    const service = createService();
    const checked = await service.check();
    expect(checked.phase).toBe("available");
    expect(checked.latest?.version).toBe("0.2.0");
    expect(checked.manualCommand).toBeNull();

    const downloaded = await service.download();
    expect(downloaded.phase).toBe("ready");
    expect(downloaded.staged?.sha256).toBe(sha256(BUNDLE));
    const content = await fs.readFile(downloaded.staged!.path, "utf8");
    expect(content).toBe(BUNDLE);
  });

  it("没有配置更新助手时返回手动更新命令", async () => {
    const service = createService();
    await service.check();
    await service.download();
    const result = await service.apply();
    expect(result.mode).toBe("manual");
    expect(result.command).toContain("install -o root -g root -m 0644");
    expect(result.command).toContain("/opt/ruodao/server.cjs");
    expect(result.command).toContain("systemctl restart 'ruodao-remote'");
  });

  it("系统级更新器启用时标记 system 并提示空闲安装", async () => {
    const service = createService({ systemUpdater: true });
    const checked = await service.check();
    expect(checked.applyMode).toBe("system");
    expect(checked.systemUpdater).toBe(true);

    await service.download();
    const result = await service.apply();
    expect(result.mode).toBe("manual");
    expect(result.message).toContain("系统更新服务");
    expect(service.status().manualCommand).toContain("systemctl restart");
  });

  it("校验不匹配时拒绝暂存", async () => {
    const service = createService({
      fetchImpl: fakeFetch((url) =>
        url.includes("/api/desktop/releases")
          ? jsonResponse(manifest("0.2.0", { sha: "f".repeat(64) }))
          : bundleResponse(BUNDLE),
      ),
    });
    await service.check();
    await expect(service.download()).rejects.toThrow("校验失败");
    expect(service.status().phase).toBe("error");
    const files = await fs.readdir(stageDir);
    expect(files).toEqual([]);
  });

  it("已是最新版本时不再提示更新", async () => {
    const service = createService({ currentVersion: "0.2.0" });
    const status = await service.check();
    expect(status.phase).toBe("up-to-date");
  });

  it("只允许从 ruodao.com 及子域名下载", async () => {
    const service = createService({
      fetchImpl: fakeFetch((url) =>
        url.includes("/api/desktop/releases")
          ? jsonResponse(manifest("0.2.0", { url: "https://evil.example.com/server.cjs" }))
          : bundleResponse(BUNDLE),
      ),
    });
    await expect(service.check()).rejects.toThrow("不在允许的下载源内");
  });

  it("未启用时明确拒绝检查", async () => {
    const service = createService({ enabled: false });
    expect(service.status().supported).toBe(false);
    await expect(service.check()).rejects.toThrow("未启用");
  });
});
