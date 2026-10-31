import {
  app,
  BrowserWindow,
  ClipboardItem,
  Menu,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
} from "electron";
import path from "node:path";
import {
  applyInputEvent,
  inputAvailable,
  isInputEventPayload,
  releaseAllInput,
} from "./input-win";
import {
  initializeSettings,
  loadHostKey,
  publicSettings,
  saveHostKey,
  updateSettings,
  type SettingsPatch,
} from "./settings";
import {
  adminLogin,
  adminLogout,
  adminRequest,
  adminStatus,
  openAdminConsole,
} from "./admin";
import {
  autoStartLocalServer,
  localServerStatus,
  revealLocalServerPassword,
  shutdownLocalServer,
  startLocalServer,
  stopLocalServer,
} from "./local-server";
import {
  cancelDeploy,
  confirmDeployHostKey,
  forgetDeployHost,
  shutdownDeploy,
  startDeploy,
} from "./deploy";
import { registerAssistantIpc } from "./assistant";
import { registerCommunityIpc } from "./community";
import { initializeUpdater, installOnQuit, shutdownUpdater } from "./updater";
import { appendSessionLog, listSessionLogs, openSessionLogFolder } from "./session-log";

const smokeDir = process.env.REMOTE_SMOKE_DIR?.trim();
if (smokeDir) {
  app.setPath("userData", path.join(smokeDir, "userdata"));
}

app.setAppUserModelId("com.ruodao.remote");
app.setName("若道远程");

let inputActive = false;
let inputBudgetStartedAt = Date.now();
let inputBudgetCount = 0;

function applyLaunchAtLogin(): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: publicSettings().launchAtLogin });
}

function readSettingsPatch(value: unknown): SettingsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("设置参数不合法");
  }
  const raw = value as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if (typeof raw.serverUrl === "string") patch.serverUrl = raw.serverUrl;
  if (typeof raw.deviceName === "string") patch.deviceName = raw.deviceName;
  if (typeof raw.autoStartHost === "boolean") patch.autoStartHost = raw.autoStartHost;
  if (typeof raw.preferredCode === "string") patch.preferredCode = raw.preferredCode;
  if (typeof raw.inviteCode === "string") patch.inviteCode = raw.inviteCode;
  if (typeof raw.localServerEnabled === "boolean") {
    patch.localServerEnabled = raw.localServerEnabled;
  }
  if (typeof raw.localServerPort === "number") patch.localServerPort = raw.localServerPort;
  if (typeof raw.localServerPublicUrl === "string") {
    patch.localServerPublicUrl = raw.localServerPublicUrl;
  }
  if (typeof raw.launchAtLogin === "boolean") patch.launchAtLogin = raw.launchAtLogin;
  if (typeof raw.autoUpdate === "boolean") patch.autoUpdate = raw.autoUpdate;
  return patch;
}

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  platform: process.platform,
  inputAvailable: inputAvailable(),
  smoke: Boolean(smokeDir),
}));

ipcMain.handle("settings:get", () => publicSettings());

ipcMain.handle("settings:update", (_event, value: unknown) => {
  const next = updateSettings(readSettingsPatch(value));
  applyLaunchAtLogin();
  return next;
});

ipcMain.handle("key:load", () => loadHostKey());

ipcMain.handle("key:save", (_event, value: unknown) => {
  if (value === null) return saveHostKey(null);
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("密钥格式不正确");
  const raw = value as Record<string, unknown>;
  if (typeof raw.key !== "string" || typeof raw.salt !== "string") {
    throw new Error("密钥格式不正确");
  }
  const key = raw.key.toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(key)) throw new Error("密钥格式不正确");
  if (!/^[0-9a-f]{32}$/i.test(raw.salt)) throw new Error("密钥格式不正确");
  return saveHostKey({ key, salt: raw.salt.toLowerCase() });
});

ipcMain.handle("admin:status", (_event, target: unknown) => adminStatus(target));

ipcMain.handle("admin:login", (_event, input: unknown) => adminLogin(input));

ipcMain.handle("admin:logout", (_event, input: unknown) => adminLogout(input));

ipcMain.handle("admin:request", (_event, input: unknown) => adminRequest(input));

ipcMain.handle("admin:open", (_event, target: unknown) => openAdminConsole(target));

ipcMain.handle("local-server:status", () => localServerStatus());

ipcMain.handle("local-server:start", () => startLocalServer());

ipcMain.handle("local-server:stop", () => stopLocalServer());

ipcMain.handle("local-server:password", () => revealLocalServerPassword());

ipcMain.handle("deploy:start", (event, input: unknown) =>
  startDeploy(input, (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send("deploy:event", payload);
  }),
);

ipcMain.handle("deploy:confirm-host-key", (_event, input: unknown) =>
  confirmDeployHostKey(input),
);

ipcMain.handle("deploy:cancel", (_event, input: unknown) => cancelDeploy(input));

ipcMain.handle("deploy:forget-host", (_event, input: unknown) => forgetDeployHost(input));

ipcMain.handle("deploy:pick-key", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择 SSH 私钥",
    properties: ["openFile"],
    filters: [{ name: "所有文件", extensions: ["*"] }],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("display:primary", () => {
  const display = screen.getPrimaryDisplay();
  return {
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
  };
});

registerAssistantIpc();
registerCommunityIpc();

ipcMain.handle("session-log:append", (_event, value: unknown) => appendSessionLog(value));

ipcMain.handle("session-log:list", (_event, limit: unknown) => listSessionLogs(limit));

ipcMain.handle("session-log:open", () => openSessionLogFolder());

ipcMain.handle("input:active", (_event, value: unknown) => {
  inputActive = value === true;
  if (!inputActive) releaseAllInput();
  return inputActive;
});

ipcMain.on("input:event", (_event, payload: unknown) => {
  if (!inputActive || !isInputEventPayload(payload)) return;
  const now = Date.now();
  if (now - inputBudgetStartedAt > 1000) {
    inputBudgetStartedAt = now;
    inputBudgetCount = 0;
  }
  inputBudgetCount += 1;
  if (inputBudgetCount > 900) return;
  applyInputEvent(payload);
});

ipcMain.on("input:release", () => releaseAllInput());

const CLIPBOARD_TEXT_LIMIT = 64 * 1024;
const CLIPBOARD_IMAGE_DATA_URL_LIMIT = 16 * 1024 * 1024;
const CLIPBOARD_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

ipcMain.handle("clipboard:read-text", async () => {
  const text = await clipboard.readText();
  return text.length > CLIPBOARD_TEXT_LIMIT ? text.slice(0, CLIPBOARD_TEXT_LIMIT) : text;
});

ipcMain.handle("clipboard:write-text", async (_event, value: unknown) => {
  if (typeof value !== "string") return false;
  const text = value.replace(/\u0000/g, "").slice(0, CLIPBOARD_TEXT_LIMIT);
  if (!text) return false;
  await clipboard.writeText(text);
  return true;
});

ipcMain.handle("clipboard:read-image", async () => {
  const items = await clipboard.read();
  for (const item of items) {
    const mime = item.types.find((type) => /^image\/(?:png|jpe?g|webp|gif)$/i.test(type));
    if (!mime) continue;
    const payload = await item.getType(mime);
    if (!(payload instanceof Blob)) continue;
    if (payload.size > 12 * 1024 * 1024) continue;
    const dataUrl = `data:${mime.toLowerCase()};base64,${Buffer.from(
      await payload.arrayBuffer(),
    ).toString("base64")}`;
    if (dataUrl.length > CLIPBOARD_IMAGE_DATA_URL_LIMIT) continue;
    if (CLIPBOARD_IMAGE_PATTERN.test(dataUrl)) return dataUrl;
  }
  return null;
});

ipcMain.handle("clipboard:write-image", async (_event, value: unknown) => {
  if (typeof value !== "string") return false;
  const dataUrl = value.trim();
  if (!dataUrl || dataUrl.length > CLIPBOARD_IMAGE_DATA_URL_LIMIT) return false;
  if (!CLIPBOARD_IMAGE_PATTERN.test(dataUrl)) return false;
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return false;
  const blob = new Blob([image.toPNG()], { type: "image/png" });
  await clipboard.write([new ClipboardItem({ "image/png": blob })]);
  return true;
});

function setupDisplayCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const primaryId = String(screen.getPrimaryDisplay().id);
        const source =
          sources.find((item) => item.display_id === primaryId) ?? sources[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function loadApp(win: BrowserWindow, query?: Record<string, string>): void {
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    const url = new URL(devServer);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(
      path.join(__dirname, "..", "dist", "index.html"),
      query ? { query } : undefined,
    );
  }
}

function createWindow(query?: Record<string, string>): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1120, Math.max(880, workArea.width - 40));
  const height = Math.min(780, Math.max(620, workArea.height - 40));
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 880,
    minHeight: 620,
    show: false,
    title: "若道远程",
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    // Packaged builds carry the icon in the executable; dev runs need it here.
    ...(app.isPackaged
      ? {}
      : { icon: path.join(app.getAppPath(), "build", "icon.png") }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: smokeDir ? ["--remote-smoke"] : [],
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    const allowed = devServer
      ? url.startsWith(devServer)
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  win.on("closed", () => {
    inputActive = false;
    releaseAllInput();
  });

  loadApp(win, query);

  if (process.env.REMOTE_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initializeSettings();
  applyLaunchAtLogin();
  setupDisplayCapture();
  initializeUpdater();
  const hostWindow = createWindow();
  void autoStartLocalServer().catch((error: unknown) => {
    console.error("[local-server] auto start failed", error);
  });

  if (smokeDir) {
    void import("./smoke")
      .then(({ runSmoke }) =>
        runSmoke({
          hostWindow,
          createWindow,
          outputDir: smokeDir,
        }),
      )
      .catch((error: unknown) => {
        console.error("[smoke] failed", error);
        app.exit(1);
      });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  inputActive = false;
  releaseAllInput();
  installOnQuit();
  shutdownUpdater();
  shutdownLocalServer();
  shutdownDeploy();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || smokeDir) app.quit();
});
