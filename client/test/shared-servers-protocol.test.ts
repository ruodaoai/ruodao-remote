import { describe, expect, it } from "vitest";
import {
  dateInputValue,
  describeSharedServerError,
  expiresInDays,
  maxExpiryDateValue,
  normalizeSharedServerAddress,
  parseSharedServerInfo,
  parseSharedServerPage,
  readReportInput,
  readSharedServerId,
  sanitizeExpiry,
  sanitizeSharedServerForm,
} from "../electron/shared-servers-protocol";

function form(overrides: Record<string, unknown> = {}) {
  return {
    name: "社区共享服务器",
    address: "remote.example.com:8787",
    region: "香港",
    specs: "2 核 4G · 5Mbps",
    maxDevices: "20",
    inviteCode: "ab12-cd34",
    note: "免费给社区使用",
    expiresAt: dateInputValue(),
    ...overrides,
  };
}

describe("shared server address", () => {
  it("adds https and strips trailing slashes", () => {
    expect(normalizeSharedServerAddress("remote.example.com:8787/")).toBe(
      "https://remote.example.com:8787",
    );
    expect(normalizeSharedServerAddress(" HTTPS://Remote.Example.com ")).toBe(
      "https://remote.example.com",
    );
  });

  it("keeps ipv6 hosts in brackets", () => {
    expect(normalizeSharedServerAddress("https://[2001:4860:4860::8888]:8787")).toBe(
      "https://[2001:4860:4860::8888]:8787",
    );
  });

  it("rejects non-https and paths", () => {
    expect(() => normalizeSharedServerAddress("http://remote.example.com")).toThrow(/HTTPS/);
    expect(() => normalizeSharedServerAddress("https://remote.example.com/remote")).toThrow(
      /路径/,
    );
    expect(() => normalizeSharedServerAddress("https://user:pass@remote.example.com")).toThrow(
      /用户名或密码/,
    );
    expect(() => normalizeSharedServerAddress("https://remote.example.com?x=1")).toThrow(
      /查询参数/,
    );
  });
});

describe("shared server form", () => {
  it("normalizes address, invite code and device limit", () => {
    const result = sanitizeSharedServerForm(form());
    expect(result.address).toBe("https://remote.example.com:8787");
    expect(result.inviteCode).toBe("AB12CD34");
    expect(result.maxDevices).toBe(20);
    expect(result.expiresAt).toBe(dateInputValue());
  });

  it("treats blank optional fields as empty", () => {
    const result = sanitizeSharedServerForm(
      form({ address: "https://8.8.8.8", region: " ", maxDevices: "", inviteCode: " " }),
    );
    expect(result.address).toBe("https://8.8.8.8");
    expect(result.region).toBe("");
    expect(result.maxDevices).toBeNull();
    expect(result.inviteCode).toBe("");
  });

  it("rejects short names and invalid invite codes", () => {
    expect(() => sanitizeSharedServerForm(form({ name: "远" }))).toThrow(/2 个字符/);
    expect(() => sanitizeSharedServerForm(form({ inviteCode: "ab1" }))).toThrow(/4-32/);
    expect(() => sanitizeSharedServerForm(form({ maxDevices: "0" }))).toThrow(/1-10000/);
  });

  it("keeps expiry within today and one year", () => {
    expect(() => sanitizeExpiry("2000-01-01")).toThrow(/不能早于今天/);
    expect(sanitizeExpiry(maxExpiryDateValue())).toBe(maxExpiryDateValue());
    expect(() => sanitizeExpiry("2026-02-31")).toThrow(/无效/);
  });
});

describe("shared server parsing", () => {
  const server = {
    id: "srv-1",
    name: "社区共享服务器",
    address: "https://8.8.8.8:8787",
    host: "8.8.8.8:8787",
    region: "香港",
    specs: "2 核 4G",
    maxDevices: 20,
    inviteCode: "AB12CD34",
    note: "免费",
    expiresAt: "2026-11-07T23:59:59",
    status: "active",
    online: true,
    healthStatus: "online",
    serverVersion: "0.3.0",
    registrationMode: "invite",
    peers: 2,
    sessions: 0,
    lastCheckedAt: "2026-10-31T18:00:00",
    createdAt: "2026-10-31T12:00:00",
  };

  it("parses a server and tolerates missing fields", () => {
    expect(parseSharedServerInfo(server)).toMatchObject({
      id: "srv-1",
      name: "社区共享服务器",
      online: true,
      peers: 2,
    });
    expect(parseSharedServerInfo({ id: "x" })).toMatchObject({
      id: "x",
      name: "未命名服务器",
      status: "active",
      online: false,
      inviteCode: "",
    });
    expect(parseSharedServerInfo({})).toBeNull();
    expect(parseSharedServerInfo(null)).toBeNull();
  });

  it("unwraps api pages and drops invalid rows", () => {
    const page = parseSharedServerPage({
      success: true,
      data: { items: [server, { name: "no-id" }], total: 1, page: 2, size: 8 },
    });
    expect(page.items.map((item) => item.id)).toEqual(["srv-1"]);
    expect(page.total).toBe(1);
    expect(page.page).toBe(2);
  });

  it("describes backend errors", () => {
    expect(describeSharedServerError(400, { message: "该服务器地址已在共享列表中" }, "失败").message).toBe(
      "该服务器地址已在共享列表中",
    );
    expect(describeSharedServerError(401, {}, "失败").message).toMatch(/登录若道账号/);
    expect(describeSharedServerError(403, {}, "失败").message).toMatch(/没有权限/);
    expect(describeSharedServerError(404, {}, "失败").message).toMatch(/不存在或已下架/);
    expect(describeSharedServerError(429, {}, "失败").message).toMatch(/频繁/);
  });

  it("reads ids and report reasons", () => {
    expect(readSharedServerId({ id: "b4b2c4e8-8a11-4a5c-9e3d-9b8f2f0a1c22" })).toBe(
      "b4b2c4e8-8a11-4a5c-9e3d-9b8f2f0a1c22",
    );
    expect(() => readSharedServerId("bad id")).toThrow(/不合法/);
    expect(readReportInput({ id: "abc-1234", reason: " 打不开 " })).toEqual({
      id: "abc-1234",
      reason: "打不开",
    });
  });

  it("computes expiry countdown", () => {
    const now = new Date(2026, 9, 31, 12, 0, 0);
    expect(expiresInDays("2026-11-07T23:59:59", now)).toBe(7);
    expect(expiresInDays(null, now)).toBeNull();
  });
});
