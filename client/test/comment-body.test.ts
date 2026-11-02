import { describe, expect, it } from "vitest";
import { commentPlainText, decodeEntities, parseCommentBody } from "../src/lib/comment-body";

describe("parseCommentBody", () => {
  it("纯文本按换行分段", () => {
    expect(parseCommentBody("第一行\n第二行")).toEqual([
      { kind: "text", text: "第一行" },
      { kind: "break" },
      { kind: "text", text: "第二行" },
    ]);
  });

  it("保留加粗、斜体与行内代码", () => {
    const nodes = parseCommentBody("<p>4K 屏下 <strong>字体偏小</strong>，<em>能加</em> <code>zoom</code> 吗</p>");
    expect(nodes.map((node) => node.kind)).toEqual([
      "text",
      "strong",
      "text",
      "em",
      "text",
      "code",
      "text",
    ]);
    expect(nodes[1]).toEqual({ kind: "strong", text: "字体偏小" });
    expect(nodes[5]).toEqual({ kind: "code", text: "zoom" });
  });

  it("链接只保留 http(s)", () => {
    const ok = parseCommentBody('<a href="https://ruodao.com/x" target="_blank">若道</a>');
    expect(ok).toEqual([{ kind: "link", text: "若道", href: "https://ruodao.com/x" }]);

    const bad = parseCommentBody('<a href="javascript:alert(1)">点我</a>');
    expect(bad).toEqual([{ kind: "text", text: "点我" }]);
  });

  it("丢弃脚本与事件属性（只留文字）", () => {
    const nodes = parseCommentBody('<img src=x onerror="alert(1)"><script>alert(2)</script>安全');
    expect(nodes.every((node) => node.kind === "text" || node.kind === "break")).toBe(true);
    expect(commentPlainText('<img src=x onerror="alert(1)"><script>alert(2)</script>安全')).toBe(
      "alert(2)安全",
    );
  });

  it("解码常见实体", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#48; &#x41; &nbsp;")).toBe(
      "a & b <c> \"d\" 0 A  ",
    );
  });

  it("空内容返回空数组，末尾多余分隔被裁掉", () => {
    expect(parseCommentBody("   ")).toEqual([]);
    expect(parseCommentBody("<p>正文</p><p></p>")).toEqual([{ kind: "text", text: "正文" }]);
  });

  it("纯文本不做二次转义误伤", () => {
    expect(parseCommentBody("a < b")).toEqual([{ kind: "text", text: "a < b" }]);
  });
});
