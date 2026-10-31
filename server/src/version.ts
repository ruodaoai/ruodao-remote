import { readFileSync } from "node:fs";
import path from "node:path";

declare const __RUODAO_SERVER_VERSION__: string | undefined;

function readVersionFile(): string | null {
  const candidates = [
    path.join(__dirname, "..", "..", "version.json"),
    path.join(__dirname, "..", "version.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      if (typeof raw.version === "string" && /^\d+\.\d+\.\d+/.test(raw.version)) {
        return raw.version;
      }
    } catch {
      // 单文件部署时没有 version.json，继续尝试下一个位置。
    }
  }
  return null;
}

/** 读取服务端版本：环境变量 > 构建注入 > 根目录 version.json > package.json > 内置版本。 */
function readPackageVersion(): string | null {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "package.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      if (typeof raw.version === "string" && /^\d+\.\d+\.\d+/.test(raw.version)) {
        return raw.version;
      }
    } catch {
      // 打包为单文件后没有 package.json，继续尝试下一个位置。
    }
  }
  return null;
}

function readCompiledVersion(): string | null {
  return typeof __RUODAO_SERVER_VERSION__ === "string" ? __RUODAO_SERVER_VERSION__ : null;
}

export const SERVER_VERSION =
  process.env.RUODAO_REMOTE_VERSION?.trim() ||
  readCompiledVersion() ||
  readVersionFile() ||
  readPackageVersion() ||
  "0.1.0";
