#!/usr/bin/env node
/**
 * 通过 Chrome DevTools Protocol 抓取应用界面截图，供 README / 文档使用。
 *
 * 用法（先 npm run build，再启动应用并带上 --remote-debugging-port=9334）：
 *   npx electron . --remote-debugging-port=9334 --user-data-dir=.shots-profile
 *   node scripts/capture-shots.mjs --port 9334 --out ../docs/images
 */
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const port = Number(arg("port", "9334"));
const outDir = path.resolve(arg("out", "../docs/images"));
const width = Number(arg("width", "1200"));
const height = Number(arg("height", "840"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Electron 还没启动完成。
    }
    await sleep(500);
  }
  throw new Error("没有找到可调试的页面，请确认应用已带 --remote-debugging-port 启动");
}

function createClient(ws) {
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
        }, 15000);
      });
    },
  };
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 32 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
const cdp = createClient(ws);

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

try {
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: target.id });
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { width, height, windowState: "normal" },
  });
} catch {
  // 部分平台不支持调整窗口，按默认尺寸截图。
}

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "页面脚本执行失败");
  }
  return result.result?.value;
}

async function waitReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await evaluate(
      "Boolean(document.querySelector('[data-testid=tab-host]'))",
    ).catch(() => false);
    if (ready) return;
    await sleep(250);
  }
  throw new Error("应用界面没有就绪");
}

async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, `${name}.png`);
  await fs.writeFile(file, Buffer.from(data, "base64"));
  console.log(`已截图 ${file}`);
}

await fs.mkdir(outDir, { recursive: true });
await waitReady();
// 跳过首次引导，避免遮挡界面。
await evaluate("localStorage.setItem('ruodao-remote.onboarding.v1','done')");
await cdp.send("Page.reload", { ignoreCache: false });
await sleep(1200);
await waitReady();
await sleep(600);

// 用固定的逻辑视口截图，避免受本机窗口尺寸与滚动条影响。
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await evaluate(`
  (() => {
    const style = document.createElement('style');
    style.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none}';
    document.head.appendChild(style);
    document.querySelector('[aria-label="隐藏密钥"]')?.click();
  })()
`);
await sleep(300);

await evaluate("document.querySelector('[data-testid=tab-host]')?.click()");
await sleep(500);
await shot("01-host");

await evaluate("document.querySelector('[data-testid=tab-control]')?.click()");
await sleep(500);
await shot("02-control");

await evaluate("document.querySelector('[data-testid=tab-server]')?.click()");
await sleep(700);
await shot("03-server");

await evaluate("document.querySelector('[data-testid=open-help]')?.click()");
await sleep(700);
await shot("04-guide");
await evaluate("document.querySelector('dialog[open] .icon-button')?.click()");
await sleep(400);

await evaluate("document.querySelector('[data-testid=open-settings]')?.click()");
await sleep(500);
await shot("05-settings");
await evaluate("document.querySelector('dialog[open] .icon-button')?.click()");
await sleep(300);

ws.close();
console.log("完成。");
