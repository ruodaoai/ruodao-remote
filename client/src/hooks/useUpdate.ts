import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../types";

import { t } from "../i18n";

type UpdateAction = "check" | "download" | "install" | "auto";

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return t("更新失败，请稍后再试。");
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

export function useUpdate() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void window.remote
      .updateStatus()
      .then((next) => {
        if (mounted.current) setStatus(next);
      })
      .catch(() => {
        // 更新状态读取失败不影响主流程；手动检查时会再次尝试。
      });
    const off = window.remote.onUpdateEvent((event) => {
      if (!mounted.current) return;
      setStatus(event);
      if (event.phase === "error" && event.error) setActionError(event.error);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, []);

  const check = useCallback(async () => {
    setBusy("check");
    setActionError(null);
    try {
      const next = await window.remote.updateCheck();
      if (mounted.current) {
        setStatus(next);
        if (next.phase === "error" && next.error) setActionError(next.error);
      }
    } catch (error) {
      if (mounted.current) setActionError(cleanError(error));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const download = useCallback(async () => {
    setBusy("download");
    setActionError(null);
    try {
      const next = await window.remote.updateDownload();
      if (mounted.current) {
        setStatus(next);
        if (next.phase === "error" && next.error) setActionError(next.error);
      }
    } catch (error) {
      if (mounted.current) setActionError(cleanError(error));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    setBusy("install");
    setActionError(null);
    try {
      const result = await window.remote.updateInstall();
      if (!result.ok) {
        if (mounted.current) setActionError(result.error ?? t("安装失败，请稍后重试。"));
        return false;
      }
      return true;
    } catch (error) {
      if (mounted.current) setActionError(cleanError(error));
      return false;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const setAuto = useCallback(async (enabled: boolean) => {
    setBusy("auto");
    setActionError(null);
    try {
      const next = await window.remote.updateSetAuto(enabled);
      if (mounted.current) setStatus(next);
    } catch (error) {
      if (mounted.current) setActionError(cleanError(error));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const openFolder = useCallback(async () => {
    await window.remote.updateOpenFolder().catch(() => false);
  }, []);

  const dismissError = useCallback(() => setActionError(null), []);

  return { status, busy, actionError, check, download, install, setAuto, openFolder, dismissError };
}
