#!/usr/bin/env node
/**
 * 审计渲染层文案：
 * 1. 收集所有 t("...") / tf("...") 的 key，并与 en.ts 对比，列出缺失词条；
 * 2. 列出仍然写死、未被包裹的中文（模块常量、跳过文件等）。
 *
 * 用法：node scripts/i18n-audit.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const srcDir = path.join(root, "src");
const i18nDir = path.join(srcDir, "i18n");
const CJK = /[\u3400-\u9fff]/;
const asJson = process.argv.includes("--json");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === i18nDir) continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const keys = new Map();
const leftovers = [];

for (const file of walk(srcDir)) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "t" || node.expression.text === "tf")) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        const key = first.text;
        if (!keys.has(key)) keys.set(key, []);
        keys.get(key).push(path.relative(root, file));
        return;
      }
    }
    if (ts.isStringLiteral(node) && CJK.test(node.text)) {
      const parent = node.parent;
      const inI18nCall =
        parent && ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.arguments[0] === node;
      const isKeyName =
        parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!inI18nCall && !isKeyName) {
        leftovers.push({ file: path.relative(root, file), text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      }
    }
    if (ts.isJsxText(node) && CJK.test(node.text) && node.text.trim()) {
      leftovers.push({ file: path.relative(root, file), text: node.text.trim(), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    if (ts.isTemplateExpression(node) && CJK.test(node.head.text + node.templateSpans.map((s) => s.literal.text).join(""))) {
      leftovers.push({ file: path.relative(root, file), text: "template: " + node.getText(sf).slice(0, 80), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const enFile = fs.readFileSync(path.join(i18nDir, "en.ts"), "utf8");
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const translated = new Set(
  [...enFile.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => {
    try {
      return normalize(JSON.parse(`"${m[1]}"`));
    } catch {
      return normalize(m[1]);
    }
  }),
);
const missing = [...keys.keys()].filter((key) => !translated.has(normalize(key)));

if (asJson) {
  fs.writeFileSync(path.join(root, ".i18n-keys.json"), JSON.stringify([...keys.keys()], null, 2));
  fs.writeFileSync(path.join(root, ".i18n-leftovers.json"), JSON.stringify(leftovers, null, 2));
  console.log(`key=${keys.size} translated=${translated.size} missing=${missing.length} leftovers=${leftovers.length}`);
} else {
  console.log(`唯一词条 ${keys.size}，已翻译 ${keys.size - missing.length}，缺失 ${missing.length}`);
  for (const key of missing.slice(0, 40)) console.log(`  MISSING ${JSON.stringify(key)}`);
  console.log(`未包裹的中文 ${leftovers.length} 处：`);
  for (const item of leftovers.slice(0, 40)) console.log(`  ${item.file}:${item.line} ${item.text.slice(0, 60)}`);
}
