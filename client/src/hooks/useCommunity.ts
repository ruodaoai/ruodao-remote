import { useCallback, useEffect, useRef, useState } from "react";
import type { CommunityReview, CommunityThread } from "../types";

export interface CommunityController {
  thread: CommunityThread | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  submitting: boolean;
  deletingId: string | null;
  helpfulId: string | null;
  error: string | null;
  notice: string | null;
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  submit: (rating: number, content: string) => Promise<boolean>;
  remove: (reviewId: string) => Promise<boolean>;
  markHelpful: (review: CommunityReview) => Promise<void>;
  openApp: () => Promise<void>;
  openMarket: () => Promise<void>;
  clearNotice: () => void;
}

function cleanCommunityError(error: unknown): string {
  if (!(error instanceof Error)) return "社区留言暂时不可用，请稍后再试。";
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")
    .trim();
}

function mergeThread(current: CommunityThread, next: CommunityThread): CommunityThread {
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

export function useCommunity(): CommunityController {
  const [thread, setThread] = useState<CommunityThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [helpfulId, setHelpfulId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const pendingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadFirst = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await window.remote.communityThread({ page: 1 });
      setThread(next);
      loadedRef.current = true;
    } catch (err) {
      setError(cleanCommunityError(err));
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
      const next = await window.remote.communityThread({ page: thread.page + 1 });
      setThread((current) => (current ? mergeThread(current, next) : next));
    } catch (err) {
      setError(cleanCommunityError(err));
    } finally {
      setLoadingMore(false);
    }
  }, [thread, loadingMore, refreshing]);

  const submit = useCallback(
    async (rating: number, content: string) => {
      if (submitting) return false;
      const wasUpdate = Boolean(thread?.myReview);
      setSubmitting(true);
      setError(null);
      setNotice(null);
      try {
        const next = await window.remote.communitySubmit({ rating, content });
        setThread(next);
        loadedRef.current = true;
        setNotice(wasUpdate ? "留言已更新。" : "留言已发布，感谢你的反馈。");
        return true;
      } catch (err) {
        setError(cleanCommunityError(err));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, thread?.myReview],
  );

  const remove = useCallback(
    async (reviewId: string) => {
      if (deletingId) return false;
      setDeletingId(reviewId);
      setError(null);
      setNotice(null);
      try {
        const next = await window.remote.communityDelete({ reviewId });
        setThread(next);
        setNotice("留言已删除。");
        return true;
      } catch (err) {
        setError(cleanCommunityError(err));
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  const markHelpful = useCallback(
    async (review: CommunityReview) => {
      if (helpfulId) return;
      setHelpfulId(review.id);
      setError(null);
      try {
        const result = await window.remote.communityHelpful({ reviewId: review.id });
        setThread((current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) => {
              if (item.id !== review.id) return item;
              if (result.review) return { ...item, ...result.review };
              const helpful = !item.helpful;
              return {
                ...item,
                helpful,
                helpfulCount: Math.max(0, item.helpfulCount + (helpful ? 1 : -1)),
              };
            }),
          };
        });
      } catch (err) {
        setError(cleanCommunityError(err));
      } finally {
        setHelpfulId(null);
      }
    },
    [helpfulId],
  );

  const openApp = useCallback(async () => {
    try {
      await window.remote.communityOpenApp();
    } catch (err) {
      setError(cleanCommunityError(err));
    }
  }, []);

  const openMarket = useCallback(async () => {
    try {
      await window.remote.communityOpenMarket();
    } catch (err) {
      setError(cleanCommunityError(err));
    }
  }, []);

  return {
    thread,
    loading,
    refreshing,
    loadingMore,
    submitting,
    deletingId,
    helpfulId,
    error,
    notice,
    ensureLoaded,
    refresh,
    loadMore,
    submit,
    remove,
    markHelpful,
    openApp,
    openMarket,
    clearNotice: () => setNotice(null),
  };
}
