#!/usr/bin/env node
/**
 * 版本号单一入口：同步根目录 version.json、客户端/服务端 package.json 与 lockfile。
 *
 * 用法：
 *   node scripts/set-version.mjs 0.2.0
 *   node scripts/set-version.mjs patch
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

async function readJson(relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    fail(`无法读取 ${relative}：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJson(relative, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(path.join(root, relative), content, "utf8");
}

function bump(current, keyword) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) fail(`当前版本号无法解析：${current}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (keyword === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (keyword === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const argument = (process.argv[2] ?? "").trim().replace(/^v/i, "");
if (!argument) fail("缺少版本号，例如 node scripts/set-version.mjs 0.2.0 或 patch");
const release = await readJson("version.json");
const current = String(release.version ?? "");
let next = argument;
if (argument === "major" || argument === "minor" || argument === "patch") {
  next = bump(current, argument);
}
if (!VERSION_PATTERN.test(next)) {
  fail(`版本号格式不正确：${next}（示例：0.2.0、1.0.0-beta.1）`);
}

release.version = next;
await writeJson("version.json", release);

for (const relative of ["client/package.json", "server/package.json"]) {
  const pkg = await readJson(relative);
  pkg.version = next;
  await writeJson(relative, pkg);
}

for (const relative of ["client/package-lock.json", "server/package-lock.json"]) {
  try {
    const lock = await readJson(relative);
    lock.version = next;
    if (lock.packages && lock.packages[""]) lock.packages[""].version = next;
    await writeJson(relative, lock);
  } catch {
    // 没有 lockfile 时跳过；下次 npm install 会按 package.json 生成。
  }
}

console.log(`版本已更新：${current || "未知"} -> ${next}`);
console.log("下一步：npm run build / npm run dist:win，然后生成更新清单。");
