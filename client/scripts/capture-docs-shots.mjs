#!/usr/bin/env node
/**
 * 生成 README / 文档用的界面截图。
 *
 * 与 capture-shots.mjs 的区别：会启动本地模拟的 ruodao.com 接口与信令服务，
 * 因此「共享服务器」页能展示真实列表，且截图前会等待提示条消失。
 *
 * 用法（先 npm run build 与 server npm run build）：
 *   node scripts/capture-docs-shots.mjs
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
const serverEntry = path.resolve(clientDir, "..", "server", "dist", "index.js");
const workDir = path.join(clientDir, ".docs-shots");
const outDir = path.resolve(clientDir, "..", "docs", "images");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForHttp(port, pathname = "/health", timeoutMs = 20_000) {
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

function createCdp(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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

  // 目录可能被环境的安全删除策略保留，失败时继续用现有目录即可。
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const userDataDir = path.join(workDir, `userdata-${stamp}`);
  await fs.mkdir(userDataDir, { recursive: true });

  const mock = await startMockApi();
  const signalingPort = 18400 + Math.floor(Math.random() * 400);
  const cdpPort = 9500 + Math.floor(Math.random() * 300);

  const signaling = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(signalingPort),
      REGISTRATION_MODE: "open",
      DATA_DIR: path.join(workDir, `server-data-${stamp}`),
      ADMIN_PASSWORD: "docs-shots-password",
      UPDATE_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  signaling.stdout.on("data", () => {});
  signaling.stderr.on("data", () => {});

  let electron;
  let ws;
  try {
    await waitForHttp(signalingPort, "/health");
    await waitForHttp(mock.port, "/health");

    const electronEnv = {
      ...process.env,
      REMOTE_USER_DATA_DIR: userDataDir,
      REMOTE_SERVER_URL: `http://127.0.0.1:${signalingPort}`,
      RUODAO_API_BASE_URL: `http://127.0.0.1:${mock.port}`,
      REMOTE_DEVTOOLS: "",
      RUODAO_UPDATE_FORCE: "",
    };
    // 某些终端会预设 ELECTRON_RUN_AS_NODE，导致 Electron 以纯 Node 方式启动。
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electron = spawn(electronPath, [".", `--remote-debugging-port=${cdpPort}`], {
      cwd: clientDir,
      env: electronEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const electronLog = [];
    electron.stdout.on("data", (chunk) => electronLog.push(chunk.toString()));
    electron.stderr.on("data", (chunk) => electronLog.push(chunk.toString()));
    electron.on("exit", (code) => {
      if (code !== 0) console.error(`[electron 退出 ${code}] ${electronLog.join("").slice(-1200)}`);
    });

    const target = await findTarget(cdpPort);
    ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const cdp = createCdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            "页面脚本执行失败",
        );
      }
      return result.result?.value;
    };
    const waitFor = async (expression, label, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression).catch(() => false)) return true;
        await sleep(180);
      }
      throw new Error(`等待超时：${label}`);
    };
    const click = async (selector) => {
      const ok = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return false;
        node.click();
        return true;
      })()`);
      if (!ok) throw new Error(`找不到可点击元素：${selector}`);
    };
    const setInput = async (selector, value) => {
      const ok = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new Error(`找不到输入框：${selector}`);
    };

    let size = { width: 1200, height: 1000 };
    const applyViewport = async (next) => {
      size = next;
      try {
        const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: target.id });
        await cdp.send("Browser.setWindowBounds", {
          windowId,
          bounds: { width: next.width, height: next.height, windowState: "normal" },
        });
      } catch {
        // 部分平台不支持调整窗口。
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: next.width,
        height: next.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await hideScrollbars();
    };
    const hideScrollbars = () =>
      evaluate(`
        (() => {
          if (document.getElementById('docs-shot-style')) return;
          const style = document.createElement('style');
          style.id = 'docs-shot-style';
          style.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none}';
          document.head.appendChild(style);
        })()
      `);
    const clearToasts = async () => {
      // 提示条会自动消失，截图前等它退场，避免遮挡界面。
      await waitFor("document.querySelectorAll('.toast').length === 0", "提示条消失", 12_000).catch(
        () => {},
      );
      await sleep(250);
    };
    const shot = async (name) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(outDir, `${name}.png`);
      await fs.writeFile(file, Buffer.from(data, "base64"));
      console.log(`已截图 ${path.relative(clientDir, file)}  ${size.width}x${size.height}`);
    };

    await waitFor("Boolean(document.querySelector('[data-testid=tab-host]'))", "应用界面就绪");
    const settings = await evaluate("window.remote.getSettings()");
    if (settings.serverUrl !== `http://127.0.0.1:${signalingPort}`) {
      throw new Error(`测试配置未隔离：serverUrl=${settings.serverUrl}`);
    }
    await evaluate("localStorage.setItem('ruodao-remote.onboarding.v1','done')");
    await cdp.send("Page.reload", { ignoreCache: false });
    await sleep(1500);
    await waitFor("Boolean(document.querySelector('[data-testid=tab-host]'))", "应用界面重新就绪");

    await applyViewport({ width: 1200, height: 1000 });
    await sleep(400);
    // 隐藏访问密钥，截图里不出现真实密钥。
    await evaluate("document.querySelector('[aria-label=\"隐藏密钥\"]')?.click()");
    await clearToasts();

    await click("[data-testid=tab-host]");
    await sleep(600);
    await shot("01-host");

    await click("[data-testid=tab-control]");
    await sleep(600);
    await shot("02-control");

    await click("[data-testid=tab-server]");
    await sleep(900);
    await clearToasts();
    await shot("03-server");

    console.log("登录若道账号以解锁共享服务器详情…");
    await click("[data-testid=tab-shared]");
    await waitFor("Boolean(document.querySelector('[data-testid=shared-servers-panel]'))", "共享服务器面板");
    if (await evaluate("Boolean(document.querySelector('[data-testid=shared-login-card]'))")) {
      await setInput("[data-testid=shared-login-email]", "tester@ruodao.com");
      await setInput("[data-testid=shared-login-password]", "ruodao-test");
      await click("[data-testid=shared-login-submit]");
      await waitFor("!document.querySelector('[data-testid=shared-login-card]')", "登录完成");
    }
    await waitFor(
      "[...document.querySelectorAll('.shared-server-card:not(.mine) .shared-server-invite code')].length > 0",
      "共享详情解锁",
    );
    await clearToasts();
    await sleep(400);
    await shot("04-shared");

    await click("[data-testid=open-help]");
    await waitFor("Boolean(document.querySelector('dialog[open]'))", "使用指南");
    await sleep(700);
    await shot("05-guide");
    await evaluate("document.querySelector('dialog[open] .icon-button')?.click()");
    await sleep(400);

    await applyViewport({ width: 1200, height: 1240 });
    await click("[data-testid=open-settings]");
    await waitFor("Boolean(document.querySelector('dialog[open]'))", "设置对话框");
    await sleep(700);
    await shot("06-settings");

    ws.close();
    console.log("完成。");
  } finally {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    if (electron && electron.exitCode === null) electron.kill("SIGTERM");
    if (signaling.exitCode === null) signaling.kill("SIGTERM");
    await mock.close();
    await sleep(400);
    if (electron && electron.exitCode === null) electron.kill("SIGKILL");
    if (signaling.exitCode === null) signaling.kill("SIGKILL");
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

main().catch((error) => {
  console.error(`[截图失败] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
