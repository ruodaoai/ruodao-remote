import { useCallback, useRef, useState } from "react";
import type {
  AssistantChatTurn,
  AssistantReply,
  AssistantStatus,
} from "../types";

import { t } from "../i18n";

export interface AssistantController {
  status: AssistantStatus | null;
  loading: boolean;
  loginBusy: boolean;
  chatBusy: boolean;
  error: string | null;
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshModels: () => Promise<void>;
  send: (input: {
    question: string;
    context: string;
    history: AssistantChatTurn[];
    model?: string;
    images?: string[];
  }) => Promise<AssistantReply>;
  openAccount: (path: "login" | "register" | "models" | "usage") => Promise<void>;
  clearError: () => void;
}

export function cleanAssistantError(error: unknown): string {
  if (!(error instanceof Error)) return t("AI 助手暂时不可用，请稍后再试。");
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")
    .trim();
}

function signedOutStatus(current: AssistantStatus | null): AssistantStatus {
  return {
    authenticated: false,
    sessionExpired: false,
    email: "",
    user: null,
    models: [],
    defaultModel: "",
    model: "",
    modelsError: null,
    persistAvailable: current?.persistAvailable ?? false,
    apiBaseUrl: current?.apiBaseUrl ?? "https://ruodao.com",
  };
}

export function useAssistant(): AssistantController {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const pendingRef = useRef<Promise<void> | null>(null);

  const ensureLoaded = useCallback(async () => {
    if (loadedRef.current) return;
    if (pendingRef.current) return pendingRef.current;
    setLoading(true);
    const task = (async () => {
      try {
        const next = await window.remote.assistantStatus();
        setStatus(next);
        setError(null);
        loadedRef.current = true;
      } catch (err) {
        setError(cleanAssistantError(err));
      } finally {
        setLoading(false);
        pendingRef.current = null;
      }
    })();
    pendingRef.current = task;
    return task;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.remote.assistantStatus();
      setStatus(next);
      loadedRef.current = true;
      setError(null);
    } catch (err) {
      setError(cleanAssistantError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoginBusy(true);
    setError(null);
    try {
      const next = await window.remote.assistantLogin({ email, password });
      setStatus(next);
      loadedRef.current = true;
      return next.authenticated;
    } catch (err) {
      setError(cleanAssistantError(err));
      return false;
    } finally {
      setLoginBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await window.remote.assistantLogout();
    } catch (err) {
      setError(cleanAssistantError(err));
    } finally {
      setStatus((current) => signedOutStatus(current));
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.remote.assistantModels();
      setStatus(next);
    } catch (err) {
      setError(cleanAssistantError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const send = useCallback(
    async (input: {
      question: string;
      context: string;
      history: AssistantChatTurn[];
      model?: string;
      images?: string[];
    }) => {
      setChatBusy(true);
      setError(null);
      try {
        return await window.remote.assistantChat(input);
      } catch (err) {
        const message = cleanAssistantError(err);
        setError(message);
        if (/登录|过期/.test(message)) {
          void refresh();
        }
        throw new Error(message);
      } finally {
        setChatBusy(false);
      }
    },
    [refresh],
  );

  const openAccount = useCallback(async (path: "login" | "register" | "models" | "usage") => {
    try {
      await window.remote.assistantOpenAccount(path);
    } catch (err) {
      setError(cleanAssistantError(err));
    }
  }, []);

  return {
    status,
    loading,
    loginBusy,
    chatBusy,
    error,
    ensureLoaded,
    refresh,
    login,
    logout,
    refreshModels,
    send,
    openAccount,
    clearError: () => setError(null),
  };
}
