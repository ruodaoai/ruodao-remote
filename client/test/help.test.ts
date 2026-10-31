import { describe, expect, it } from "vitest";
import {
  filterHelpFaqs,
  filterHelpScenarios,
  findHelpFaq,
  HELP_FAQS,
  HELP_SCENARIOS,
} from "../src/lib/help";

describe("help content", () => {
  it("keeps scenario and FAQ ids unique", () => {
    expect(new Set(HELP_SCENARIOS.map((item) => item.id)).size).toBe(HELP_SCENARIOS.length);
    expect(new Set(HELP_FAQS.map((item) => item.id)).size).toBe(HELP_FAQS.length);
    expect(HELP_SCENARIOS.every((item) => item.steps.length >= 3)).toBe(true);
  });

  it("links every detected issue FAQ id to real content", () => {
    const ids = new Set(HELP_FAQS.map((item) => item.id));
    for (const id of [
      "approval",
      "invite",
      "blocked",
      "server-url",
      "not-found",
      "invalid-key",
      "screen",
      "input",
      "deploy-fail",
      "deploy-prepare",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe("filterHelpFaqs", () => {
  it("returns everything for an empty query", () => {
    expect(filterHelpFaqs("")).toHaveLength(HELP_FAQS.length);
    expect(filterHelpFaqs("   ")).toHaveLength(HELP_FAQS.length);
  });

  it("matches Chinese keywords and answers", () => {
    expect(filterHelpFaqs("邀请码").map((item) => item.id)).toContain("invite");
    expect(filterHelpFaqs("黑屏").map((item) => item.id)).toContain("screen");
    expect(filterHelpFaqs("管理员密码").map((item) => item.id)).toContain("admin-password");
  });

  it("is case-insensitive for English terms", () => {
    expect(filterHelpFaqs("turn").map((item) => item.id)).toContain("screen");
    expect(filterHelpFaqs("SYSTEMCTL").map((item) => item.id)).toContain("stop-server");
  });

  it("returns nothing for unrelated text", () => {
    expect(filterHelpFaqs("火星天气")).toEqual([]);
  });
});

describe("filterHelpScenarios", () => {
  it("returns all scenarios for an empty query", () => {
    expect(filterHelpScenarios("")).toHaveLength(HELP_SCENARIOS.length);
  });

  it("filters matching steps within a scenario", () => {
    const scenarios = filterHelpScenarios("主屏幕");
    const ids = scenarios.map((item) => item.id);
    expect(ids).toEqual(["host"]);
    const host = scenarios[0];
    expect(host.steps).toHaveLength(1);
    expect(`${host.steps[0].title}${host.steps[0].detail}`).toContain("主屏幕");
  });

  it("keeps all steps when the title or note matches", () => {
    const scenarios = filterHelpScenarios("远控码");
    const ids = scenarios.map((item) => item.id);
    expect(ids).toContain("host");
    expect(ids).toContain("control");
    expect(scenarios.find((item) => item.id === "host")?.steps).toHaveLength(3);
  });

  it("keeps the full step list when the scenario summary matches", () => {
    const scenarios = filterHelpScenarios("分享");
    const share = scenarios.find((item) => item.id === "share");
    expect(share?.steps).toHaveLength(3);
  });
});

describe("findHelpFaq", () => {
  it("finds existing entries and returns null otherwise", () => {
    expect(findHelpFaq("deploy-fail")?.question).toContain("部署失败");
    expect(findHelpFaq("missing")).toBeNull();
  });
});
