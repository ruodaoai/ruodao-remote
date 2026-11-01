#!/usr/bin/env node
/**
 * 共享服务器页面真实 Electron 验收：
 * 1. 启动本地模拟 ruodao.com 共享服务器接口；
 * 2. 启动本地信令服务与 Electron（独立用户配置目录，避免污染本机配置）；
 * 3. 通过 CDP 操作界面：列表、搜索、排序、仅看在线、发布、一键使用、我的分享、更新、报告、下架、移动端布局。
 *
 * 用法：先 npm run build，再 node scripts/verify-shared-ui.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startMockApi } from "./mock-shared-api.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.resolve(clientDir, "..", "server");
const serverEntry = path.join(serverDir, "dist", "index.js");
const workDir = path.join(clientDir, ".shared-ui");
const shotsDir = path.join(workDir, "shots");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const checks = [];
const failures = [];
let shotIndex = 0;

function check(name, condition, detail = "") {
  if (condition) {
    checks.push({ name, ok: true });
    console.log(`  PASS  ${name}${detail ? ` · ${detail}` : ""}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForHttp(port, pathname = "/health", timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 1000 }, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on("error", retry);
      request.on("timeout", () => {
        request.destroy();
        retry();
      });
      function retry() {
        if (Date.now() > deadline) reject(new Error(`等待 http://127.0.0.1:${port}${pathname} 超时`));
        else setTimeout(attempt, 200);
      }
    };
    attempt();
  });
}

function createCdp(ws, events, onEvent) {
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      events.push(message);
      onEvent?.(message);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP 调用超时：${method}`));
          }
        }, 30_000);
      });
    },
  };
}

async function findTarget(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Electron 尚未启动完成。
    }
    await sleep(300);
  }
  throw new Error("没有找到可调试的页面");
}

const main = async () => {
  if (!(await fs.stat(serverEntry).catch(() => null))) {
    throw new Error(`缺少 ${serverEntry}，请先在 server 目录执行 npm run build`);
  }
  if (!(await fs.stat(path.join(clientDir, "dist", "index.html")).catch(() => null))) {
    throw new Error("缺少 dist/index.html，请先执行 npm run build");
  }

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(shotsDir, { recursive: true });
  const userDataDir = path.join(workDir, "userdata");
  await fs.mkdir(userDataDir, { recursive: true });

  const mock = await startMockApi();
  const signalingPort = 18000 + Math.floor(Math.random() * 900);
  const cdpPort = 9400 + Math.floor(Math.random() * 400);

  const signaling = spawn(process.execPath, [serverEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(signalingPort),
      REGISTRATION_MODE: "open",
      DATA_DIR: path.join(workDir, "server-data"),
      ADMIN_PASSWORD: "shared-ui-admin-password",
      UPDATE_SYSTEM_UPDATER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  signaling.stdout.on("data", () => {});
  signaling.stderr.on("data", () => {});

  let electron;
  let ws;
  let events = [];
  let evaluate;
  let shot;
  try {
    await waitForHttp(signalingPort, "/health");
    await waitForHttp(mock.port, "/health");

    electron = spawn(electronPath, [".", `--remote-debugging-port=${cdpPort}`], {
      cwd: clientDir,
      env: {
        ...process.env,
        REMOTE_USER_DATA_DIR: userDataDir,
        REMOTE_SERVER_URL: `http://127.0.0.1:${signalingPort}`,
        RUODAO_API_BASE_URL: `http://127.0.0.1:${mock.port}`,
        REMOTE_DEVTOOLS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const electronLog = [];
    electron.stdout.on("data", (chunk) => electronLog.push(chunk.toString()));
    electron.stderr.on("data", (chunk) => electronLog.push(chunk.toString()));

    const target = await findTarget(cdpPort);
    ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    events = [];
    const nativeDialogs = [];
    const cdp = createCdp(ws, events, (message) => {
      if (message.method === "Page.javascriptDialogOpening") {
        nativeDialogs.push(message.params);
        console.log(`  [原生对话框] ${message.params?.type}: ${message.params?.message ?? ""}`);
        void cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "页面脚本执行失败",
        );
      }
      return result.result?.value;
    };
    const waitFor = async (expression, label, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await evaluate(expression).catch(() => false);
        if (value) return value;
        await sleep(180);
      }
      throw new Error(`等待超时：${label}`);
    };
    shot = async (name) => {
      shotIndex += 1;
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(shotsDir, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
      await fs.writeFile(file, Buffer.from(data, "base64"));
      console.log(`  截图 ${path.relative(clientDir, file)}`);
      return file;
    };
    const click = async (selector) => {
      const clicked = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return false;
        node.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`找不到可点击元素：${selector}`);
    };
    const clickButton = async (scope, text) => {
      const clicked = await evaluate(`(() => {
        const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document"};
        if (!root) return false;
        const button = [...root.querySelectorAll('button')].find((node) =>
          node.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`找不到按钮：${text}`);
    };
    const clickCardButton = async (cardName, text) => {
      const clicked = await evaluate(`(() => {
        const card = [...document.querySelectorAll('.shared-server-card:not(.mine)')].find((node) =>
          node.querySelector('.shared-server-identity strong')?.textContent.includes(${JSON.stringify(cardName)}),
        );
        if (!card) return false;
        const button = [...card.querySelectorAll('button')].find((node) =>
          node.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`找不到卡片按钮：${cardName} / ${text}`);
    };
    const setInput = async (selector, value) => {
      const changed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!input) return false;
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error(`找不到输入框：${selector}`);
    };
    const setSelect = async (selector, value) => {
      const changed = await evaluate(`(() => {
        const select = document.querySelector(${JSON.stringify(selector)});
        if (!select) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, ${JSON.stringify(value)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error(`找不到下拉框：${selector}`);
    };
    const setDialogField = async (labelText, value) => {
      const changed = await evaluate(`(() => {
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) return false;
        const label = [...dialog.querySelectorAll('label.field')].find((node) =>
          node.textContent.includes(${JSON.stringify(labelText)}),
        );
        const input = label?.querySelector('input, textarea');
        if (!input) return false;
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error(`找不到对话框字段：${labelText}`);
    };
    const waitCards = (count, timeoutMs = 15_000) =>
      waitFor(
        `document.querySelectorAll('.shared-server-card:not(.mine)').length === ${count}`,
        `${count} 张服务器卡片`,
        timeoutMs,
      );
    const waitBadge = (value) =>
      waitFor(
        `document.querySelector('.server-tab .server-tab-badge.soft')?.textContent.trim() === '${value}'`,
        `共享列表数量 ${value}`,
      );
    const waitToast = (text) =>
      waitFor(
        `[...document.querySelectorAll('.toast')].some((node) => node.textContent.includes(${JSON.stringify(text)}))`,
        `提示「${text}」`,
      );
    const waitMine = (count) =>
      waitFor(
        `document.querySelectorAll('[data-testid^="shared-server-mine-"]').length === ${count}`,
        `${count} 张我的分享卡片`,
      );
    const listCards = () =>
      evaluate(`[...document.querySelectorAll('.shared-server-card:not(.mine)')].map((node) => ({
        name: node.querySelector('.shared-server-identity strong')?.textContent.trim() ?? '',
        host: node.querySelector('.shared-server-identity div > span')?.textContent.trim() ?? '',
        chips: [...node.querySelectorAll('.shared-server-chip')].map((chip) => chip.textContent.trim()),
        invite: node.querySelector('.shared-server-invite code')?.textContent.trim() ?? '',
        status: node.querySelector('.status-pill')?.textContent.trim() ?? '',
        facts: [...node.querySelectorAll('.shared-server-facts dd')].map((dd) => dd.textContent.trim()),
        useDisabled: Boolean(node.querySelector('.shared-server-actions .button.primary')?.disabled),
      }))`);

    const tabReady = async (tabTestId) =>
      waitFor(`Boolean(document.querySelector('[data-testid=${tabTestId}]'))`, "应用界面就绪");
    await tabReady("tab-host");
    const initialSettings = await evaluate("window.remote.getSettings()");
    if (
      initialSettings.serverUrl !== `http://127.0.0.1:${signalingPort}` ||
      initialSettings.autoStartHost
    ) {
      throw new Error(
        `测试配置未隔离：serverUrl=${initialSettings.serverUrl} autoStartHost=${initialSettings.autoStartHost}`,
      );
    }
    check("测试使用独立用户配置目录", true, path.relative(clientDir, userDataDir));
    await evaluate("localStorage.setItem('ruodao-remote.onboarding.v1','done')");
    await cdp.send("Page.reload", { ignoreCache: false });
    await sleep(1200);
    await tabReady("tab-shared");

    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: target.id });
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width: 1280, height: 900, windowState: "normal" },
      });
    } catch {
      // 部分平台不允许调整窗口。
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`
      (() => {
        const style = document.createElement('style');
        style.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none}';
        document.head.appendChild(style);
      })()
    `);

    console.log("\n[0] 匿名浏览与详情锁定");
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板");
    await waitCards(9);
    const lockedCards = await evaluate(`[...document.querySelectorAll('.shared-server-card:not(.mine)')].map((node) => ({
      name: node.querySelector('.shared-server-identity strong')?.textContent.trim() ?? '',
      subtitle: node.querySelector('.shared-server-identity div > span')?.textContent.trim() ?? '',
      invite: node.querySelector('.shared-server-invite code')?.textContent.trim() ?? '',
      facts: [...node.querySelectorAll('.shared-server-facts dd')].map((dd) => dd.textContent.trim()),
      primary: node.querySelector('.shared-server-actions .button.primary')?.textContent.trim() ?? '',
      note: node.querySelector('.shared-server-card-note')?.textContent.trim() ?? '',
    }))`);
    check("未登录也能看到共享列表", lockedCards.length === 9);
    check(
      "未登录列表隐藏服务器地址",
      lockedCards.every((card) => card.subtitle.includes("登录后显示服务器地址")),
    );
    check("未登录看不到邀请码", lockedCards.every((card) => card.invite === ""));
    check(
      "未登录详情显示登录后可见",
      lockedCards[0]?.facts.length === 3 && lockedCards[0]?.facts.every((text) => text === "登录后可见"),
      lockedCards[0]?.facts.join(" / ") ?? "",
    );
    check(
      "未登录隐藏配置与备注",
      lockedCards.every((card) => card.note === ""),
    );
    check(
      "未登录卡片引导登录",
      lockedCards.every((card) => card.primary.includes("登录后使用")),
    );
    check(
      "登录卡片可见",
      await evaluate("Boolean(document.querySelector('[data-testid=shared-login-card]'))"),
    );
    await shot("shared-anonymous-list");

    console.log("\n[0.5] 未登录操作被引导登录");
    await click("[data-testid=shared-server-publish]");
    await sleep(300);
    check(
      "未登录不会打开发布框",
      await evaluate("!document.querySelector('[data-testid=shared-server-dialog][open]')"),
    );
    await waitToast("请先登录若道账号");

    console.log("\n[0.6] 登录后解锁详情");
    await setInput("[data-testid=shared-login-email]", "tester@ruodao.com");
    await setInput("[data-testid=shared-login-password]", "ruodao-test");
    await click("[data-testid=shared-login-submit]");
    await waitFor("!document.querySelector('[data-testid=shared-login-card]')", "登录卡片消失");
    await waitFor(
      "[...document.querySelectorAll('.shared-server-card:not(.mine) .shared-server-invite code')].length > 0",
      "登录后详情解锁",
    );
    const authStatus = await evaluate("window.remote.assistantStatus()");
    check(
      "登录写入若道账号会话",
      authStatus.authenticated === true && authStatus.email === "tester@ruodao.com",
      `${authStatus.email} / ${authStatus.authenticated}`,
    );
    let cards = await listCards();
    check(
      "登录后看到邀请码",
      cards.find((card) => card.name === "华东 · 上海公益服")?.invite === "AB12-CD34",
      cards.find((card) => card.name === "华东 · 上海公益服")?.invite ?? "",
    );
    check(
      "登录后看到服务器地址",
      cards[0]?.host.includes("remote-demo.cn"),
      cards[0]?.host ?? "",
    );

    console.log("\n[0.7] 登录状态与社区留言共用");
    await click("[data-testid=tab-community]");
    await waitFor("Boolean(document.querySelector('[data-testid=community-panel]'))", "社区面板");
    await sleep(400);
    check(
      "共享服务器登录后社区同步登录",
      await evaluate("!document.querySelector('[data-testid=community-login]')"),
    );
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板");
    await waitCards(9);

    console.log("\n[1] 共享列表");
    await waitBadge("9");
    cards = await listCards();
    check("共享列表渲染 9 台服务器", cards.length === 9);
    check("推荐排序首卡最活跃在线", cards[0]?.name === "华南 · 深圳高防" && cards[0]?.status === "在线");
    check(
      "离线服务器禁止接入",
      cards.find((card) => card.name === "华南 · 广州移动")?.status === "离线" &&
        cards.find((card) => card.name === "华南 · 广州移动")?.useDisabled === true,
    );
    check(
      "卡片展示有效期、在线设备与服务端版本",
      cards[0]?.facts.length === 3 && cards[0]?.facts[0].includes("31") && cards[0]?.facts[2] === "v1.0.3",
      cards[0]?.facts.join(" / ") ?? "",
    );
    check(
      "邀请码按 4-4 分组展示",
      cards.find((card) => card.name === "华东 · 上海公益服")?.invite === "AB12-CD34",
      cards.find((card) => card.name === "华东 · 上海公益服")?.invite ?? "",
    );
    check(
      "安全说明可见",
      await evaluate(
        "document.querySelector('.shared-server-note')?.textContent.includes('不参与实际远控连接') === true",
      ),
    );
    check(
      "9 台时无分页",
      await evaluate("!document.querySelector('.shared-server-pagination')"),
    );
    await shot("shared-list-desktop");

    console.log("\n[2] 搜索、排序与仅看在线");
    await setInput(".shared-server-search input", "东京");
    await waitCards(1);
    cards = await listCards();
    check("搜索命中单条", cards[0]?.name === "海外 · 东京中转", cards[0]?.name ?? "");
    check("搜索后数量角标同步", await evaluate("document.querySelector('.server-tab-badge.soft')?.textContent.trim() === '1'"));
    await setInput(".shared-server-search input", "");
    await waitCards(9);
    await setSelect(".shared-server-select", "expiring");
    await sleep(500);
    cards = await listCards();
    check("按即将到期排序", cards[0]?.name === "华南 · 广州移动", cards[0]?.name ?? "");
    await setSelect(".shared-server-select", "recommended");
    await sleep(500);
    await click(".shared-server-toggle");
    await waitCards(7);
    cards = await listCards();
    check("仅看在线过滤离线服务器", cards.length === 7 && cards.every((card) => card.status === "在线"));
    await click(".shared-server-toggle");
    await waitCards(9);

    console.log("\n[3] 发布共享服务器");
    await click("[data-testid=shared-server-publish]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-server-dialog][open]'))", "发布对话框");
    await sleep(350);
    await shot("shared-publish-dialog");
    await setDialogField("显示名称", "CDP 验证服");
    await setDialogField("服务器地址", "https://ui-test.example.com");
    await setDialogField("地区", "香港");
    await setDialogField("配置说明", "4 核 8G · 10Mbps");
    await setDialogField("可接入设备数", "12");
    await setDialogField("邀请码", "test-1234");
    await setDialogField("补充说明", "自动化验收创建，请勿使用。");
    await click("[data-testid=shared-server-submit]");
    await waitToast("已发布到共享服务器列表");
    await waitFor("!document.querySelector('[data-testid=shared-server-dialog][open]')", "发布对话框关闭");
    await waitBadge("10");
    await waitFor(
      "[...document.querySelectorAll('.shared-server-card:not(.mine) .shared-server-identity strong')].some((node) => node.textContent.includes('CDP 验证服'))",
      "新服务器出现在列表",
    );
    cards = await listCards();
    const created = cards.find((card) => card.name === "CDP 验证服");
    check("新服务器出现在列表", Boolean(created));
    check("新服务器展示规范化邀请码", created?.invite === "TEST-1234", created?.invite ?? "");
    check("发布后出现分页", await evaluate("document.querySelector('.shared-server-pagination')?.textContent.includes('共 10 台') === true"));
    check(
      "我的分享角标为 1",
      await evaluate(
        "[...document.querySelectorAll('.server-tab')].find((node) => node.textContent.includes('我的分享'))?.querySelector('.server-tab-badge')?.textContent.trim() === '1'",
      ),
    );
    await shot("shared-published");

    console.log("\n[4] 一键使用");
    await clickCardButton("CDP 验证服", "使用此服务器");
    await waitFor("Boolean(document.querySelector('[data-testid=tab-control].active'))", "切换到控制远程设备页");
    const settings = await evaluate("window.remote.getSettings()");
    check(
      "服务器地址与邀请码写入设置",
      settings.serverUrl === "https://ui-test.example.com" && settings.inviteCode === "TEST1234",
      `${settings.serverUrl} / ${settings.inviteCode}`,
    );
    check("切换时无原生确认框", nativeDialogs.length === 0, nativeDialogs.map((item) => item.message).join(" / "));
    check(
      "一键使用提示可见",
      await evaluate(
        "[...document.querySelectorAll('.toast')].some((node) => node.textContent.includes('CDP 验证服'))",
      ),
    );
    await sleep(300);
    await shot("shared-used-control");

    console.log("\n[5] 我的分享与更新");
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板恢复");
    await clickButton(".server-tabs", "我的分享");
    await waitMine(1);
    const mineCard = await evaluate(`(() => {
      const card = document.querySelector('[data-testid^="shared-server-mine-"]');
      return {
        name: card?.querySelector('.shared-server-identity strong')?.textContent.trim() ?? '',
        status: card?.querySelector('.status-pill')?.textContent.trim() ?? '',
        actions: [...(card?.querySelectorAll('.shared-server-actions button') ?? [])].map((node) => node.textContent.trim()),
      };
    })()`);
    check("我的分享展示刚发布的服务器", mineCard.name === "CDP 验证服" && mineCard.status === "在线", `${mineCard.name} / ${mineCard.status}`);
    check("我的分享提供使用、更新与下架", mineCard.actions.some((text) => text === "使用") && mineCard.actions.some((text) => text.includes("更新")) && mineCard.actions.some((text) => text.includes("下架")));
    await shot("shared-mine");
    await clickButton('[data-testid^="shared-server-mine-"]', "更新信息");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-server-dialog][open]'))", "更新对话框");
    check(
      "更新对话框回填名称与地址",
      await evaluate("document.querySelector('[data-testid=shared-server-name]')?.value === 'CDP 验证服' && document.querySelector('[data-testid=shared-server-address]')?.value === 'https://ui-test.example.com'"),
    );
    await setDialogField("显示名称", "CDP 验证服 · 已更新");
    await click("[data-testid=shared-server-submit]");
    await waitToast("共享信息已更新");
    await waitMine(1);
    await waitFor(
      "document.querySelector('[data-testid^=\"shared-server-mine-\"] .shared-server-identity strong')?.textContent.includes('已更新') === true",
      "我的分享名称更新",
    );
    check("更新后我的分享同步新名称", true);

    console.log("\n[6] 报告问题");
    await clickButton(".server-tabs", "共享列表");
    await waitCards(9);
    await clickCardButton("华南 · 广州移动", "报告问题");
    await waitFor("Boolean([...document.querySelectorAll('dialog[open] h2')].find((node) => node.textContent.includes('报告')))", "报告对话框");
    await sleep(350);
    await shot("shared-report-dialog");
    await setDialogField("问题描述", "地址打不开，邀请码也无效");
    await clickButton("dialog[open]", "提交报告");
    await waitToast("已提交报告");
    await waitFor("!document.querySelector('dialog[open]')", "报告对话框关闭");
    await clickButton(".panel-heading-actions", "刷新");
    await waitBadge("9");
    await waitFor(
      "![...document.querySelectorAll('.shared-server-card:not(.mine) .shared-server-identity strong')].some((node) => node.textContent.includes('广州移动'))",
      "被隐藏服务器从列表移除",
    );
    check("报告后被隐藏的服务器从列表移除", true);

    console.log("\n[7] 下架");
    await clickButton(".server-tabs", "我的分享");
    await waitMine(1);
    await evaluate("window.confirm = () => true");
    await clickButton('[data-testid^="shared-server-mine-"]', "下架");
    await waitToast("已下架共享服务器");
    await waitMine(0);
    check("下架后我的分享为空", await evaluate("document.body.textContent.includes('你还没有发布过共享服务器')"));
    await clickButton(".server-tabs", "共享列表");
    await waitBadge("8");
    await waitCards(8);
    check("下架后目录数量回落", true);
    await shot("shared-after-remove");

    console.log("\n[8] 移动端布局");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(700);
    await waitFor("document.querySelectorAll('.toast').length === 0", "提示自动消失", 6000);
    const overflow = await evaluate(
      "document.documentElement.scrollWidth - document.documentElement.clientWidth",
    );
    check("移动端无横向溢出", overflow <= 1, `超出 ${overflow}px`);
    const navLayout = await evaluate(`(() => {
      const bar = document.querySelector('.mode-tabs');
      const tabs = [...document.querySelectorAll('.mode-tab')];
      return {
        overflow: bar ? bar.scrollWidth - bar.clientWidth : -1,
        maxHeight: Math.max(...tabs.map((tab) => Math.round(tab.getBoundingClientRect().height))),
      };
    })()`);
    check(
      "移动端导航横向平铺",
      navLayout.overflow <= 1 && navLayout.maxHeight <= 46,
      `溢出 ${navLayout.overflow}px · 最高 ${navLayout.maxHeight}px`,
    );
    const cardWidth = await evaluate("document.querySelector('.shared-server-card')?.getBoundingClientRect().width ?? 0");
    check("移动端卡片单列铺满", cardWidth > 300 && cardWidth <= 390, `${Math.round(cardWidth)}px`);
    await evaluate("window.scrollTo({ top: 0 })");
    await sleep(300);
    await shot("shared-mobile-list");
    await clickButton(".server-tabs", "我的分享");
    await sleep(500);
    await shot("shared-mobile-mine");
    await click("[data-testid=shared-server-publish]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-server-dialog][open]'))", "移动端发布对话框");
    const dialogOverflow = await evaluate(
      "(() => { const dialog = document.querySelector('[data-testid=shared-server-dialog][open]'); return dialog ? Math.round(dialog.getBoundingClientRect().width) : 0; })()",
    );
    check("移动端对话框不超出视口", dialogOverflow > 0 && dialogOverflow <= 390, `${dialogOverflow}px`);
    await sleep(350);
    await shot("shared-mobile-publish");
    await clickButton("dialog[open]", "取消");
    await sleep(300);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);

    console.log("\n[9] 其他页面回归");
    const tabs = [
      ["host", ".host-panel"],
      ["control", ".control-panel"],
      ["server", ".server-panel"],
      ["community", "[data-testid=community-panel]"],
    ];
    for (const [tab, selector] of tabs) {
      await click(`[data-testid=tab-${tab}]`);
      const visible = await waitFor(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        `${tab} 页面`,
      ).catch(() => false);
      check(`${tab} 页面可打开`, Boolean(visible));
      await sleep(200);
    }
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板恢复");

    console.log("\n[9.5] 社区登录同样解锁共享服务器");
    await evaluate("window.remote.assistantLogout()");
    await sleep(500);
    await click("[data-testid=tab-community]");
    await waitFor("Boolean(document.querySelector('[data-testid=community-login]'))", "社区登录卡片");
    await setInput("[data-testid=community-email]", "tester@ruodao.com");
    await setInput("[data-testid=community-password]", "ruodao-test");
    await click("[data-testid=community-login]");
    await waitFor("!document.querySelector('[data-testid=community-login]')", "社区登录成功");
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板");
    check(
      "社区登录同步解锁共享服务器详情",
      await waitFor(
        "[...document.querySelectorAll('.shared-server-card:not(.mine) .shared-server-invite code')].length > 0",
        "共享详情随社区登录解锁",
      ).then(
        () => true,
        () => false,
      ),
    );

    const jsErrors = events.filter(
      (event) =>
        event.method === "Runtime.exceptionThrown" ||
        (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error"),
    );
    check(
      "运行期无 JS 异常",
      jsErrors.length === 0,
      jsErrors
        .slice(0, 3)
        .map(
          (event) =>
            event.params?.exceptionDetails?.exception?.description ??
            event.params?.args?.[0]?.value ??
            event.method,
        )
        .join(" | "),
    );

    console.log("\n[10] 汇总");
    console.log(`  通过 ${checks.length - failures.length}/${checks.length} 项检查`);
    if (failures.length > 0) {
      console.error("\n失败项：");
      for (const failure of failures) {
        console.error(`  - ${failure.name}${failure.detail ? ` · ${failure.detail}` : ""}`);
      }
      process.exitCode = 1;
    }
    if (electronLog.length > 0) {
      const tail = electronLog.join("").trim().split("\n").slice(-4).join("\n");
      if (tail) console.log(`  Electron 输出（末尾 4 行）：\n${tail}`);
    }
    console.log(`\n截图目录：${shotsDir}`);
  } catch (error) {
    console.error(`\n[验收中断] ${error instanceof Error ? error.message : error}`);
    try {
      if (shot) await shot("failure");
    } catch {
      // ignore
    }
    try {
      if (evaluate) {
        const debugDump = await evaluate(`(() => ({
          tabs: [...document.querySelectorAll('.mode-tab')].map((node) =>
            node.textContent.trim() + (node.classList.contains('active') ? '*' : ''),
          ),
          panels: [...document.querySelectorAll('main section')].map((node) => node.className),
          dialogs: [...document.querySelectorAll('dialog[open]')].map((node) => node.className),
          toasts: [...document.querySelectorAll('.toast')].map((node) => node.textContent.trim()),
          alerts: [...document.querySelectorAll('.inline-alert')].map((node) => node.textContent.trim()),
          body: document.body.innerText.slice(0, 1800),
        }))()`);
        console.log(JSON.stringify(debugDump, null, 2));
      }
    } catch (dumpError) {
      console.error("无法读取页面状态：", dumpError.message);
    }
    const jsErrors = events.filter(
      (event) =>
        event.method === "Runtime.exceptionThrown" ||
        (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error"),
    );
    console.error("JS 事件：", JSON.stringify(jsErrors.slice(0, 5), null, 2));
    throw error;
  } finally {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    if (electron && electron.exitCode === null) electron.kill("SIGTERM");
    if (signaling.exitCode === null) signaling.kill("SIGTERM");
    await mock.close();
    await sleep(500);
    if (electron && electron.exitCode === null) electron.kill("SIGKILL");
    if (signaling.exitCode === null) signaling.kill("SIGKILL");
  }
};

main().catch((error) => {
  console.error(`\n[验收失败] ${error instanceof Error ? error.stack : error}`);
  process.exitCode = 1;
});
