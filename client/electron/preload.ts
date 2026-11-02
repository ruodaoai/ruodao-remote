import { contextBridge, ipcRenderer } from "electron";

const smoke = process.argv.includes("--remote-smoke");

const api = {
  appInfo: () => ipcRenderer.invoke("app:info"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("settings:update", patch),
  loadHostKey: () => ipcRenderer.invoke("key:load"),
  saveHostKey: (value: unknown) => ipcRenderer.invoke("key:save", value),
  getPrimaryDisplay: () => ipcRenderer.invoke("display:primary"),
  setInputActive: (active: unknown) => ipcRenderer.invoke("input:active", active),
  injectInput: (event: unknown) => ipcRenderer.send("input:event", event),
  releaseAllInput: () => ipcRenderer.send("input:release"),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text: unknown) => ipcRenderer.invoke("clipboard:write-text", text),
  readClipboardImage: () => ipcRenderer.invoke("clipboard:read-image"),
  writeClipboardImage: (dataUrl: unknown) => ipcRenderer.invoke("clipboard:write-image", dataUrl),
  adminStatus: (target?: unknown) => ipcRenderer.invoke("admin:status", target),
  adminLogin: (input: unknown) => ipcRenderer.invoke("admin:login", input),
  adminLogout: (input: unknown) => ipcRenderer.invoke("admin:logout", input),
  adminRequest: (input: unknown) => ipcRenderer.invoke("admin:request", input),
  openAdminConsole: (target?: unknown) => ipcRenderer.invoke("admin:open", target),
  localServerStatus: () => ipcRenderer.invoke("local-server:status"),
  startLocalServer: () => ipcRenderer.invoke("local-server:start"),
  stopLocalServer: () => ipcRenderer.invoke("local-server:stop"),
  localServerPassword: () => ipcRenderer.invoke("local-server:password"),
  startDeploy: (config: unknown) => ipcRenderer.invoke("deploy:start", config),
  confirmDeployHostKey: (input: unknown) =>
    ipcRenderer.invoke("deploy:confirm-host-key", input),
  cancelDeploy: (runId: unknown) => ipcRenderer.invoke("deploy:cancel", { runId }),
  forgetDeployHost: (input: unknown) => ipcRenderer.invoke("deploy:forget-host", input),
  pickDeployKey: () => ipcRenderer.invoke("deploy:pick-key"),
  assistantStatus: () => ipcRenderer.invoke("assistant:status"),
  assistantLogin: (input: unknown) => ipcRenderer.invoke("assistant:login", input),
  assistantLogout: () => ipcRenderer.invoke("assistant:logout"),
  assistantModels: () => ipcRenderer.invoke("assistant:models"),
  assistantChat: (input: unknown) => ipcRenderer.invoke("assistant:chat", input),
  assistantOpenAccount: (path: unknown) =>
    ipcRenderer.invoke("assistant:open-account", path),
  openSourceThread: (input?: unknown) => ipcRenderer.invoke("open-source:thread", input),
  openSourceSubmit: (input: unknown) => ipcRenderer.invoke("open-source:submit", input),
  openSourceDelete: (input: unknown) => ipcRenderer.invoke("open-source:delete", input),
  openSourceOpen: (input: unknown) => ipcRenderer.invoke("open-source:open", input),
  sharedServersList: (input?: unknown) => ipcRenderer.invoke("shared-servers:list", input),
  sharedServersMine: () => ipcRenderer.invoke("shared-servers:mine"),
  sharedServersRefresh: () => ipcRenderer.invoke("shared-servers:refresh"),
  sharedServersCreate: (input: unknown) => ipcRenderer.invoke("shared-servers:create", input),
  sharedServersUpdate: (input: unknown) => ipcRenderer.invoke("shared-servers:update", input),
  sharedServersRemove: (input: unknown) => ipcRenderer.invoke("shared-servers:remove", input),
  sharedServersReport: (input: unknown) => ipcRenderer.invoke("shared-servers:report", input),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateDownload: () => ipcRenderer.invoke("update:download"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  updateSetAuto: (value: unknown) => ipcRenderer.invoke("update:set-auto", value),
  updateOpenFolder: () => ipcRenderer.invoke("update:open-folder"),
  appendSessionLog: (entry: unknown) => ipcRenderer.invoke("session-log:append", entry),
  listSessionLogs: (limit?: unknown) => ipcRenderer.invoke("session-log:list", limit),
  openSessionLogFolder: () => ipcRenderer.invoke("session-log:open"),
  onDeployEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("deploy:event", handler);
    return () => ipcRenderer.removeListener("deploy:event", handler);
  },
  onUpdateEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("update:event", handler);
    return () => ipcRenderer.removeListener("update:event", handler);
  },
  smoke,
};

contextBridge.exposeInMainWorld("remote", api);
