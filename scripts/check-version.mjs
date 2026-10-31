#!/usr/bin/env node
/** 校验根目录 version.json、客户端与服务端 package.json 版本一致。 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function readJson(relative) {
  const file = path.join(root, relative);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 ${relative}：${error instanceof Error ? error.message : String(error)}`);
  }
}

const release = await readJson("version.json");
if (typeof release.version !== "string" || !VERSION_PATTERN.test(release.version)) {
  throw new Error(`version.json 中的版本号无效：${String(release.version)}`);
}

const packages = [
  ["client/package.json", await readJson("client/package.json")],
  ["server/package.json", await readJson("server/package.json")],
];
const mismatched = packages.filter(([, pkg]) => pkg.version !== release.version);
if (mismatched.length > 0) {
  const detail = mismatched.map(([file, pkg]) => `${file} 为 ${pkg.version}`).join("，");
  console.error(
    `版本不一致：version.json 为 ${release.version}，${detail}。\n` +
      `请先运行 node scripts/set-version.mjs ${release.version} 同步版本号。`,
  );
  process.exit(1);
}

console.log(`版本一致：v${release.version}`);
