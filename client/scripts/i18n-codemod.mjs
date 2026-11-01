#!/usr/bin/env node
/**
 * 把渲染层里写死的中文文案包成 t("中文") / tf("模板{0}", 值)，
 * 便于以中文原文作为 key 做英文映射。
 *
 * - JSX 文本节点 → {t("...")}
 * - JSX 属性字符串（placeholder、title、aria-label 等）→ {t("...")}
 * - 函数体内的字符串字面量 → t("...")（模块顶层不动，避免语言切换后无法更新）
 * - 模板字符串 → tf("...{0}...", 值)
 *
 * 用法：node scripts/i18n-codemod.mjs [--dry] [文件...]
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const allScope = args.includes("--all");
const explicit = args.filter((a) => !a.startsWith("--"));

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const srcDir = path.join(root, "src");
const i18nDir = path.join(srcDir, "i18n");
const skip = new Set([
  path.join(srcDir, "lib", "help.ts"),
  path.join(srcDir, "lib", "onboarding.ts"),
]);

const CJK = /[\u3400-\u9fff]/;

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === i18nDir) continue;
      out.push(...collectFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      if (!skip.has(full)) out.push(full);
    }
  }
  return out;
}

function insideFunction(node) {
  if (allScope) return true;
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return true;
    if (ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

function isWrapped(node) {
  const parent = node.parent;
  return (
    parent &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    (parent.expression.text === "t" || parent.expression.text === "tf") &&
    parent.arguments[0] === node
  );
}

function shouldSkipString(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isJsxAttribute(parent)) return true; // 由属性分支处理
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) return true;
  if (ts.isElementAccessExpression(parent) || ts.isQualifiedName(parent)) return true;
  if (ts.isCaseClause(parent) || ts.isEnumMember(parent)) return true;
  if (ts.isJsxExpression(parent) && parent.expression === node) return true; // 交给通用分支即可
  if (isWrapped(node)) return true;
  return false;
}

function transform(file) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  let usesT = false;
  let usesTf = false;

  const add = (start, end, text) => edits.push({ start, end, text });

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = source.slice(node.getStart(sf), node.getEnd(sf));
      const stripped = raw.trim();
      if (stripped && CJK.test(stripped)) {
        const index = raw.indexOf(stripped);
        const before = raw.slice(0, index);
        const after = raw.slice(index + stripped.length);
        add(node.getStart(sf), node.getEnd(sf), `${before}{t(${JSON.stringify(stripped)})}${after}`);
        usesT = true;
        return;
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const value = node.initializer.text;
      if (CJK.test(value)) {
        add(
          node.initializer.getStart(sf),
          node.initializer.getEnd(sf),
          `{t(${JSON.stringify(value)})}`,
        );
        usesT = true;
      }
    }

    if (ts.isNoSubstitutionTemplateLiteral(node) && CJK.test(node.text)) {
      const parent = node.parent;
      const blocked =
        parent &&
        (ts.isPropertyAssignment(parent) && parent.name === node ||
          ts.isImportDeclaration(parent) ||
          isWrapped(node));
      if (!blocked && insideFunction(node)) {
        add(node.getStart(sf), node.getEnd(sf), `t(${JSON.stringify(node.text)})`);
        usesT = true;
        return;
      }
    }

    if (ts.isTemplateExpression(node) && insideFunction(node)) {
      const spans = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (CJK.test(spans.join(""))) {
        let template = spans[0];
        const values = [];
        node.templateSpans.forEach((span, index) => {
          template += `{${index}}${spans[index + 1]}`;
          values.push(span.expression.getText(sf));
        });
        add(
          node.getStart(sf),
          node.getEnd(sf),
          `tf(${JSON.stringify(template)}, ${values.join(", ")})`,
        );
        usesTf = true;
        return;
      }
    }

    if (ts.isStringLiteral(node) && CJK.test(node.text) && insideFunction(node) && !shouldSkipString(node)) {
      add(node.getStart(sf), node.getEnd(sf), `t(${JSON.stringify(node.text)})`);
      usesT = true;
      return;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return { file, changed: 0 };

  edits.sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  const relative = path.relative(path.dirname(file), i18nDir).replace(/\\/g, "/");
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  const names = [usesT ? "t" : null, usesTf ? "tf" : null].filter(Boolean).join(", ");
  const importLine = `import { ${names} } from "${specifier}";\n`;

  // 放在最后一条 import 之后，保持 import 区整洁。
  const importMatches = [...output.matchAll(/^import [^;]+;\s*$/gm)];
  if (importMatches.length > 0) {
    const last = importMatches[importMatches.length - 1];
    const index = last.index + last[0].length;
    output = `${output.slice(0, index)}\n${importLine}${output.slice(index)}`.replace(/\n\n\n+/g, "\n\n");
  } else {
    output = importLine + output;
  }

  if (!dry) fs.writeFileSync(file, output, "utf8");
  return { file, changed: edits.length };
}

const files = explicit.length > 0 ? explicit.map((f) => path.resolve(f)) : collectFiles(srcDir);
let total = 0;
for (const file of files) {
  const result = transform(file);
  if (result.changed > 0) {
    total += result.changed;
    console.log(`${path.relative(root, result.file)}: ${result.changed}`);
  }
}
console.log(`共改写 ${total} 处${dry ? "（dry run）" : ""}`);
