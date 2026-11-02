import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenSourceOpenTarget, OpenSourceThread } from "../types";

import { t } from "../i18n";

export interface OpenSourceController {
  thread: OpenSourceThread | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  submitting: boolean;
  deletingId: string | null;
  error: string | null;
  notice: string | null;
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  submit: (body: string, parentCommentId?: string) => Promise<boolean>;
  remove: (commentId: string) => Promise<boolean>;
  open: (target: OpenSourceOpenTarget) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
}

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return t("若道社区暂时不可用，请稍后再试。");
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")
    .trim();
}

function mergeThread(current: OpenSourceThread, next: OpenSourceThread): OpenSourceThread {
  const seen = new Set(current.items.map((item) => item.id));
  return {
    ...next,
    items: [
      ...current.items,
      ...next.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    ],
  };
}

export function useOpenSource(): OpenSourceController {
  const [thread, setThread] = useState<OpenSourceThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const pendingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadFirst = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await window.remote.openSourceThread({ page: 1 });
      setThread(next);
      loadedRef.current = true;
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (loadedRef.current) return;
    if (pendingRef.current) return pendingRef.current;
    const task = loadFirst("initial");
    pendingRef.current = task;
    try {
      await task;
    } finally {
      pendingRef.current = null;
    }
  }, [loadFirst]);

  const refresh = useCallback(async () => {
    await loadFirst(thread ? "refresh" : "initial");
  }, [loadFirst, thread]);

  const loadMore = useCallback(async () => {
    if (!thread || loadingMore || refreshing) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await window.remote.openSourceThread({ page: thread.page + 1 });
      setThread((current) => (current ? mergeThread(current, next) : next));
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLoadingMore(false);
    }
  }, [thread, loadingMore, refreshing]);

  const submit = useCallback(
    async (body: string, parentCommentId?: string) => {
      if (submitting) return false;
      setSubmitting(true);
      setError(null);
      setNotice(null);
      try {
        const next = await window.remote.openSourceSubmit({
          body,
          ...(parentCommentId ? { parentCommentId } : {}),
        });
        setThread(next);
        loadedRef.current = true;
        setNotice(parentCommentId ? t("回复已发布到若道。") : t("评论已发布，若道社区页同步显示。"));
        return true;
      } catch (err) {
        setError(cleanError(err));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting],
  );

  const remove = useCallback(
    async (commentId: string) => {
      if (deletingId) return false;
      setDeletingId(commentId);
      setError(null);
      setNotice(null);
      try {
        const next = await window.remote.openSourceDelete({ commentId });
        setThread(next);
        setNotice(t("评论已删除。"));
        return true;
      } catch (err) {
        setError(cleanError(err));
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  const open = useCallback(async (target: OpenSourceOpenTarget) => {
    try {
      await window.remote.openSourceOpen({ target });
    } catch (err) {
      setError(cleanError(err));
    }
  }, []);

  const openUrl = useCallback(async (url: string) => {
    try {
      await window.remote.openSourceOpen({ url });
    } catch (err) {
      setError(cleanError(err));
    }
  }, []);

  return {
    thread,
    loading,
    refreshing,
    loadingMore,
    submitting,
    deletingId,
    error,
    notice,
    ensureLoaded,
    refresh,
    loadMore,
    submit,
    remove,
    open,
    openUrl,
  };
}
