import { describe, expect, it } from "vitest";
import {
  allowedDownloadHosts,
  buildManifestUrl,
  compareVersions,
  isAllowedDownloadUrl,
  isNewerVersion,
  normalizeUpdateBaseUrl,
  parseReleasePayload,
  selectUpdateAsset,
} from "../electron/update-protocol";

const OPTIONS = {
  product: "ruodao-remote",
  channel: "stable",
  baseUrl: "https://ruodao.com",
};

describe("版本比较", () => {
  it("按语义化版本比较", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
  });

  it("预发布版本低于正式版本", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-beta.9")).toBe(1);
  });

  it("非法版本不会误判为更新", () => {
    expect(isNewerVersion("", "0.1.0")).toBe(false);
    expect(isNewerVersion("latest", "0.1.0")).toBe(false);
  });
});

describe("更新地址", () => {
  it("规范化更新源并拒绝不安全地址", () => {
    expect(normalizeUpdateBaseUrl("")).toBe("https://ruodao.com");
    expect(normalizeUpdateBaseUrl("https://ruodao.com/")).toBe("https://ruodao.com");
    expect(normalizeUpdateBaseUrl("http://ruodao.com")).toBe("https://ruodao.com");
    expect(normalizeUpdateBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeUpdateBaseUrl("javascript:alert(1)")).toBe("https://ruodao.com");
  });

  it("构造清单地址时带上产品与平台", () => {
    const url = new URL(
      buildManifestUrl("https://ruodao.com", {
        product: "ruodao-remote",
        channel: "stable",
        platform: "win32",
        arch: "x64",
        currentVersion: "0.1.0",
      }),
    );
    expect(url.pathname).toBe("/api/desktop/releases");
    expect(url.searchParams.get("product")).toBe("ruodao-remote");
    expect(url.searchParams.get("platform")).toBe("win32");
    expect(url.searchParams.get("current")).toBe("0.1.0");
  });

  it("允许自定义发布清单路径", () => {
    const url = new URL(
      buildManifestUrl(
        "https://ruodao.com",
        {
          product: "ruodao-remote",
          channel: "stable",
          platform: "win32",
          arch: "x64",
          currentVersion: "0.1.0",
        },
        "/api/desktop/versions",
      ),
    );
    expect(url.pathname).toBe("/api/desktop/versions");
    expect(
      new URL(
        buildManifestUrl(
          "https://ruodao.com",
          {
            product: "ruodao-remote",
            channel: "stable",
            platform: "win32",
            arch: "x64",
            currentVersion: "0.1.0",
          },
          "//evil.example.com/x",
        ),
      ).pathname,
    ).toBe("/api/desktop/releases");
  });

  it("只允许 ruodao.com 及其子域名的 HTTPS 下载地址", () => {
    const hosts = allowedDownloadHosts("https://ruodao.com");
    expect(isAllowedDownloadUrl("https://cdn.ruodao.com/a.exe", hosts)).toBe(true);
    expect(isAllowedDownloadUrl("https://ruodao.com/a.exe", hosts)).toBe(true);
    expect(isAllowedDownloadUrl("http://ruodao.com/a.exe", hosts)).toBe(false);
    expect(isAllowedDownloadUrl("https://evil.example.com/a.exe", hosts)).toBe(false);
    expect(isAllowedDownloadUrl("https://ruodao.com.evil.com/a.exe", hosts)).toBe(false);
    expect(isAllowedDownloadUrl("https://user:pass@ruodao.com/a.exe", hosts)).toBe(false);
  });
});

describe("清单解析", () => {
  it("解析若道规范格式", () => {
    const release = parseReleasePayload(
      {
        success: true,
        data: {
          version: "0.2.0",
          channel: "stable",
          notes: "修复若干问题",
          publishedAt: "2026-10-30T10:00:00Z",
          mandatory: false,
          assets: [
            {
              name: "RuodaoRemote-Setup-0.2.0.exe",
              kind: "nsis",
              platform: "win32",
              arch: "x64",
              url: "https://cdn.ruodao.com/ruodao-remote/0.2.0/setup.exe",
              size: 123456,
              sha256: "a".repeat(64),
            },
          ],
        },
      },
      OPTIONS,
    );
    expect(release?.version).toBe("0.2.0");
    expect(release?.notes).toBe("修复若干问题");
    expect(release?.assets[0].sha256).toBe("a".repeat(64));
  });

  it("解析按产品分组的清单", () => {
    const release = parseReleasePayload(
      {
        success: true,
        data: {
          products: {
            "ruodao-remote": {
              version: "0.3.0",
              assets: [
                {
                  name: "setup.exe",
                  url: "/downloads/setup.exe",
                  sha256: "sha256:" + "b".repeat(64),
                },
              ],
            },
            "ruodao-remote-server": {
              version: "0.3.1",
              assets: [],
            },
          },
        },
      },
      OPTIONS,
    );
    expect(release?.version).toBe("0.3.0");
    expect(release?.assets[0].url).toBe("https://ruodao.com/downloads/setup.exe");
    expect(release?.assets[0].sha256).toBe("b".repeat(64));
    expect(release?.assets[0].kind).toBe("nsis");
  });

  it("兼容 GitHub Release 风格", () => {
    const release = parseReleasePayload(
      {
        tag_name: "v1.2.3",
        body: "Release notes",
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          {
            name: "RuodaoRemote-Setup-1.2.3.exe",
            browser_download_url: "https://github.com/x/y/1.2.3/setup.exe",
            size: 10,
          },
        ],
      },
      OPTIONS,
    );
    expect(release?.version).toBe("1.2.3");
    expect(release?.notes).toBe("Release notes");
    expect(release?.assets[0].platform).toBe("win32");
    // 文件名没写架构时保持为空，选择安装包时按“匹配任意架构”处理。
    expect(release?.assets[0].arch).toBe("");
  });

  it("接口显式失败时抛出可读错误", () => {
    expect(() =>
      parseReleasePayload({ success: false, message: "版本不存在" }, OPTIONS),
    ).toThrow("版本不存在");
  });

  it("没有版本号时返回 null", () => {
    expect(parseReleasePayload({ data: {} }, OPTIONS)).toBeNull();
  });
});

describe("安装包选择", () => {
  const release = {
    product: "ruodao-remote",
    version: "0.2.0",
    channel: "stable",
    notes: "",
    publishedAt: null,
    mandatory: false,
    assets: [
      {
        name: "server-0.2.0.cjs",
        url: "https://cdn.ruodao.com/server.cjs",
        size: 10,
        sha256: "c".repeat(64),
        kind: "server-cjs",
        platform: "linux",
        arch: "x64",
        channel: "stable",
      },
      {
        name: "RuodaoRemote-Portable-0.2.0.exe",
        url: "https://cdn.ruodao.com/portable.exe",
        size: 10,
        sha256: "d".repeat(64),
        kind: "exe",
        platform: "win32",
        arch: "x64",
        channel: "stable",
      },
      {
        name: "RuodaoRemote-Setup-0.2.0.exe",
        url: "https://cdn.ruodao.com/setup.exe",
        size: 10,
        sha256: "e".repeat(64),
        kind: "nsis",
        platform: "win32",
        arch: "x64",
        channel: "stable",
      },
    ],
  };

  it("为 Windows 选择 NSIS 安装包", () => {
    const asset = selectUpdateAsset(release, {
      platform: "win32",
      arch: "x64",
      kinds: ["nsis", "exe", "zip"],
    });
    expect(asset?.name).toBe("RuodaoRemote-Setup-0.2.0.exe");
  });

  it("为服务端选择单文件包", () => {
    const asset = selectUpdateAsset(release, {
      platform: "linux",
      arch: "x64",
      kinds: ["server-cjs", "server-tar"],
    });
    expect(asset?.kind).toBe("server-cjs");
  });

  it("没有匹配资源时返回 null", () => {
    expect(
      selectUpdateAsset(release, { platform: "darwin", arch: "arm64", kinds: ["dmg"] }),
    ).toBeNull();
  });
});
