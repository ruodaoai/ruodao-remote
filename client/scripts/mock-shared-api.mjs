#!/usr/bin/env node
/**
 * 本地模拟 ruodao.com 的共享服务器接口，供 UI 验收使用。
 * 用法：node scripts/mock-shared-api.mjs [--port 19300]
 */
import crypto from "node:crypto";
import http from "node:http";

const nowStamp = () => {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T23:59:59`;
}

function seedServers() {
  const make = (index, extra) => ({
    id: `srv-mock-${String(index + 1).padStart(2, "0")}`,
    host: new URL(extra.address).host,
    maxDevices: 20,
    inviteCode: "",
    note: "",
    status: "active",
    online: true,
    healthStatus: "healthy",
    serverVersion: "1.0.3",
    registrationMode: "invite",
    peers: 4,
    sessions: 0,
    lastCheckedAt: nowStamp(),
    createdAt: "2026-10-12T09:30:00",
    ...extra,
  });
  return [
    make(0, {
      name: "华东 · 上海公益服",
      address: "https://sh.remote-demo.cn",
      region: "上海",
      specs: "2 核 4G · 5Mbps",
      maxDevices: 30,
      inviteCode: "AB12CD34",
      note: "社区公益服务器，请勿运行挖矿或长期挂机。",
      expiresAt: dateAfter(26),
      peers: 12,
      sessions: 2,
    }),
    make(1, {
      name: "华南 · 广州移动",
      address: "https://gz.remote-demo.cn",
      region: "广州",
      specs: "4 核 8G · 10Mbps",
      maxDevices: 50,
      inviteCode: "GZ88MOVE",
      note: "晚高峰可能排队，建议白天使用。",
      expiresAt: dateAfter(5),
      peers: 7,
      sessions: 1,
      online: false,
      healthStatus: "offline",
    }),
    make(2, {
      name: "华北 · 北京联通",
      address: "https://bj.remote-demo.cn",
      region: "北京",
      specs: "2 核 2G · 3Mbps",
      maxDevices: 10,
      inviteCode: "",
      note: "开放接入，无需邀请码。",
      registrationMode: "open",
      expiresAt: dateAfter(88),
      peers: 23,
      sessions: 4,
    }),
    make(3, {
      name: "海外 · 东京中转",
      address: "https://tokyo.remote-demo.cn",
      region: "日本",
      specs: "2 核 4G · 30Mbps",
      maxDevices: 20,
      inviteCode: "JP2026RT",
      note: "适合海外设备互控，延迟约 90ms。",
      expiresAt: dateAfter(140),
      peers: 5,
      sessions: 0,
    }),
    make(4, {
      name: "西南 · 成都电信",
      address: "https://cd.remote-demo.cn",
      region: "成都",
      specs: "1 核 2G · 4Mbps",
      maxDevices: 8,
      inviteCode: "CD46TEST",
      expiresAt: dateAfter(41),
      peers: 2,
      sessions: 0,
    }),
    make(5, {
      name: "华中 · 武汉教育网",
      address: "https://wh.remote-demo.cn",
      region: "武汉",
      specs: "2 核 4G · 6Mbps",
      maxDevices: 16,
      inviteCode: "WHEDU668",
      note: "教育网线路，寒暑假期间在线率更高。",
      expiresAt: dateAfter(63),
      peers: 3,
      sessions: 0,
    }),
    make(6, {
      name: "西北 · 西安 BGP",
      address: "https://xa.remote-demo.cn",
      region: "西安",
      specs: "2 核 2G · 5Mbps",
      maxDevices: 12,
      inviteCode: "XA77BGP2",
      expiresAt: dateAfter(19),
      peers: 6,
      sessions: 1,
    }),
    make(7, {
      name: "东北 · 沈阳联通",
      address: "https://sy.remote-demo.cn",
      region: "沈阳",
      specs: "2 核 4G · 8Mbps",
      maxDevices: 24,
      inviteCode: "SY55NET8",
      note: "夜间维护较频繁，白天更稳定。",
      expiresAt: dateAfter(9),
      peers: 1,
      sessions: 0,
      online: false,
      healthStatus: "offline",
    }),
    make(8, {
      name: "华南 · 深圳高防",
      address: "https://sz.remote-demo.cn",
      region: "深圳",
      specs: "4 核 8G · 20Mbps",
      maxDevices: 100,
      inviteCode: "SZ99GUARD",
      note: "带 100G 高防，适合长期挂机。",
      expiresAt: dateAfter(210),
      peers: 31,
      sessions: 6,
    }),
  ];
}

function sortServers(items, sort) {
  const copy = [...items];
  if (sort === "newest") {
    copy.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  } else if (sort === "expiring") {
    copy.sort((left, right) => String(left.expiresAt).localeCompare(String(right.expiresAt)));
  } else {
    copy.sort((left, right) => {
      if (left.online !== right.online) return left.online ? -1 : 1;
      return (right.peers ?? 0) - (left.peers ?? 0);
    });
  }
  return copy;
}

/** 英文界面截图使用的展示数据，顺序与 seedServers 一致。 */
const EN_SERVERS = [
  { name: "East China · Shanghai community", region: "Shanghai", specs: "2 vCPU 4 GB · 5 Mbps", note: "Community server — no mining or long unattended sessions." },
  { name: "South China · Guangzhou Mobile", region: "Guangzhou", specs: "4 vCPU 8 GB · 10 Mbps", note: "Busy at peak hours; daytime works better." },
  { name: "North China · Beijing Unicom", region: "Beijing", specs: "2 vCPU 2 GB · 3 Mbps", note: "Open access, no invite code required." },
  { name: "Overseas · Tokyo relay", region: "Japan", specs: "2 vCPU 4 GB · 30 Mbps", note: "For pairing overseas devices, around 90 ms latency." },
  { name: "Southwest · Chengdu Telecom", region: "Chengdu", specs: "1 vCPU 2 GB · 4 Mbps", note: "Home broadband line, best in the evening." },
  { name: "Central China · Wuhan campus", region: "Wuhan", specs: "2 vCPU 4 GB · 6 Mbps", note: "Campus network — most reliable during holidays." },
  { name: "Northwest · Xi'an BGP", region: "Xi'an", specs: "2 vCPU 2 GB · 5 Mbps", note: "Mixed BGP line for the northwest region." },
  { name: "Northeast · Shenyang Unicom", region: "Shenyang", specs: "2 vCPU 4 GB · 8 Mbps", note: "Frequent nightly maintenance; steadier by day." },
  { name: "South China · Shenzhen protected", region: "Shenzhen", specs: "4 vCPU 8 GB · 20 Mbps", note: "100 Gbps DDoS protection, good for always-on hosts." },
];

export function startMockApi({ port = 0, lang = "zh" } = {}) {
  const servers = seedServers();
  if (lang === "en") {
    servers.forEach((server, index) => {
      const english = EN_SERVERS[index];
      if (english) Object.assign(server, english);
    });
  }
  const manageTokens = new Map();
  const sessions = new Map();

  const isExpired = (server) => new Date(server.expiresAt).getTime() <= Date.now();

  const visible = (server) =>
    server.status === "active" && !isExpired(server);

  const send = (response, status, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  };
  const ok = (response, data) => send(response, 200, { success: true, data });
  const fail = (response, status, message, errorCode = "error") =>
    send(response, status, { success: false, data: null, message, errorCode });

  const readBody = (request) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!text) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error("invalid json"));
        }
      });
      request.on("error", reject);
    });

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname.replace(/\/+$/, "");
    const bearer = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const authorized = Boolean(bearer) && sessions.has(bearer);
    const userOf = (email) => ({
      id: `user-${Buffer.from(email).toString("hex").slice(0, 12)}`,
      email,
      displayName: email.split("@")[0] || "若道用户",
      avatarUrl: "",
      role: "user",
    });
    const issueSession = (email) => {
      const token = `mock-session-${crypto.randomBytes(18).toString("base64url")}`;
      sessions.set(token, email);
      return { token, user: userOf(email) };
    };
    const redact = (item) => ({
      id: item.id,
      name: item.name,
      region: item.region,
      status: item.status,
      online: item.online,
      healthStatus: item.healthStatus,
      registrationMode: item.registrationMode,
      detailsLocked: true,
    });

    if (request.method === "GET" && pathname === "/health") {
      return ok(response, { status: "UP" });
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      let body;
      try {
        body = await readBody(request);
      } catch {
        return fail(response, 400, "请求格式不正确");
      }
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 4) {
        return fail(response, 401, "邮箱或密码不正确");
      }
      return ok(response, issueSession(email));
    }

    if (request.method === "POST" && pathname === "/api/auth/refresh") {
      if (!authorized) return fail(response, 401, "登录已过期");
      const email = sessions.get(bearer);
      sessions.delete(bearer);
      return ok(response, issueSession(email));
    }

    if (
      request.method === "GET" &&
      (pathname === "/api/model-configs" || pathname === "/api/model-catalog")
    ) {
      return ok(response, []);
    }

    if (!pathname.startsWith("/api/remote/shared-servers")) {
      return fail(response, 404, "Not Found");
    }

    const rest = pathname.slice("/api/remote/shared-servers".length);
    const match = /^\/([A-Za-z0-9-]{8,64})(\/report)?$/.exec(rest);

    if (request.method === "GET" && rest === "") {
      const query = url.searchParams;
      const q = (query.get("q") ?? "").trim();
      const sort = query.get("sort") ?? "recommended";
      const onlineOnly = query.get("onlineOnly") === "true";
      const page = Math.max(1, Number(query.get("page")) || 1);
      const size = Math.max(1, Math.min(50, Number(query.get("size")) || 8));

      let items = servers.filter(visible);
      if (q) {
        const needle = q.toLowerCase();
        items = items.filter((item) =>
          (authorized
            ? [item.name, item.region, item.specs, item.note, item.address]
            : [item.name, item.region]
          )
            .join(" ")
            .toLowerCase()
            .includes(needle),
        );
      }
      if (onlineOnly) items = items.filter((item) => item.online);
      items = sortServers(items, sort);
      const total = items.length;
      const start = (page - 1) * size;
      const pageItems = items.slice(start, start + size);
      return ok(response, {
        items: authorized ? pageItems : pageItems.map(redact),
        total,
        page,
        size,
      });
    }

    if (request.method === "POST" && rest === "") {
      if (!authorized) return fail(response, 401, "请先登录若道账号后再发布共享服务器");
      let body;
      try {
        body = await readBody(request);
      } catch {
        return fail(response, 400, "请求格式不正确");
      }
      const name = String(body.name ?? "").trim();
      const address = String(body.address ?? "").trim();
      if (name.length < 2) return fail(response, 400, "请填写至少 2 个字符的显示名称。");
      if (!/^https:\/\//.test(address)) return fail(response, 400, "共享服务器必须使用 HTTPS 地址。");
      const expiresAt = String(body.expiresAt ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return fail(response, 400, "请选择有效期。");
      const id = `srv-${crypto.randomBytes(5).toString("hex")}`;
      const token = crypto.randomBytes(24).toString("base64url");
      const created = {
        id,
        name,
        address,
        host: new URL(address).host,
        region: String(body.region ?? "").trim(),
        specs: String(body.specs ?? "").trim(),
        maxDevices: Number.isInteger(Number(body.maxDevices)) && body.maxDevices !== null
          ? Number(body.maxDevices)
          : null,
        inviteCode: String(body.inviteCode ?? "").trim(),
        note: String(body.note ?? "").trim(),
        expiresAt: `${expiresAt}T23:59:59`,
        status: "active",
        online: true,
        healthStatus: "healthy",
        serverVersion: "1.0.3",
        registrationMode: String(body.inviteCode ?? "").trim() ? "invite" : "open",
        peers: 0,
        sessions: 0,
        lastCheckedAt: nowStamp(),
        createdAt: nowStamp(),
      };
      servers.unshift(created);
      manageTokens.set(id, token);
      return ok(response, { server: created, manageToken: token });
    }

    if (!match) return fail(response, 404, "共享记录不存在或已删除");

    const id = match[1];
    const isReport = Boolean(match[2]);
    const server = servers.find((item) => item.id === id);
    if (!server || server.status === "deleted") {
      return fail(response, 404, "共享记录不存在或已删除");
    }
    const owner =
      manageTokens.get(id) && request.headers["x-manage-token"] === manageTokens.get(id);

    if (request.method === "GET" && !isReport) {
      if (!owner && !visible(server)) return fail(response, 404, "共享记录不存在或已过期");
      return ok(response, owner || authorized ? server : redact(server));
    }

    if (request.method === "POST" && isReport) {
      if (!authorized) return fail(response, 401, "请先登录若道账号后再报告问题");
      let body;
      try {
        body = await readBody(request);
      } catch {
        return fail(response, 400, "请求格式不正确");
      }
      if (!servers.some((item) => item.id === id && visible(item))) {
        return fail(response, 404, "共享记录不存在或已下架");
      }
      server.status = "hidden";
      server.reportReason = String(body.reason ?? "").slice(0, 200);
      return ok(response, { reported: true, hidden: true });
    }

    if (!owner) return fail(response, 403, "没有权限修改这条共享记录");
    if (!authorized) return fail(response, 401, "请先登录若道账号后再管理共享服务器");

    if (request.method === "PUT" && !isReport) {
      let body;
      try {
        body = await readBody(request);
      } catch {
        return fail(response, 400, "请求格式不正确");
      }
      const name = String(body.name ?? "").trim();
      const address = String(body.address ?? "").trim();
      if (name.length < 2) return fail(response, 400, "请填写至少 2 个字符的显示名称。");
      if (!/^https:\/\//.test(address)) return fail(response, 400, "共享服务器必须使用 HTTPS 地址。");
      server.name = name;
      server.address = address;
      server.host = new URL(address).host;
      server.region = String(body.region ?? "").trim();
      server.specs = String(body.specs ?? "").trim();
      server.maxDevices =
        body.maxDevices === null || body.maxDevices === undefined || body.maxDevices === ""
          ? null
          : Number(body.maxDevices);
      server.inviteCode = String(body.inviteCode ?? "").trim();
      server.note = String(body.note ?? "").trim();
      server.expiresAt = `${String(body.expiresAt ?? "").slice(0, 10)}T23:59:59`;
      server.registrationMode = server.inviteCode ? "invite" : "open";
      server.lastCheckedAt = nowStamp();
      return ok(response, server);
    }

    if (request.method === "DELETE" && !isReport) {
      server.status = "deleted";
      manageTokens.delete(id);
      return ok(response, { removed: true });
    }

    return fail(response, 405, "Method Not Allowed");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address ? address.port : port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("mock-shared-api.mjs");
if (invokedDirectly) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 19300;
  const { port: actualPort } = await startMockApi({ port });
  console.log(`[mock-shared-api] listening on http://127.0.0.1:${actualPort}`);
}
