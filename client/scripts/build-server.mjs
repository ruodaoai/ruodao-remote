import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.resolve(root, "..", "server", "src", "index.ts");
const outfile = path.resolve(root, "resources", "server", "server.cjs");

function productVersion() {
  for (const file of [path.resolve(root, "..", "version.json"), path.resolve(root, "package.json")]) {
    try {
      const version = JSON.parse(readFileSync(file, "utf8")).version;
      if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) return version;
    } catch {
      // 继续尝试下一个版本来源。
    }
  }
  throw new Error("无法确定产品版本，请检查 version.json 与 client/package.json。");
}

const version = productVersion();

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "info",
  legalComments: "none",
  external: ["bufferutil", "utf-8-validate"],
  define: {
    __RUODAO_SERVER_VERSION__: JSON.stringify(version),
  },
});

