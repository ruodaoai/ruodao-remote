import { describe, expect, it } from "vitest";
import {
  OPEN_SOURCE_COMMENT_LIMIT,
  absoluteUrl,
  describeOpenSourceHttpError,
  isSafeExternalUrl,
  parseOpenSourceComment,
  parseOpenSourceCommentPage,
  parseOpenSourceIdentity,
  parseOpenSourceProduct,
  pickOpenSourceSlug,
  readCommentPage,
  sanitizeCommentInput,
} from "../electron/open-source-protocol";

const PRODUCT = {
  id: "a3000000-0000-4000-8000-000000000001",
  slug: "ruodao-remote",
  title: "若道远程",
  summary: "免注册的 Windows 远程控制",
  appTags: "远程控制,WebRTC, 免注册 ,,远程控制",
  category: "效率工具",
  version: "0.1.0",
  authorDisplayName: "若道精选",
  authorAvatarUrl: "/uploads/a.png",
  licenseName: "MIT",
  repositoryUrl: "https://github.com/ruodaoai/ruodao-remote",
  communityUrl: "https://ruodao.com/open-source/ruodao-remote",
  communityApiUrl: "https://ruodao.com/api/public/apps/ruodao-remote/comments",
  integrationDocUrl: "https://ruodao.com/open-source/docs",
  downloadUrl: "https://github.com/ruodaoai/ruodao-remote/releases/download/v0.1.0/x.exe",
  changelog: "首个公开版本",
  commentCount: 1,
  likeCount: 0,
  official: true,
  featured: true,
  publishedAt: "2026-11-01T17:22:28.5",
  updatedAt: "2026-11-02T09:00:00",
};

const COMMENT = {
  id: "comment-1",
  itemId: PRODUCT.id,
  userId: "user-1",
  userEmail: "38*****43@qq.com",
  userDisplayName: "大海无量",
  userAvatarUrl: null,
  body: "<p>hello world</p>",
  owner: false,
  parentCommentId: null,
  replyToUserId: null,
  replyToUserDisplayName: null,
  replyCount: 1,
  replies: [
    {
      id: "comment-2",
      userId: "user-2",
      userDisplayName: "阿飞",
      body: "可以用缩放设置",
      owner: true,
      parentCommentId: "comment-1",
      replyToUserDisplayName: "大海无量",
      replyCount: 0,
      replies: [],
      createdAt: "2026-11-02T12:00:00",
    },
  ],
  createdAt: "2026-11-02T11:47:37.39",
};

describe("parseOpenSourceProduct", () => {
  it("收敛公开详情字段并补全相对头像地址", () => {
    const product = parseOpenSourceProduct(PRODUCT, "https://ruodao.com");
    expect(product.title).toBe("若道远程");
    expect(product.licenseName).toBe("MIT");
    expect(product.commentCount).toBe(1);
    expect(product.official).toBe(true);
    expect(product.tags).toEqual(["远程控制", "WebRTC", "免注册"]);
    expect(product.authorAvatarUrl).toBe("https://ruodao.com/uploads/a.png");
    expect(product.communityUrl).toBe("https://ruodao.com/open-source/ruodao-remote");
  });

  it("缺少社区地址时按 slug 回退，缺失标识时报错", () => {
    const product = parseOpenSourceProduct({ slug: "ruodao-remote" }, "https://ruodao.com");
    expect(product.communityUrl).toBe("https://ruodao.com/open-source/ruodao-remote");
    expect(product.integrationDocUrl).toBe("https://ruodao.com/open-source/docs");
    expect(() => parseOpenSourceProduct({}, "https://ruodao.com")).toThrow();
  });
});

describe("pickOpenSourceSlug", () => {
  const items = [
    { slug: "ruodao-office", openSource: true },
    { slug: "ruodao-remote", openSource: true },
  ];

  it("优先精确匹配 slug", () => {
    expect(pickOpenSourceSlug(items, "ruodao-remote")).toBe("ruodao-remote");
  });

  it("目录里没有目标条目时返回空串", () => {
    expect(pickOpenSourceSlug(items, "ruodao-guard-pro")).toBe("");
    expect(pickOpenSourceSlug(items, "something-else")).toBe("");
    expect(pickOpenSourceSlug(null, "ruodao-remote")).toBe("");
  });
});

describe("comments", () => {
  it("解析评论与一层回复", () => {
    const comment = parseOpenSourceComment(COMMENT);
    expect(comment?.authorName).toBe("大海无量");
    expect(comment?.replies).toHaveLength(1);
    expect(comment?.replies[0].owner).toBe(true);
    expect(comment?.replies[0].replyToName).toBe("大海无量");
    expect(comment).not.toHaveProperty("userEmail");
  });

  it("没有 id 的评论被丢弃", () => {
    expect(parseOpenSourceComment({ body: "hi" })).toBeNull();
  });

  it("分页信息按上限收敛", () => {
    const page = parseOpenSourceCommentPage(
      { items: [COMMENT], total: 12, page: 2, size: 500 },
      { page: 1, size: 10 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(12);
    expect(page.page).toBe(2);
    expect(page.size).toBe(50);
  });

  it("缺字段时回落到请求参数", () => {
    const page = parseOpenSourceCommentPage({ items: [] }, { page: 3, size: 8 });
    expect(page.page).toBe(3);
    expect(page.size).toBe(8);
    expect(page.total).toBe(0);
  });
});

describe("identity", () => {
  it("匿名访问返回 null", () => {
    expect(parseOpenSourceIdentity(null)).toBeNull();
    expect(parseOpenSourceIdentity({})).toBeNull();
  });

  it("读取统一身份", () => {
    const identity = parseOpenSourceIdentity({
      userId: "0d9f1b9c",
      displayName: "若道用户",
      avatarUrl: "/a.png",
      maskedEmail: "a***@example.com",
    });
    expect(identity?.userId).toBe("0d9f1b9c");
    expect(identity?.maskedEmail).toBe("a***@example.com");
  });
});

describe("sanitizeCommentInput", () => {
  it("去掉首尾空白并统一换行", () => {
    expect(sanitizeCommentInput({ body: "  好用\r\n推荐  " }).body).toBe("好用\n推荐");
  });

  it("空内容与超长内容被拒绝", () => {
    expect(() => sanitizeCommentInput({ body: "   " })).toThrow();
    expect(() =>
      sanitizeCommentInput({ body: "字".repeat(OPEN_SOURCE_COMMENT_LIMIT + 1) }),
    ).toThrow();
  });

  it("保留回复目标", () => {
    expect(sanitizeCommentInput({ body: "同意", parentCommentId: "c-1" }).parentCommentId).toBe(
      "c-1",
    );
  });
});

describe("describeOpenSourceHttpError", () => {
  it("401 提示重新登录", () => {
    const error = describeOpenSourceHttpError(401, { message: "unauthorized" }, "fallback");
    expect(error.status).toBe(401);
    expect(error.message).toContain("登录");
  });

  it("403 区分 scope 不足", () => {
    const error = describeOpenSourceHttpError(
      403,
      { errorCode: "FORBIDDEN", message: "access token is missing the app:comments scope" },
      "fallback",
    );
    expect(error.message).toContain("app:comments");
  });

  it("400 透出服务端校验信息", () => {
    expect(
      describeOpenSourceHttpError(400, { message: "body 最长 1000 字" }, "fallback").message,
    ).toBe("body 最长 1000 字");
  });

  it("5xx 用兜底文案", () => {
    expect(describeOpenSourceHttpError(502, null, "fallback").message).toContain("暂时不可用");
  });
});

describe("readCommentPage / absoluteUrl / 外链校验", () => {
  it("分页参数收敛到合法范围", () => {
    expect(readCommentPage({ page: 0, size: 999 })).toEqual({ page: 1, size: 50 });
    expect(readCommentPage({ page: "3", size: "5" })).toEqual({ page: 3, size: 5 });
  });

  it("相对地址补全为绝对地址", () => {
    expect(absoluteUrl("https://ruodao.com", "/uploads/a.png")).toBe(
      "https://ruodao.com/uploads/a.png",
    );
    expect(absoluteUrl("https://ruodao.com", "javascript:alert(1)")).toBe("");
  });

  it("只放行 http(s)", () => {
    expect(isSafeExternalUrl("https://ruodao.com/open-source/ruodao-remote")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///c:/windows/system32")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});
