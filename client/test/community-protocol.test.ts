import { describe, expect, it } from "vitest";
import {
  COMMUNITY_CONTENT_LIMIT,
  communityAppList,
  communityNotFoundError,
  describeCommunityHttpError,
  normalizeCommunityName,
  parseCommunityApp,
  parseCommunityReview,
  parseCommunityThread,
  pickCommunityApp,
  readCommunityReviewId,
  sanitizeReviewInput,
} from "../electron/community-protocol";

const APP = {
  id: "app-1",
  slug: "ruodao-remote-control",
  displayName: "若道远程控制",
  summary: "用远控码直连的桌面远控工具",
  iconUrl: "https://ruodao.com/icon.png",
  authorUserId: "user-owner",
};

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    rating: 5,
    content: "很好用，连上就能操作。",
    userLabel: "阿飞",
    userAvatarUrl: "",
    verified: true,
    createdAt: "2026-10-30T12:00:00",
    helpful: false,
    helpfulCount: 3,
    authorReply: "感谢反馈，后续会继续优化。",
    mine: false,
    ...overrides,
  };
}

describe("community app discovery", () => {
  it("normalizes names for tolerant matching", () => {
    expect(normalizeCommunityName(" 若道 远程-控制 ")).toBe("若道远程控制");
    expect(normalizeCommunityName("Ruodao Remote_Control")).toBe("ruodaoremotecontrol");
  });

  it("picks 若道远程控制 from the market and ignores other 若道 plugins", () => {
    const picked = pickCommunityApp([
      { id: "a", slug: "ruodao-guard", displayName: "若道安全卫士" },
      APP,
      { id: "b", slug: "interview-assistant", displayName: "面试求职助手" },
    ]);
    expect(picked?.id).toBe("app-1");
    expect(picked?.name).toBe("若道远程控制");
    expect(picked?.pagePath).toBe("/plugin-market/items/ruodao-remote-control");
  });

  it("matches the slug when the display name is different", () => {
    const picked = pickCommunityApp([
      { id: "app-2", slug: "ruodao-remote-control", displayName: "桌面远控" },
    ]);
    expect(picked?.id).toBe("app-2");
  });

  it("keeps ecosystem page paths separate", () => {
    const app = parseCommunityApp(APP, "ecosystem");
    expect(app?.source).toBe("ecosystem");
    expect(app?.pagePath).toBe("/ecosystem/items/ruodao-remote-control");
  });

  it("reads lists from arrays and the items envelope", () => {
    expect(communityAppList({ success: true, data: { items: [APP] } })).toHaveLength(1);
    expect(communityAppList({ success: true, data: [APP] })).toHaveLength(1);
    expect(communityAppList({ success: true, data: { apps: [APP] } })).toHaveLength(1);
  });
});

describe("community review parsing", () => {
  it("parses a full review and clamps the rating", () => {
    const parsed = parseCommunityReview(review({ rating: 9 }));
    expect(parsed).toMatchObject({
      id: "review-1",
      rating: 5,
      userLabel: "阿飞",
      verified: true,
      helpfulCount: 3,
      mine: false,
    });
    expect(parsed?.authorReply?.content).toBe("感谢反馈，后续会继续优化。");
  });

  it("supports legacy string replies and numeric helpful fields", () => {
    const parsed = parseCommunityReview(
      review({ authorReply: "已修复", helpful: 7, helpfulCount: undefined }),
    );
    expect(parsed?.authorReply).toEqual({ content: "已修复", createdAt: "" });
    expect(parsed?.helpful).toBe(false);
    expect(parsed?.helpfulCount).toBe(7);
  });

  it("drops entries without an id", () => {
    expect(parseCommunityReview({ content: "匿名" })).toBeNull();
  });

  it("parses the thread, excluding my own review from the public list", () => {
    const thread = parseCommunityThread(
      {
        success: true,
        data: {
          ratingAvg: "4.6",
          ratingCount: 12,
          distribution: [8, 3, 1, 0, 0],
          tipCount: 2,
          tipTotal: 16,
          myReview: review({ id: "mine-1", mine: true, content: "我的留言" }),
          items: [
            review({ id: "review-1" }),
            review({ id: "mine-1", mine: true, content: "我的留言" }),
            review({ id: "review-1" }),
            review({ id: "review-2", rating: 4 }),
          ],
          total: 12,
          page: 1,
          size: 8,
        },
      },
      {
        id: "app-1",
        slug: "ruodao-remote-control",
        name: "若道远程控制",
        summary: "",
        iconUrl: "",
        pagePath: "/plugin-market/items/ruodao-remote-control",
        source: "plugin-market",
        authorUserId: "user-owner",
        submittedByMe: false,
      },
      { page: 1, size: 8, signedIn: true, isOwner: false },
    );
    expect(thread.summary.ratingAvg).toBe(4.6);
    expect(thread.summary.distribution).toEqual([8, 3, 1, 0, 0]);
    expect(thread.myReview?.id).toBe("mine-1");
    expect(thread.items.map((item) => item.id)).toEqual(["review-1", "review-2"]);
    expect(thread.total).toBe(12);
    expect(thread.signedIn).toBe(true);
  });
});

describe("community input validation", () => {
  it("accepts 1-5 stars with optional text", () => {
    expect(sanitizeReviewInput({ rating: 4, content: "  挺稳的  " })).toEqual({
      rating: 4,
      content: "挺稳的",
    });
    expect(sanitizeReviewInput({ rating: 5, content: "" })).toEqual({ rating: 5, content: "" });
  });

  it("rejects missing ratings and oversized content", () => {
    expect(() => sanitizeReviewInput({ rating: 0, content: "x" })).toThrow("1–5 星");
    expect(() => sanitizeReviewInput({ rating: 3.5, content: "x" })).toThrow("1–5 星");
    expect(() =>
      sanitizeReviewInput({ rating: 4, content: "字".repeat(COMMUNITY_CONTENT_LIMIT + 1) }),
    ).toThrow(`最多 ${COMMUNITY_CONTENT_LIMIT} 字`);
  });

  it("validates review ids before building URLs", () => {
    expect(readCommunityReviewId({ reviewId: "9b1c2d3e-4f56-7890-abcd-ef1234567890" })).toBe(
      "9b1c2d3e-4f56-7890-abcd-ef1234567890",
    );
    expect(() => readCommunityReviewId({ reviewId: "../admin" })).toThrow("标识不合法");
  });
});

describe("community errors", () => {
  it("maps auth and permission failures to actionable copy", () => {
    expect(describeCommunityHttpError(401, {}, "x").message).toContain("重新登录");
    expect(describeCommunityHttpError(403, {}, "x").message).toContain("作者不能给自己");
    expect(
      describeCommunityHttpError(403, { message: "cannot review your own item" }, "x").message,
    ).toBe("cannot review your own item");
    expect(describeCommunityHttpError(404, {}, "x").message).toContain("不存在");
    expect(describeCommunityHttpError(429, {}, "x").message).toContain("频繁");
    expect(describeCommunityHttpError(502, {}, "x").message).toContain("暂时不可用");
  });

  it("keeps a dedicated not-found message for discovery", () => {
    expect(communityNotFoundError().status).toBe(404);
    expect(communityNotFoundError().message).toContain("插件市场");
  });
});
