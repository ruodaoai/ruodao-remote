#!/usr/bin/env node
/**
 * 生成若道远程的更新清单，供 ruodao.com 的发布接口返回。
 *
 * 示例：
 *   node scripts/make-update-manifest.mjs \
 *     --version 0.2.0 \
 *     --notes "修复远控断线重连" \
 *     --base https://cdn.ruodao.com/ruodao-remote/0.2.0/ \
 *     --asset release/RuodaoRemote-Setup-0.2.0.exe \
 *     --asset release/RuodaoRemote-Portable-0.2.0.exe \
 *     --server ../server/dist/server.cjs \
 *     --out release/update-manifest.json
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    version: "",
    serverVersion: "",
    channel: "stable",
    notes: "",
    notesFile: "",
    base: "",
    out: "update-manifest.json",
    assets: [],
    serverAssets: [],
    serverPlatform: "linux",
    serverArch: "x64",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) fail(`${flag} 需要一个值`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--version":
        options.version = value();
        break;
      case "--server-version":
        options.serverVersion = value();
        break;
      case "--channel":
        options.channel = value();
        break;
      case "--notes":
        options.notes = value();
        break;
      case "--notes-file":
        options.notesFile = value();
        break;
      case "--base":
        options.base = value();
        break;
      case "--out":
        options.out = value();
        break;
      case "--asset":
        options.assets.push(value());
        break;
      case "--server":
        options.serverAssets.push(value());
        break;
      case "--server-platform":
        options.serverPlatform = value();
        break;
      case "--server-arch":
        options.serverArch = value();
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "用法：node scripts/make-update-manifest.mjs --version <版本> --base <下载前缀> [选项]",
            "",
            "  --version          客户端版本号（默认读取根目录 version.json）",
            "  --server-version   服务端版本号，默认与客户端一致",
            "  --channel          更新通道，默认 stable",
            "  --notes            更新说明",
            "  --notes-file       从文件读取更新说明（优先于 --notes）",
            "  --base             下载地址前缀，例如 https://cdn.ruodao.com/ruodao-remote/0.2.0/",
            "  --asset            客户端安装包路径，可重复",
            "  --server           服务端单文件路径，可重复",
            "  --server-platform  服务端平台，默认 linux",
            "  --server-arch      服务端架构，默认 x64",
            "  --out              输出文件，默认 update-manifest.json",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        fail(`未知参数 ${flag}`);
    }
  }
  return options;
}

function kindOf(file) {
  const lower = file.toLowerCase();
  if (/\.tar\.gz$|\.tgz$/.test(lower)) return "server-tar";
  if (/\.cjs$|\.js$/.test(lower)) return "server-cjs";
  if (/\.msi$/.test(lower)) return "msi";
  if (/\.dmg$/.test(lower)) return "dmg";
  if (/\.zip$/.test(lower)) return "zip";
  if (/\.exe$/.test(lower)) return /setup|installer/.test(lower) ? "nsis" : "exe";
  return "file";
}

function platformOf(file) {
  const lower = file.toLowerCase();
  if (/(win|setup|portable)/.test(lower)) return "win32";
  if (/(mac|darwin|dmg)/.test(lower)) return "darwin";
  if (/(linux|server)/.test(lower)) return "linux";
  return "";
}

function archOf(file) {
  const lower = file.toLowerCase();
  if (/(arm64|aarch64)/.test(lower)) return "arm64";
  if (/(x64|amd64|x86_64)/.test(lower)) return "x64";
  if (/(ia32|x86|i386)/.test(lower)) return "ia32";
  return "";
}

async function describe(file, options) {
  let info;
  try {
    info = await stat(file);
  } catch {
    fail(`找不到文件 ${file}`);
  }
  if (!info.isFile()) fail(`${file} 不是文件`);
  const buffer = await readFile(file);
  const name = path.basename(file);
  const base = options.base.endsWith("/") ? options.base : `${options.base}/`;
  const isServer = options.serverAssets.includes(file);
  return {
    name,
    kind: kindOf(name),
    platform: isServer ? options.serverPlatform : platformOf(name),
    arch: isServer ? options.serverArch : archOf(name),
    channel: options.channel,
    url: new URL(encodeURIComponent(name), base).toString(),
    size: info.size,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

const options = parseArgs(process.argv.slice(2));
if (!options.version) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const release = JSON.parse(await readFile(path.join(root, "version.json"), "utf8"));
    if (typeof release.version === "string") {
      options.version = release.version;
      console.log(`未指定 --version，使用 version.json 中的 v${options.version}`);
    }
  } catch {
    // 下面统一报错。
  }
}
if (!options.version) fail("缺少 --version（或根目录 version.json）");
if (!options.base) fail("缺少 --base 下载地址前缀");
if (options.assets.length === 0 && options.serverAssets.length === 0) {
  fail("至少需要一个 --asset 或 --server");
}
if (!/^https?:\/\//.test(options.base)) fail("--base 必须以 http(s):// 开头");

const notes = options.notesFile
  ? (await readFile(options.notesFile, "utf8")).trim()
  : options.notes;

const clientAssets = [];
for (const file of options.assets) clientAssets.push(await describe(file, options));
const serverAssets = [];
for (const file of options.serverAssets) serverAssets.push(await describe(file, options));

const publishedAt = new Date().toISOString();
const products = {};
if (clientAssets.length > 0) {
  products["ruodao-remote"] = {
    version: options.version,
    channel: options.channel,
    notes,
    publishedAt,
    assets: clientAssets,
  };
}
if (serverAssets.length > 0) {
  products["ruodao-remote-server"] = {
    version: options.serverVersion || options.version,
    channel: options.channel,
    notes,
    publishedAt,
    assets: serverAssets,
  };
}

const manifest = { success: true, data: { products } };
await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
await writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`已生成 ${options.out}`);
for (const [product, entry] of Object.entries(products)) {
  console.log(`  ${product} v${entry.version} · ${entry.assets.length} 个文件`);
  for (const asset of entry.assets) {
    console.log(`    ${asset.name}  ${asset.kind}/${asset.platform}/${asset.arch}  sha256=${asset.sha256}`);
  }
}
console.log("把这个文件的内容作为更新接口的 data 返回即可。");
