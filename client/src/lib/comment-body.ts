/**
 * 评论正文渲染：把服务端返回的「已消毒 HTML」再收敛成受控节点。
 *
 * 为什么不直接 `dangerouslySetInnerHTML`：渲染进程一旦执行注入的脚本或事件属性，
 * 就等于把远端内容当成本地代码跑。这里只认一小撮行内标签，其余一律当纯文本，
 * 链接也只保留 http/https，交给主进程调用系统浏览器打开。
 */

export type CommentNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "break" };

const INLINE_TAGS = new Set(["strong", "b", "em", "i", "code", "a", "span", "mark"]);
const BLOCK_TAGS = new Set(["p", "div", "li", "ul", "ol", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
const VOID_BREAK_TAGS = new Set(["br", "hr"]);
const MAX_NODES = 600;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    const named = ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

function attributeValue(attributes: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attributes);
  if (!match) return "";
  return decodeEntities((match[2] ?? match[3] ?? match[4] ?? "").trim());
}

function pushText(nodes: CommentNode[], text: string, style: { bold: boolean; italic: boolean; code: boolean; href: string }): void {
  if (!text) return;
  if (style.href && isSafeHref(style.href)) {
    nodes.push({ kind: "link", text, href: style.href });
    return;
  }
  if (style.code) nodes.push({ kind: "code", text });
  else if (style.bold) nodes.push({ kind: "strong", text });
  else if (style.italic) nodes.push({ kind: "em", text });
  else nodes.push({ kind: "text", text });
}

function pushBreak(nodes: CommentNode[]): void {
  const last = nodes[nodes.length - 1];
  if (!last || last.kind === "break") return;
  nodes.push({ kind: "break" });
}

/**
 * 把 HTML 片段转成受控节点数组；纯文本输入按换行分段。
 */
export function parseCommentBody(input: string): CommentNode[] {
  const html = String(input ?? "");
  if (!html.trim()) return [];
  const nodes: CommentNode[] = [];

  // 纯文本（没有标签）直接按行处理，保留用户原本的换行。
  if (!/<[a-zA-Z/!]/.test(html)) {
    for (const [index, line] of html.split(/\r?\n/).entries()) {
      if (index > 0) pushBreak(nodes);
      pushText(nodes, line, { bold: false, italic: false, code: false, href: "" });
    }
    return nodes.slice(0, MAX_NODES);
  }

  const style = { bold: 0, italic: 0, code: 0, href: "" };
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const flushText = (text: string): void => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded.trim()) {
      // 标签之间只有空白时，用一个空格保持词间距，避免把「a <b>b</b>」粘成「ab」。
      if (nodes.length > 0 && decoded.includes(" ")) {
        pushText(nodes, " ", { bold: false, italic: false, code: false, href: "" });
      }
      return;
    }
    pushText(nodes, decoded, {
      bold: style.bold > 0,
      italic: style.italic > 0,
      code: style.code > 0,
      href: style.href,
    });
  };

  while (nodes.length < MAX_NODES) {
    match = tagPattern.exec(html);
    if (!match) break;
    flushText(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attributes = match[3] ?? "";

    if (VOID_BREAK_TAGS.has(tag)) {
      pushBreak(nodes);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      // 块级标签开合都当作段落分隔，连续分隔由 pushBreak 去重。
      pushBreak(nodes);
      continue;
    }
    if (!INLINE_TAGS.has(tag)) continue;

    if (tag === "a") {
      if (closing) style.href = "";
      else style.href = attributeValue(attributes, "href");
      continue;
    }
    if (tag === "strong" || tag === "b") {
      style.bold = Math.max(0, style.bold + (closing ? -1 : 1));
      continue;
    }
    if (tag === "em" || tag === "i") {
      style.italic = Math.max(0, style.italic + (closing ? -1 : 1));
      continue;
    }
    if (tag === "code" || tag === "pre") {
      style.code = Math.max(0, style.code + (closing ? -1 : 1));
    }
  }
  flushText(html.slice(cursor));

  while (nodes.length > 0 && nodes[nodes.length - 1].kind === "break") nodes.pop();
  return nodes.slice(0, MAX_NODES);
}

/** 便于无障碍朗读与摘要的纯文本。 */
export function commentPlainText(input: string): string {
  return parseCommentBody(input)
    .map((node) => (node.kind === "break" ? "\n" : node.text))
    .join("")
    .trim();
}
