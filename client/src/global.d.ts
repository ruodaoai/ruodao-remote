import type {
  AdminResult,
  AdminServerInfo,
  AdminStatus,
  AdminTarget,
  AppInfo,
  AssistantChatTurn,
  AssistantReply,
  AssistantStatus,
  CommunityReview,
  CommunityThread,
  DeployConfig,
  DeployEvent,
  LocalServerStatus,
  SavedKey,
  SessionLogEntry,
  Settings,
  SettingsPatch,
  UpdateStatus,
} from "./types";
import type { InputEventPayload } from "./lib/input";

declare global {
  interface Window {
    remote: {
      appInfo(): Promise<AppInfo>;
      getSettings(): Promise<Settings>;
      updateSettings(patch: SettingsPatch): Promise<Settings>;
      loadHostKey(): Promise<SavedKey | null>;
      saveHostKey(value: SavedKey | null): Promise<{ persisted: boolean }>;
      getPrimaryDisplay(): Promise<{ width: number; height: number; scaleFactor: number }>;
      setInputActive(active: boolean): Promise<boolean>;
      injectInput(event: InputEventPayload): void;
      releaseAllInput(): void;
      readClipboardText(): Promise<string>;
      writeClipboardText(text: string): Promise<boolean>;
      readClipboardImage(): Promise<string | null>;
      writeClipboardImage(dataUrl: string): Promise<boolean>;
      adminStatus(target?: AdminTarget): Promise<AdminStatus>;
      adminLogin(input: {
        target?: AdminTarget;
        password: string;
        remember?: boolean;
      }): Promise<{ ok: true; expiresAt: number; server: AdminServerInfo | null }>;
      adminLogout(input?: { target?: AdminTarget; forget?: boolean }): Promise<{ ok: true }>;
      adminRequest(input: {
        target?: AdminTarget;
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        path: string;
        body?: unknown;
      }): Promise<AdminResult>;
      openAdminConsole(target?: AdminTarget): Promise<{ ok: boolean; error?: string }>;
      localServerStatus(): Promise<LocalServerStatus>;
      startLocalServer(): Promise<LocalServerStatus>;
      stopLocalServer(): Promise<LocalServerStatus>;
      localServerPassword(): Promise<{ password: string; persisted: boolean }>;
      startDeploy(config: DeployConfig): Promise<{ runId: string }>;
      confirmDeployHostKey(input: { runId: string; accept: boolean }): Promise<{ ok: true }>;
      cancelDeploy(runId: string): Promise<{ ok: true }>;
      forgetDeployHost(input: { host: string; port: number }): Promise<{ ok: true }>;
      pickDeployKey(): Promise<string | null>;
      assistantStatus(): Promise<AssistantStatus>;
      assistantLogin(input: {
        email: string;
        password: string;
      }): Promise<AssistantStatus>;
      assistantLogout(): Promise<{ ok: true }>;
      assistantModels(): Promise<AssistantStatus>;
      assistantChat(input: {
        question: string;
        context?: string;
        history?: AssistantChatTurn[];
        model?: string;
        images?: string[];
      }): Promise<AssistantReply>;
      assistantOpenAccount(path: "login" | "register" | "models" | "usage"): Promise<{ ok: true }>;
      communityThread(input?: { page?: number }): Promise<CommunityThread>;
      communitySubmit(input: {
        rating: number;
        content: string;
      }): Promise<CommunityThread>;
      communityHelpful(input: {
        reviewId: string;
      }): Promise<{ review: CommunityReview | null }>;
      communityDelete(input: { reviewId: string }): Promise<CommunityThread>;
      communityOpenApp(): Promise<{ ok: true }>;
      communityOpenMarket(): Promise<{ ok: true }>;
      updateStatus(): Promise<UpdateStatus>;
      updateCheck(): Promise<UpdateStatus>;
      updateDownload(): Promise<UpdateStatus>;
      updateInstall(): Promise<{ ok: boolean; error?: string }>;
      updateSetAuto(value: boolean): Promise<UpdateStatus>;
      updateOpenFolder(): Promise<boolean>;
      appendSessionLog(
        entry: Omit<SessionLogEntry, "id" | "recordedAt"> & {
          id?: string;
          recordedAt?: number;
        },
      ): Promise<{ ok: true; entry: SessionLogEntry }>;
      listSessionLogs(limit?: number): Promise<SessionLogEntry[]>;
      openSessionLogFolder(): Promise<{ ok: boolean; error?: string }>;
      onDeployEvent(listener: (event: DeployEvent) => void): () => void;
      onUpdateEvent(listener: (event: UpdateStatus) => void): () => void;
      smoke: boolean;
    };
  }
}

export {};
