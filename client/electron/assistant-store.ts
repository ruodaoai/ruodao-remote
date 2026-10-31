import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AssistantUser } from "./assistant-protocol";

interface StoredAssistantSession {
  apiBaseUrl: string;
  email: string;
  tokenEncrypted: string;
  user: AssistantUser | null;
  model: string;
}

export interface AssistantAuth {
  email: string;
  token: string;
  user: AssistantUser | null;
  model: string;
}

let cache: StoredAssistantSession | null | undefined;

function storePath(): string {
  return path.join(app.getPath("userData"), "assistant.json");
}

function read(): StoredAssistantSession | null {
  if (cache !== undefined) return cache;
  if (!existsSync(storePath())) {
    cache = null;
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<StoredAssistantSession>;
    if (
      typeof raw.apiBaseUrl !== "string" ||
      typeof raw.tokenEncrypted !== "string" ||
      !raw.tokenEncrypted
    ) {
      cache = null;
      return cache;
    }
    cache = {
      apiBaseUrl: raw.apiBaseUrl,
      email: typeof raw.email === "string" ? raw.email : "",
      tokenEncrypted: raw.tokenEncrypted,
      user: (raw.user ?? null) as AssistantUser | null,
      model: typeof raw.model === "string" ? raw.model : "",
    };
  } catch {
    cache = null;
  }
  return cache;
}

function persist(session: StoredAssistantSession): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(session, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(session, null, 2), { encoding: "utf8", mode: 0o600 });
  }
  cache = session;
}

export function assistantPersistAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function loadAssistantAuth(apiBaseUrl: string): AssistantAuth | null {
  const stored = read();
  if (!stored || stored.apiBaseUrl !== apiBaseUrl) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const token = safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, "base64"));
    if (!token) return null;
    return {
      email: stored.email,
      token,
      user: stored.user,
      model: stored.model,
    };
  } catch {
    return null;
  }
}

export function saveAssistantAuth(
  apiBaseUrl: string,
  auth: { email: string; token: string; user: AssistantUser | null; model: string },
): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  persist({
    apiBaseUrl,
    email: auth.email,
    tokenEncrypted: safeStorage.encryptString(auth.token).toString("base64"),
    user: auth.user,
    model: auth.model,
  });
  return true;
}

export function clearAssistantAuth(): void {
  cache = null;
  try {
    rmSync(storePath(), { force: true });
  } catch {
    // The in-memory session is still cleared by the caller.
  }
}
