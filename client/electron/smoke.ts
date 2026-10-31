import { app, screen, type BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  appliedInputCount,
  injectMouseMove,
  lastAppliedInput,
  readCursorPosition,
} from "./input-win";

interface SmokeOptions {
  hostWindow: BrowserWindow;
  createWindow: (query?: Record<string, string>) => BrowserWindow;
  outputDir: string;
}

interface SmokeResult {
  ok: boolean;
  error?: string;
  host?: { state: string; codeLength: number; keyLength: number };
  settings?: { opened: boolean };
  controller?: {
    state: string;
    videoWidth: number;
    videoHeight: number;
    channelOnline: boolean;
  };
  input?: {
    appliedEvents: number;
    hostReceived: unknown;
    normMatched: boolean;
    directInjection: {
      expected: { x: number; y: number };
      actual: { x: number; y: number } | null;
      distance: number | null;
      ok: boolean;
      probes: Array<{
        target: { x: number; y: number };
        attempts: Array<{ actual: { x: number; y: number } | null; distance: number | null }>;
      }>;
    };
    cursorBefore: { x: number; y: number };
    cursorAfter: { x: number; y: number };
    expected: { x: number; y: number };
    cursorDistance: number | null;
    cursorClosest: number | null;
    cursorMatched: boolean;
  };
  displays?: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
  }>;
  features?: {
    chat: boolean;
    pause: boolean;
    clipboardGate: boolean;
    viewModes: boolean;
    quality: boolean;
  };
  catalog?: {
    published: boolean;
    jumpVisible: boolean;
    itemVisible: boolean;
    requestSent: boolean;
    hostRequestVisible: boolean;
    connected: boolean;
  };
  serverPanel?: {
    cardVisible: boolean;
    client: string;
    server: string;
  };
  screenshots: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate<T>(
  win: BrowserWindow,
  code: string,
  userGesture = false,
): Promise<T> {
  return (await win.webContents.executeJavaScript(code, userGesture)) as T;
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
  intervalMs = 150,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

async function waitForLoad(win: BrowserWindow, selector: string): Promise<void> {
  if (!win.webContents.isLoading()) {
    const present = await evaluate<boolean>(
      win,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    ).catch(() => false);
    if (present) return;
  }
  await new Promise<void>((resolve) => {
    win.webContents.once("did-finish-load", () => resolve());
  });
  await waitFor(
    async () =>
      (await evaluate<boolean>(
        win,
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      ))
        ? true
        : null,
    20_000,
    `element ${selector}`,
  );
}

export async function runSmoke(options: SmokeOptions): Promise<void> {
  const { hostWindow, createWindow, outputDir } = options;
  const screenshots: string[] = [];
  const result: SmokeResult = { ok: false, screenshots };

  async function shot(win: BrowserWindow, name: string): Promise<void> {
    await delay(320);
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(outputDir, name), image.toPNG());
    screenshots.push(name);
  }

  async function click(win: BrowserWindow, selector: string): Promise<boolean> {
    return evaluate<boolean>(
      win,
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.click();
        return true;
      })()`,
      true,
    );
  }

  async function clickHostTool(win: BrowserWindow, label: string): Promise<boolean> {
    return evaluate<boolean>(
      win,
      `(() => {
        const button = [...document.querySelectorAll(".host-tool")].find((element) =>
          element.textContent?.includes(${JSON.stringify(label)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
      true,
    );
  }

  async function fillChat(win: BrowserWindow, inputSelector: string, text: string): Promise<boolean> {
    return evaluate<boolean>(
      win,
      `(() => {
        const input = document.querySelector(${JSON.stringify(inputSelector)});
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) return false;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
      true,
    );
  }

  async function submitChat(win: BrowserWindow, formSelector: string): Promise<boolean> {
    return evaluate<boolean>(
      win,
      `(() => {
        const form = document.querySelector(${JSON.stringify(formSelector)});
        if (!form) return false;
        form.requestSubmit();
        return true;
      })()`,
      true,
    );
  }

  async function chatTexts(win: BrowserWindow, scope: string): Promise<string[]> {
    return evaluate<string[]>(
      win,
      `[...document.querySelectorAll(${JSON.stringify(scope)})].map((element) => element.textContent ?? "")`,
    );
  }

  async function buttonState(
    win: BrowserWindow,
    selector: string,
  ): Promise<{ disabled: boolean; pressed: boolean } | null> {
    return evaluate<{ disabled: boolean; pressed: boolean } | null>(
      win,
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLButtonElement)) return null;
        return { disabled: element.disabled, pressed: element.getAttribute("aria-pressed") === "true" };
      })()`,
    );
  }

  try {
    mkdirSync(outputDir, { recursive: true });

    // Exclude both windows from desktop capture so the same-machine test does
    // not show an endless mirror of the client inside its own preview.
    hostWindow.setContentProtection(true);

    await waitForLoad(hostWindow, '[data-testid="host-toggle"]');
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `(() => {
            const el = document.querySelector('[data-testid="host-toggle"]');
            return Boolean(el) && !el.disabled;
          })()`,
        ))
          ? true
          : null,
      25_000,
      "host identity",
    );

    const autoStartCard = await evaluate<boolean>(
      hostWindow,
      `Boolean(document.querySelector('[data-testid="auto-start-card"]'))`,
    );
    if (!autoStartCard) throw new Error("idle host panel is missing the auto-start card");
    await delay(350);
    await shot(hostWindow, "host-idle.png");

    const toggleAutoStart = async (): Promise<void> => {
      await evaluate(
        hostWindow,
        `document.querySelector('[data-testid="auto-start-host"]').click()`,
        true,
      );
    };
    const autoStartChecked = async (): Promise<boolean> =>
      evaluate<boolean>(
        hostWindow,
        `document.querySelector('[data-testid="auto-start-host"]')?.getAttribute('aria-checked') === 'true'`,
      );
    await toggleAutoStart();
    await waitFor(
      async () => ((await autoStartChecked()) ? true : null),
      5_000,
      "auto-start toggle",
    );
    const persistedAutoStart = await evaluate<{ autoStartHost: boolean }>(
      hostWindow,
      `window.remote.getSettings()`,
    );
    if (!persistedAutoStart.autoStartHost) {
      throw new Error("auto-start preference was not persisted");
    }
    const stillIdle = await evaluate<string>(
      hostWindow,
      `document.querySelector('[data-testid="host-state"]')?.dataset.state ?? ""`,
    );
    if (stillIdle !== "idle") {
      throw new Error(`auto-start toggle should not start hosting immediately: ${stillIdle}`);
    }
    await toggleAutoStart();
    await waitFor(
      async () => ((await autoStartChecked()) ? null : true),
      5_000,
      "auto-start toggle off",
    );

    await evaluate(
      hostWindow,
      `document.querySelector('[data-testid="host-toggle"]').click()`,
      true,
    );

    const identity = await waitFor(
      async () => {
        const value = await evaluate<{ state: string; code: string; key: string }>(
          hostWindow,
          `(() => {
            const state = document.querySelector('[data-testid="host-state"]');
            const code = document.querySelector('[data-testid="remote-code"]');
            const key = document.querySelector('[data-testid="access-key"]');
            return {
              state: state?.dataset.state ?? "",
              code: code?.dataset.code ?? "",
              key: key?.dataset.key ?? "",
            };
          })()`,
        );
        if (
          value.state === "online" &&
          /^\d{9}$/.test(value.code) &&
          /^[A-Z0-9]{10}$/.test(value.key)
        ) {
          return value;
        }
        return null;
      },
      40_000,
      "host online",
    );
    result.host = {
      state: identity.state,
      codeLength: identity.code.length,
      keyLength: identity.key.length,
    };
    await shot(hostWindow, "host.png");

    await evaluate(
      hostWindow,
      `document.querySelector('[data-testid="open-settings"]').click()`,
      true,
    );
    const settingsOpen = await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `Boolean(document.querySelector('[data-testid="settings-dialog"]')?.open)`,
        ))
          ? true
          : null,
      5_000,
      "settings dialog",
    );
    result.settings = { opened: settingsOpen };
    await shot(hostWindow, "settings.png");
    await evaluate(
      hostWindow,
      `(() => {
        const dialog = document.querySelector('[data-testid="settings-dialog"]');
        if (dialog?.open) dialog.close();
      })()`,
    );
    await delay(250);

    const adminLogin = await evaluate<{ ok?: boolean }>(
      hostWindow,
      `window.remote.adminLogin({ target: "remote", password: "smoke-admin-password" })`,
    );
    if (!adminLogin?.ok) throw new Error("admin login during smoke failed");
    const tabClicked = await click(hostWindow, '[data-testid="tab-server"]');
    if (!tabClicked) throw new Error("server tab missing");
    await waitFor(
      async () =>
        (await evaluate<boolean>(hostWindow, `Boolean(document.querySelector(".server-panel"))`))
          ? true
          : null,
      10_000,
      "server panel",
    );
    const serverPanel = await waitFor(
      async () => {
        const value = await evaluate<{
          cardVisible: boolean;
          client: string;
          server: string;
        }>(
          hostWindow,
          `(() => {
            const card = document.querySelector(".version-card");
            if (!card) return null;
            const items = [...card.querySelectorAll(".version-item")];
            return {
              cardVisible: Boolean(card),
              client: items[0]?.querySelector("strong")?.textContent ?? "",
              server: items[1]?.querySelector("strong")?.textContent ?? "",
            };
          })()`,
        );
        return value && /^v\d/.test(value.client) && /^v\d/.test(value.server)
          ? value
          : null;
      },
      20_000,
      "server version card",
    );
    result.serverPanel = serverPanel;
    await evaluate(
      hostWindow,
      `document.querySelector(".version-card")?.scrollIntoView({ block: "center" })`,
    );
    await shot(hostWindow, "server-panel.png");
    await click(hostWindow, '[data-testid="tab-host"]');
    await delay(300);

    const controllerWindow = createWindow({
      code: identity.code,
      key: identity.key,
      smokeDevice: "smoke-controller-0001",
      smokeName: "Smoke 控制端",
    });
    controllerWindow.setContentProtection(true);
    await waitForLoad(controllerWindow, '[data-testid="control-connect"]');
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `(() => {
            const button = document.querySelector('[data-testid="control-connect"]');
            return Boolean(button) && !button.disabled;
          })()`,
        ))
          ? true
          : null,
      15_000,
      "controller form",
    );

    // Publish the host and approve a member request through the real UI.
    const publishClicked = await click(hostWindow, '[data-testid="host-publish-toggle"]');
    if (!publishClicked) throw new Error("publish toggle missing");
    const published = await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `document.querySelector('[data-testid="host-publish-toggle"]')?.getAttribute('aria-checked') === 'true'`,
        ))
          ? true
          : null,
      8_000,
      "host published",
    );
    await shot(hostWindow, "host-published.png");

    const catalogItemVisible = await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `(() => {
            const button = [...document.querySelectorAll('.catalog-item .catalog-action')].find(
              (element) => element.textContent?.includes('申请远控') && !element.disabled,
            );
            return Boolean(button);
          })()`,
        ))
          ? true
          : null,
      12_000,
      "catalog host",
    );
    const catalogJumpVisible = await evaluate<boolean>(
      controllerWindow,
      `Boolean(document.querySelector(".catalog-jump"))`,
    );
    if (catalogJumpVisible) {
      await click(controllerWindow, ".catalog-jump");
      await delay(750);
    } else {
      await evaluate(
        controllerWindow,
        `document.getElementById("shared-catalog")?.scrollIntoView({ block: "start" })`,
      );
      await delay(250);
    }
    await shot(controllerWindow, "controller-catalog.png");

    const requestClicked = await evaluate<boolean>(
      controllerWindow,
      `(() => {
        const button = [...document.querySelectorAll('.catalog-item .catalog-action')].find(
          (element) => element.textContent?.includes('申请远控') && !element.disabled,
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
      true,
    );
    if (!requestClicked) throw new Error("catalog request button missing");
    const requestSent = await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `Boolean(document.querySelector('[data-testid="catalog-request"]'))`,
        ))
          ? true
          : null,
      6_000,
      "catalog request pending",
    );
    const hostRequestVisible = await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `Boolean(document.querySelector('.request-card .request-item'))`,
        ))
          ? true
          : null,
      8_000,
      "host control request",
    );
    await shot(hostWindow, "host-request.png");
    const catalogAllowClicked = await evaluate<boolean>(
      hostWindow,
      `(() => {
        const button = [...document.querySelectorAll('.request-card button')].find((element) =>
          element.textContent?.includes('允许'),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
      true,
    );
    if (!catalogAllowClicked) throw new Error("approve request button missing");

    const catalogConnected = await waitFor(
      async () =>
        (await evaluate<string>(
          controllerWindow,
          `document.querySelector('[data-testid="connection-state"]')?.dataset.state ?? ""`,
        )) === "connected"
          ? true
          : null,
      25_000,
      "catalog-approved session",
    );
    await delay(800);
    await shot(controllerWindow, "controller-catalog-session.png");
    await shot(hostWindow, "host-catalog-session.png");

    result.catalog = {
      published: Boolean(published),
      jumpVisible: Boolean(catalogJumpVisible),
      itemVisible: Boolean(catalogItemVisible),
      requestSent: Boolean(requestSent),
      hostRequestVisible: Boolean(hostRequestVisible),
      connected: Boolean(catalogConnected),
    };

    const endClicked = await evaluate<boolean>(
      controllerWindow,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((element) =>
          element.textContent?.includes('结束控制'),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
      true,
    );
    if (!endClicked) throw new Error("end control button missing");
    await waitFor(
      async () =>
        (await evaluate<string>(
          controllerWindow,
          `document.querySelector('[data-testid="connection-state"]')?.dataset.state ?? ""`,
        )) === "idle"
          ? true
          : null,
      8_000,
      "controller idle after catalog session",
    );
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `(() => {
            const state = document.querySelector('[data-testid="host-state"]')?.dataset.state ?? "";
            return state === 'online' && !document.querySelector('.session-card');
          })()`,
        ))
          ? true
          : null,
      8_000,
      "host ready after catalog session",
    );
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `(() => {
            const button = document.querySelector('[data-testid="control-connect"]');
            return Boolean(button) && !button.disabled;
          })()`,
        ))
          ? true
          : null,
      8_000,
      "controller form after catalog session",
    );

    await evaluate(
      controllerWindow,
      `document.querySelector('[data-testid="control-connect"]').click()`,
      true,
    );

    await waitFor(
      async () =>
        (await evaluate<string>(
          controllerWindow,
          `document.querySelector('[data-testid="connection-state"]')?.dataset.state ?? ""`,
        )) === "connected"
          ? true
          : null,
      45_000,
      "controller session",
    );

    const media = await waitFor(
      async () => {
        const value = await evaluate<{
          videoWidth: number;
          videoHeight: number;
          channelOnline: boolean;
        }>(
          controllerWindow,
          `(() => {
            const video = document.querySelector('[data-testid="remote-video"]');
            return {
              videoWidth: video?.videoWidth ?? 0,
              videoHeight: video?.videoHeight ?? 0,
              channelOnline: Boolean(document.querySelector(".session-state.online")),
            };
          })()`,
        );
        return value.videoWidth > 0 && value.videoHeight > 0 && value.channelOnline
          ? value
          : null;
      },
      30_000,
      "remote video",
    );

    result.controller = {
      state: "connected",
      videoWidth: media.videoWidth,
      videoHeight: media.videoHeight,
      channelOnline: media.channelOnline,
    };

    await delay(1300);
    await shot(hostWindow, "host-session.png");

    hostWindow.setSize(880, 620);
    await delay(450);
    await shot(hostWindow, "host-session-min.png");
    hostWindow.setSize(
      1120,
      Math.min(780, Math.max(620, screen.getPrimaryDisplay().workAreaSize.height - 40)),
    );
    await delay(250);
    await shot(controllerWindow, "controller-session.png");

    // The controller window would otherwise turn injected cursor movement into
    // another pointer event on the same desktop and feed back into the session.
    controllerWindow.hide();
    await delay(300);

    const geometry = await waitFor(
      async () => {
        const value = await evaluate<{
          x: number;
          y: number;
          normX: number;
          normY: number;
        } | null>(
          controllerWindow,
          `(() => {
            const video = document.querySelector('[data-testid="remote-video"]');
            if (!video || !video.videoWidth || !video.videoHeight) return null;
            const rect = video.getBoundingClientRect();
            const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
            const width = video.videoWidth * scale;
            const height = video.videoHeight * scale;
            const left = rect.left + (rect.width - width) / 2;
            const top = rect.top + (rect.height - height) / 2;
            const normX = 0.68;
            const normY = 0.42;
            return {
              x: left + width * normX,
              y: top + height * normY,
              normX,
              normY,
            };
          })()`,
        );
        return value && Number.isFinite(value.x) && Number.isFinite(value.y)
          ? value
          : null;
      },
      5_000,
      "video geometry",
    );

    result.displays = screen.getAllDisplays().map((item) => ({
      id: item.id,
      bounds: {
        x: item.bounds.x,
        y: item.bounds.y,
        width: item.bounds.width,
        height: item.bounds.height,
      },
      scaleFactor: item.scaleFactor,
    }));

    const display = screen.getPrimaryDisplay().bounds;

    async function probe(targetX: number, targetY: number) {
      const expected = {
        x: display.x + targetX * display.width,
        y: display.y + targetY * display.height,
      };
      const attempts: Array<{
        actual: { x: number; y: number } | null;
        distance: number | null;
      }> = [];
      let actual: { x: number; y: number } | null = null;
      let best: number | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        injectMouseMove(targetX, targetY);
        await delay(150);
        actual = readCursorPosition();
        const distance = actual
          ? Math.hypot(actual.x - expected.x, actual.y - expected.y)
          : null;
        attempts.push({ actual, distance });
        if (distance !== null && (best === null || distance < best)) best = distance;
        if (best !== null && best <= 8) break;
      }
      return {
        actual,
        expected,
        distance: best,
        ok: best !== null && best <= 8,
        attempts,
      };
    }

    const probeEdge = await probe(0.25, 0.25);
    const probeTarget = await probe(0.68, 0.42);

    const cursorBefore = screen.getCursorScreenPoint();
    const before = appliedInputCount();
    await evaluate(
      controllerWindow,
      `(() => {
        const target = document.querySelector('[data-testid="remote-video"]');
        if (!target) return false;
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: ${JSON.stringify(geometry.x)},
            clientY: ${JSON.stringify(geometry.y)},
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        return true;
      })()`,
    );

    await waitFor(
      async () => (appliedInputCount() > before ? true : null),
      6_000,
      "remote input injection",
      100,
    );

    const received = lastAppliedInput();
    const normMatched =
      received?.kind === "mouse-move" &&
      Math.abs(received.x - geometry.normX) < 1e-6 &&
      Math.abs(received.y - geometry.normY) < 1e-6;

    const expectedX = display.x + geometry.normX * display.width;
    const expectedY = display.y + geometry.normY * display.height;
    let cursor = screen.getCursorScreenPoint();
    let closest = Math.hypot(cursor.x - expectedX, cursor.y - expectedY);
    // The desktop cursor can be moved by a human or another app during the
    // smoke run, so sample for a moment and use the closest position instead
    // of a single reading taken hundreds of milliseconds later.
    for (let sample = 0; sample < 12; sample += 1) {
      await delay(80);
      cursor = screen.getCursorScreenPoint();
      closest = Math.min(closest, Math.hypot(cursor.x - expectedX, cursor.y - expectedY));
    }

    result.input = {
      appliedEvents: appliedInputCount() - before,
      hostReceived: received,
      normMatched,
      directInjection: {
        expected: {
          x: Math.round(probeTarget.expected.x),
          y: Math.round(probeTarget.expected.y),
        },
        actual: probeTarget.actual,
        distance:
          probeTarget.distance === null
            ? null
            : Math.round(probeTarget.distance * 10) / 10,
        ok: probeEdge.ok && probeTarget.ok,
        probes: [
          {
            target: { x: 0.25, y: 0.25 },
            attempts: probeEdge.attempts.map((attempt) => ({
              actual: attempt.actual,
              distance:
                attempt.distance === null
                  ? null
                  : Math.round(attempt.distance * 10) / 10,
            })),
          },
          {
            target: { x: 0.68, y: 0.42 },
            attempts: probeTarget.attempts.map((attempt) => ({
              actual: attempt.actual,
              distance:
                attempt.distance === null
                  ? null
                  : Math.round(attempt.distance * 10) / 10,
            })),
          },
        ],
      },
      cursorBefore: { x: cursorBefore.x, y: cursorBefore.y },
      cursorAfter: { x: cursor.x, y: cursor.y },
      expected: {
        x: Math.round(expectedX * 10) / 10,
        y: Math.round(expectedY * 10) / 10,
      },
      cursorDistance: Math.round(closest * 10) / 10,
      cursorClosest: Math.round(closest * 10) / 10,
      cursorMatched: closest <= 24,
    };

    // In-session chat over the same data channel as input.
    const chatA = "会话内测试消息：你好";
    const chatB = "收到，画面很清晰";
    await click(controllerWindow, '[aria-label="会话消息"]');
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `Boolean(document.querySelector(".session-chat-form input"))`,
        ))
          ? true
          : null,
      5_000,
      "controller chat panel",
    );
    await fillChat(controllerWindow, ".session-chat-form input", chatA);
    await delay(180);
    await submitChat(controllerWindow, ".session-chat-form");
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `Boolean(document.querySelector(".host-chat-button .tool-badge"))`,
        ))
          ? true
          : null,
      8_000,
      "host unread chat badge",
    );
    await click(hostWindow, ".host-chat-button");
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          hostWindow,
          `Boolean(document.querySelector(".host-chat-form input"))`,
        ))
          ? true
          : null,
      5_000,
      "host chat panel",
    );
    await waitFor(
      async () => ((await chatTexts(hostWindow, ".host-chat .chat-bubble")).includes(chatA) ? true : null),
      8_000,
      "host received chat",
    );
    await fillChat(hostWindow, ".host-chat-form input", chatB);
    await delay(180);
    await submitChat(hostWindow, ".host-chat-form");
    const controllerSawChat = await waitFor(
      async () =>
        (await chatTexts(controllerWindow, ".session-chat .chat-bubble")).includes(chatB)
          ? true
          : null,
      8_000,
      "controller received chat",
    );

    // Host can pause input while the screen stays visible.
    const pauseButton = await clickHostTool(hostWindow, "暂停");
    if (!pauseButton) throw new Error("pause input button missing");
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `Boolean(document.querySelector(".input-paused-banner"))`,
        ))
          ? true
          : null,
      6_000,
      "input paused state",
    );
    await delay(450);
    const pausedCount = appliedInputCount();
    await evaluate(
      controllerWindow,
      `(() => {
        const target = document.querySelector('[data-testid="remote-video"]');
        if (!target) return false;
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: ${JSON.stringify(geometry.x + 8)},
            clientY: ${JSON.stringify(geometry.y + 6)},
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        return true;
      })()`,
    );
    await delay(900);
    const inputWhilePaused = appliedInputCount() > pausedCount;
    const resumeButton = await clickHostTool(hostWindow, "恢复");
    if (!resumeButton) throw new Error("resume input button missing");
    await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `!document.querySelector(".input-paused-banner")`,
        ))
          ? true
          : null,
      6_000,
      "input resumed state",
    );
    await delay(450);
    const resumeCount = appliedInputCount();
    await evaluate(
      controllerWindow,
      `(() => {
        const target = document.querySelector('[data-testid="remote-video"]');
        if (!target) return false;
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: ${JSON.stringify(geometry.x + 14)},
            clientY: ${JSON.stringify(geometry.y + 11)},
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        return true;
      })()`,
    );
    const resumed = await waitFor(
      async () => (appliedInputCount() > resumeCount ? true : null),
      6_000,
      "input after resume",
    );

    // Clipboard sync requires explicit permission from both sides.
    const clipSelector = '[aria-label="剪贴板同步"]';
    const clipBefore = await buttonState(controllerWindow, clipSelector);
    const allowClicked = await clickHostTool(hostWindow, "剪贴板未允许");
    if (!allowClicked) throw new Error("allow clipboard button missing");
    const clipAllowed = await waitFor(
      async () => {
        const state = await buttonState(controllerWindow, clipSelector);
        return state && !state.disabled ? state : null;
      },
      6_000,
      "clipboard allowed",
    );
    await click(controllerWindow, clipSelector);
    const clipEnabled = await waitFor(
      async () => {
        const state = await buttonState(controllerWindow, clipSelector);
        return state?.pressed ? state : null;
      },
      4_000,
      "clipboard enabled",
    );
    await click(controllerWindow, clipSelector);
    const clipDisabled = await waitFor(
      async () => {
        const state = await buttonState(controllerWindow, clipSelector);
        return state && !state.pressed ? state : null;
      },
      4_000,
      "clipboard disabled",
    );
    await clickHostTool(hostWindow, "剪贴板已允许");
    const clipRevoked = await waitFor(
      async () => {
        const state = await buttonState(controllerWindow, clipSelector);
        return state?.disabled ? state : null;
      },
      6_000,
      "clipboard revoked",
    );

    // View scaling and quality selection stay in the controller UI.
    const clickView = (label: string) =>
      evaluate<boolean>(
        controllerWindow,
        `(() => {
          const button = [...document.querySelectorAll(".view-switch button")].find((element) =>
            element.textContent?.includes(${JSON.stringify(label)}),
          );
          if (!button) return false;
          button.click();
          return true;
        })()`,
        true,
      );
    if (!(await clickView("填充"))) throw new Error("fill view button missing");
    const filledView = await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `(() => {
            const stage = document.querySelector(".video-stage");
            const video = document.querySelector('[data-testid="remote-video"]');
            return Boolean(stage?.classList.contains("view-fill") && video?.classList.contains("view-fill"));
          })()`,
        ))
          ? true
          : null,
      4_000,
      "fill view",
    );
    if (!(await clickView("原尺寸"))) throw new Error("actual view button missing");
    const actualView = await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `(() => {
            const video = document.querySelector('[data-testid="remote-video"]');
            return Boolean(
              video?.classList.contains("view-actual") &&
                video.style.width === video.videoWidth + "px" &&
                video.style.height === video.videoHeight + "px",
            );
          })()`,
        ))
          ? true
          : null,
      4_000,
      "actual view",
    );
    if (!(await clickView("适应"))) throw new Error("fit view button missing");
    const fitView = await waitFor(
      async () =>
        (await evaluate<boolean>(
          controllerWindow,
          `Boolean(document.querySelector(".video-stage.view-fit"))`,
        ))
          ? true
          : null,
      4_000,
      "fit view",
    );

    const qualitySelected = await evaluate<boolean>(
      controllerWindow,
      `(() => {
        const select = document.querySelector(".quality-select");
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = "smooth";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    await delay(180);
    const qualityValue = await evaluate<string>(
      controllerWindow,
      `document.querySelector(".quality-select")?.value ?? ""`,
    );
    await evaluate(
      controllerWindow,
      `(() => {
        const select = document.querySelector(".quality-select");
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = "balanced";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    await delay(180);
    const qualityReset = await evaluate<string>(
      controllerWindow,
      `document.querySelector(".quality-select")?.value ?? ""`,
    );

    result.features = {
      chat: Boolean(controllerSawChat),
      pause: Boolean(!inputWhilePaused && resumed),
      clipboardGate: Boolean(
        clipBefore?.disabled && clipAllowed && clipEnabled && clipDisabled && clipRevoked,
      ),
      viewModes: Boolean(filledView && actualView && fitView),
      quality: qualitySelected && qualityValue === "smooth" && qualityReset === "balanced",
    };

    await click(hostWindow, ".host-chat-button");
    await evaluate(
      hostWindow,
      `document.querySelectorAll(".toast-close").forEach((button) => button.click())`,
    );
    await evaluate(
      controllerWindow,
      `document.querySelectorAll(".toast-close").forEach((button) => button.click())`,
    );
    await delay(300);
    await shot(hostWindow, "host-session-features.png");
    controllerWindow.show();
    await delay(500);
    await shot(controllerWindow, "controller-session-features.png");

    result.ok = Boolean(
      result.host &&
        result.controller &&
        result.controller.channelOnline &&
        result.input &&
        result.input.appliedEvents > 0 &&
        result.input.normMatched &&
        result.input.directInjection.ok &&
        result.features &&
        Object.values(result.features).every(Boolean) &&
        result.catalog &&
        Object.values(result.catalog).every(Boolean),
    );
  } catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    writeFileSync(path.join(outputDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(`[smoke] ${JSON.stringify({ ok: result.ok, error: result.error })}`);
    app.exit(result.ok ? 0 : 1);
  }
}
