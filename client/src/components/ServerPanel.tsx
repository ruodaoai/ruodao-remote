import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessBlock,
  AccessBlockKind,
  AdminActivityEntry,
  AdminDevice,
  AdminDeviceStatus,
  AdminInvite,
  AdminOverview,
  AdminSessionInfo,
  AdminSessionRecord,
  AdminSessionTelemetry,
  AdminStatus,
  AdminTarget,
  AdminUpdateStatus,
  CooldownRecord,
  LocalServerStatus,
  RegistrationMode,
  ServerPolicy,
  Settings,
  ToastKind,
  UpdateStatus,
} from "../types";
import { formatCode } from "../lib/key";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  HashIcon,
  LinkIcon,
  MonitorIcon,
  PowerIcon,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  XIcon,
} from "./icons";
import { CopyButton, HelpTip, InlineAlert, StatusPill } from "./ui";

const REGISTRATION_MODES: Record<RegistrationMode, { label: string; hint: string }> = {
  invite: {
    label: "邀请制",
    hint: "新客户端必须填写邀请码才能接入，适合对外开放使用。",
  },
  approval: {
    label: "审核制",
    hint: "新客户端接入后处于待批准状态，由管理员放行后才能远控。",
  },
  open: {
    label: "开放接入",
    hint: "任何拿到服务器地址的客户端都能直接接入，仅建议在可信内网使用。",
  },
};

const UPDATE_PHASE_LABELS: Record<AdminUpdateStatus["phase"], string> = {
  idle: "未检查",
  checking: "正在检查",
  "up-to-date": "已是最新",
  available: "有新版本",
  downloading: "正在下载",
  ready: "等待安装",
  applying: "正在更新",
  error: "更新失败",
};

function updateTone(phase: AdminUpdateStatus["phase"]): "idle" | "busy" | "online" | "error" {
  if (phase === "error") return "error";
  if (phase === "up-to-date" || phase === "ready") return "online";
  if (phase === "idle") return "idle";
  return "busy";
}

const CLIENT_PHASE_LABELS: Record<UpdateStatus["phase"], string> = {
  idle: "未检查",
  checking: "检查中",
  "up-to-date": "已是最新",
  available: "有新版本",
  downloading: "下载中",
  ready: "待安装",
  installing: "安装中",
  error: "更新失败",
};

function clientUpdateTone(
  phase: UpdateStatus["phase"],
): "idle" | "busy" | "online" | "error" {
  if (phase === "error") return "error";
  if (phase === "up-to-date" || phase === "ready") return "online";
  if (phase === "idle") return "idle";
  return "busy";
}

const ACTIVITY_LABELS: Record<string, string> = {
  "device.registered": "客户端首次接入",
  "device.status": "客户端权限变更",
  "device.status-changed": "客户端权限变更",
  "device.disconnect": "管理员断开客户端",
  "device.remove": "移除客户端记录",
  "device.removed": "移除客户端记录",
  "session.end": "管理员结束会话",
  "invite.create": "创建邀请码",
  "invite.revoke": "撤销邀请码",
  "invite.remove": "删除邀请码",
  "settings.update": "更新服务端设置",
  "admin.login": "管理员登录",
  "admin.login-failed": "管理员登录失败",
  "admin.login-locked": "管理员登录已临时锁定",
  "access.block": "拉黑设备或 IP",
  "access.freeze": "冻结设备或 IP",
  "access.unblock": "解除拉黑或冻结",
  "access.denied": "拦截受限用户",
  "cooldown.clear": "解除冷却限制",
  "session.time-limit": "会话达到时长上限",
};

const DEFAULT_POLICY: ServerPolicy = {
  maxSessions: 0,
  sessionLimitMinutes: 0,
  cooldownMinutes: 5,
  freezeMinutes: 10,
};

type ServerTab =
  | "overview"
  | "devices"
  | "invites"
  | "sessions"
  | "history"
  | "risk"
  | "activity"
  | "settings";

interface ServerPanelProps {
  settings: Settings;
  clientVersion: string | null;
  clientUpdate: UpdateStatus | null;
  notify: (message: string, kind?: ToastKind) => void;
  onApplyInvite: (code: string) => Promise<void>;
  onUseServer: (url: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenDeploy: () => void;
  onOpenGuide: () => void;
  onAskAi: () => void;
  onOpenClientUpdate: () => void;
}

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return "操作失败，请稍后再试。";
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

function formatInvite(code: string): string {
  const normalized = code.replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== 8) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAgo(timestamp: number | null): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 0) return "—";
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86_400)} 天 ${Math.floor((seconds % 86_400) / 3600)} 小时`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

function formatRate(kbps: number | undefined): string {
  if (!kbps || kbps <= 0) return "0 Kbps";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} Kbps`;
}

type RiskTone = "idle" | "busy" | "online" | "error";

const RISK_ORDER: Record<RiskTone, number> = { idle: 0, online: 1, busy: 2, error: 3 };

function sessionRisk(telemetry: AdminSessionTelemetry | null | undefined): {
  tone: RiskTone;
  label: string;
} {
  if (!telemetry) return { tone: "idle", label: "等待指标" };
  if (telemetry.rttMs >= 250 || telemetry.lossPct >= 3 || telemetry.jitterMs >= 60) {
    return { tone: "error", label: "可能卡顿" };
  }
  if (telemetry.rttMs >= 120 || telemetry.lossPct >= 1 || telemetry.jitterMs >= 30) {
    return { tone: "busy", label: "轻微延迟" };
  }
  return { tone: "online", label: "流畅" };
}

function closeReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    "controller-left": "控制方离开",
    "host-left": "被控端离开",
    "host-closed": "被控端关闭连接",
    "host-offline": "被控端离线",
    "admin-disconnect": "管理员结束",
    "key-rotated": "密钥已轮换",
    unpublished: "停止共享",
    timeout: "连接超时",
    "time-limit": "达到单次时长上限",
    blocked: "被管理员拉黑",
    frozen: "被管理员冻结",
  };
  return labels[reason] ?? reason;
}

function remoteMinutes(value: number): string {
  return value > 0 ? `${value} 分钟` : "不限";
}

function remainingLabel(until: number): string {
  const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function capacityLabel(stats: {
  sessions: number;
  maxSessions?: number;
  remainingSlots?: number | null;
}): {
  current: number;
  label: string;
  hint: string;
  full: boolean;
  remaining: number | null;
} {
  const current = stats.sessions;
  const max = stats.maxSessions ?? 0;
  const remaining = stats.remainingSlots ?? (max > 0 ? Math.max(0, max - current) : null);
  if (max <= 0) {
    return {
      current,
      label: "不限人数",
      hint: "未设置并发上限，按带宽与性能评估可接入人数",
      full: false,
      remaining: null,
    };
  }
  return {
    current,
    label: `${current} / ${max}`,
    hint:
      remaining !== null && remaining > 0
        ? `还可再开启 ${remaining} 路远控，约 ${remaining} 个用户`
        : "席位已满，新用户需等待他人结束",
    full: remaining !== null && remaining <= 0,
    remaining,
  };
}

function platformLabel(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return "未知";
}

function deviceStatusLabel(status: AdminDeviceStatus): { tone: "idle" | "busy" | "online" | "error"; label: string } {
  if (status === "approved") return { tone: "online", label: "已允许" };
  if (status === "pending") return { tone: "busy", label: "待批准" };
  return { tone: "error", label: "已禁止" };
}

function modeLabel(mode: RegistrationMode | undefined): string {
  if (!mode) return "未知";
  return REGISTRATION_MODES[mode]?.label ?? mode;
}

function parseOverview(data: unknown): AdminOverview | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const server = record.server;
  const stats = record.stats;
  if (typeof server !== "object" || server === null) return null;
  if (typeof stats !== "object" || stats === null) return null;
  const network = typeof record.network === "object" && record.network !== null
    ? (record.network as AdminOverview["network"])
    : null;
  const security = typeof record.security === "object" && record.security !== null
    ? (record.security as AdminOverview["security"])
    : undefined;
  return { server, stats, network, security } as AdminOverview;
}

function parseList<T>(data: unknown, key: string): T[] {
  if (typeof data !== "object" || data === null) return [];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function parsePolicy(data: unknown): ServerPolicy | null {
  if (typeof data !== "object" || data === null) return null;
  const record = (data as Record<string, unknown>).policy;
  if (typeof record !== "object" || record === null) return null;
  const value = record as Record<string, unknown>;
  const read = (key: keyof ServerPolicy, fallback: number): number => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
  };
  return {
    maxSessions: read("maxSessions", 0),
    sessionLimitMinutes: read("sessionLimitMinutes", 0),
    cooldownMinutes: read("cooldownMinutes", 5),
    freezeMinutes: Math.max(1, read("freezeMinutes", 10)),
  };
}

function parseBlocks(data: unknown): AccessBlock[] {
  return parseList<AccessBlock>(data, "blocks").filter(
    (block) => block && (block.kind === "device" || block.kind === "ip") && block.value,
  );
}

export function ServerPanel({
  settings,
  clientVersion,
  clientUpdate,
  notify,
  onApplyInvite,
  onUseServer,
  onOpenSettings,
  onOpenDeploy,
  onOpenGuide,
  onAskAi,
  onOpenClientUpdate,
}: ServerPanelProps) {
  const [target, setTarget] = useState<AdminTarget>("remote");
  const [status, setStatusState] = useState<AdminStatus | null>(null);
  const [local, setLocal] = useState<LocalServerStatus | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localPassword, setLocalPassword] = useState<string | null>(null);
  const localRef = useRef<LocalServerStatus | null>(null);
  const scopeInitialized = useRef(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [sessions, setSessions] = useState<AdminSessionInfo[]>([]);
  const [history, setHistory] = useState<AdminSessionRecord[]>([]);
  const [activity, setActivity] = useState<AdminActivityEntry[]>([]);
  const [tab, setTab] = useState<ServerTab>("overview");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "online" | "pending" | "blocked">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("0");
  const [inviteDays, setInviteDays] = useState("0");
  const [createdInvite, setCreatedInvite] = useState<AdminInvite | null>(null);
  const [serverName, setServerName] = useState("");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("invite");
  const [serverUpdate, setServerUpdate] = useState<AdminUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState<"check" | "download" | "apply" | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [policy, setPolicy] = useState<ServerPolicy>(DEFAULT_POLICY);
  const [maxSessionsInput, setMaxSessionsInput] = useState("0");
  const [limitInput, setLimitInput] = useState("0");
  const [cooldownInput, setCooldownInput] = useState("5");
  const [freezeInput, setFreezeInput] = useState("10");
  const [blocks, setBlocks] = useState<AccessBlock[]>([]);
  const [cooldowns, setCooldowns] = useState<CooldownRecord[]>([]);
  const [blockKind, setBlockKind] = useState<AccessBlockKind>("device");
  const [blockValue, setBlockValue] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockPermanent, setBlockPermanent] = useState(false);
  const [blockMinutes, setBlockMinutes] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const policyRef = useRef<ServerPolicy>(DEFAULT_POLICY);

  const adoptPolicy = useCallback((next: ServerPolicy) => {
    const prev = policyRef.current;
    const changed =
      prev.maxSessions !== next.maxSessions ||
      prev.sessionLimitMinutes !== next.sessionLimitMinutes ||
      prev.cooldownMinutes !== next.cooldownMinutes ||
      prev.freezeMinutes !== next.freezeMinutes;
    if (!changed) return;
    policyRef.current = next;
    setPolicy(next);
    setMaxSessionsInput(String(next.maxSessions));
    setLimitInput(String(next.sessionLimitMinutes));
    setCooldownInput(String(next.cooldownMinutes));
    setFreezeInput(String(next.freezeMinutes));
  }, []);

  const sessionActive =
    Boolean(status?.session) && !(target === "local" && local !== null && !local.running);

  const networkRisk = useMemo<{ tone: RiskTone; label: string }>(() => {
    if (sessions.length === 0) return { tone: "idle", label: "当前无人远控" };
    let worst: RiskTone = "online";
    for (const session of sessions) {
      const risk = sessionRisk(session.telemetry);
      if (RISK_ORDER[risk.tone] > RISK_ORDER[worst]) worst = risk.tone;
    }
    if (worst === "error") return { tone: "error", label: "有会话可能卡顿" };
    if (worst === "busy") return { tone: "busy", label: "轻微延迟" };
    return { tone: "online", label: "远控流畅" };
  }, [sessions]);

  const clientPhase = clientUpdate?.phase ?? "idle";
  const serverUpdateSupported = serverUpdate?.supported ?? false;
  const serverVersion = overview?.server.version ?? serverUpdate?.currentVersion ?? null;
  const serverUpdateSummary = !serverUpdate
    ? "正在读取更新状态"
    : !serverUpdate.supported
      ? target === "local"
        ? "本机服务端随客户端一起升级"
        : serverUpdate.reason ?? "当前部署未启用更新"
      : serverUpdate.systemUpdater
        ? "系统级自动更新 · 无远控会话时安装，失败自动回滚"
        : serverUpdate.applyMode === "auto"
          ? "自动下载并安装"
          : "有新版本时可下载并手动安装";

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [
        overviewResult,
        devicesResult,
        invitesResult,
        sessionsResult,
        historyResult,
        activityResult,
        riskResult,
      ] = await Promise.all([
        window.remote.adminRequest({ target, path: "/api/admin/overview" }),
        window.remote.adminRequest({ target, path: "/api/admin/devices" }),
        window.remote.adminRequest({ target, path: "/api/admin/invites" }),
        window.remote.adminRequest({ target, path: "/api/admin/sessions" }),
        window.remote.adminRequest({ target, path: "/api/admin/sessions/history?limit=80" }),
        window.remote.adminRequest({ target, path: "/api/admin/activity?limit=80" }),
        window.remote.adminRequest({ target, path: "/api/admin/blocks" }),
      ]);

      if (overviewResult.status === 401) {
        setOverview(null);
        setDevices([]);
        setInvites([]);
        setSessions([]);
        setHistory([]);
        setActivity([]);
        setBlocks([]);
        setCooldowns([]);
        setStatusState((prev) =>
          prev ? { ...prev, session: false } : prev,
        );
        return;
      }

      if (!overviewResult.ok) {
        setError(overviewResult.error ?? "无法读取服务端状态");
        return;
      }

      const nextOverview = parseOverview(overviewResult.data);
      if (nextOverview) {
        setOverview(nextOverview);
        setServerName(nextOverview.server.name);
        setRegistrationMode(nextOverview.server.registrationMode);
      }
      setDevices(parseList<AdminDevice>(devicesResult.data, "devices"));
      setInvites(parseList<AdminInvite>(invitesResult.data, "invites"));
      setSessions(parseList<AdminSessionInfo>(sessionsResult.data, "sessions"));
      setHistory(parseList<AdminSessionRecord>(historyResult.data, "sessions"));
      setActivity(parseList<AdminActivityEntry>(activityResult.data, "entries"));
      setBlocks(parseBlocks(riskResult.data));
      setCooldowns(parseList<CooldownRecord>(riskResult.data, "cooldowns"));
      const remotePolicy = parsePolicy(riskResult.data) ?? parsePolicy(overviewResult.data);
      if (remotePolicy) adoptPolicy(remotePolicy);
      setStatusState((prev) =>
        prev ? { ...prev, session: true, configured: true } : prev,
      );
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setRefreshing(false);
    }
  }, [target, adoptPolicy]);

  const loadServerUpdate = useCallback(async () => {
    try {
      const result = await window.remote.adminRequest({ target, path: "/api/admin/update" });
      if (!result.ok) return;
      const data = result.data as { update?: AdminUpdateStatus } | null;
      if (data?.update) setServerUpdate(data.update);
    } catch {
      // 旧版服务端没有更新接口时保持静默。
    }
  }, [target]);

  const runServerUpdate = useCallback(
    async (action: "check" | "download" | "apply") => {
      setUpdateBusy(action);
      setUpdateMessage(null);
      try {
        const result = await window.remote.adminRequest({
          target,
          method: "POST",
          path: `/api/admin/update/${action}`,
        });
        const data = result.data as
          | { update?: AdminUpdateStatus; result?: { message?: string } }
          | null;
        if (data?.update) setServerUpdate(data.update);
        if (!result.ok) {
          setUpdateMessage(result.error ?? "更新操作失败");
          return;
        }
        setUpdateMessage(
          data?.result?.message ??
            (action === "check"
              ? "已检查更新"
              : action === "download"
                ? "更新包已下载并校验"
                : "已提交更新，服务端将在几秒内重启"),
        );
      } catch (error) {
        setUpdateMessage(cleanError(error));
      } finally {
        setUpdateBusy(null);
      }
    },
    [target],
  );

  useEffect(() => {
    setServerUpdate(null);
    setUpdateMessage(null);
    policyRef.current = DEFAULT_POLICY;
    setPolicy(DEFAULT_POLICY);
    setMaxSessionsInput("0");
    setLimitInput("0");
    setCooldownInput("5");
    setFreezeInput("10");
    setBlocks([]);
    setCooldowns([]);
  }, [target]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOverview(null);
    setDevices([]);
    setInvites([]);
    setSessions([]);
    setActivity([]);
    (async () => {
      try {
        const next = await window.remote.adminStatus(target);
        if (cancelled) return;
        setStatusState(next);
        if (target === "local" && !localRef.current?.running) return;
        if (next.configured || next.session) await refresh(true);
      } catch (err) {
        if (!cancelled) setError(cleanError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, refresh]);

  useEffect(() => {
    if (!sessionActive) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [sessionActive, refresh]);

  useEffect(() => {
    if (!sessionActive) return;
    if (tab !== "settings" && tab !== "overview") return;
    void loadServerUpdate();
  }, [tab, sessionActive, loadServerUpdate]);

  const lastServerUrl = useRef(settings.serverUrl);
  useEffect(() => {
    const previous = lastServerUrl.current;
    lastServerUrl.current = settings.serverUrl;
    if (previous === settings.serverUrl || target !== "remote") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOverview(null);
    setDevices([]);
    setInvites([]);
    setSessions([]);
    setHistory([]);
    setActivity([]);
    (async () => {
      try {
        const next = await window.remote.adminStatus("remote");
        if (cancelled) return;
        setStatusState(next);
        if (next.configured || next.session) await refresh(true);
        setTab("overview");
      } catch (err) {
        if (!cancelled) setError(cleanError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.serverUrl, target, refresh]);

  useEffect(() => {
    localRef.current = local;
  }, [local]);

  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const next = await window.remote.localServerStatus();
        if (cancelled) return;
        localRef.current = next;
        setLocal(next);
      } catch {
        // The main process is shutting down; keep the last known status.
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const localRunning = local?.running ?? false;

  useEffect(() => {
    if (target !== "local" || !localRunning) return;
    void refresh(true);
  }, [target, localRunning, refresh]);

  useEffect(() => {
    if (scopeInitialized.current) return;
    if (!local || !status) return;
    scopeInitialized.current = true;
    if (local.running && !status.configured && !status.session) setTarget("local");
  }, [local, status]);

  async function submitLogin(): Promise<void> {
    if (loggingIn) return;
    if (!password.trim()) {
      setError("请输入管理员密码");
      return;
    }
    setLoggingIn(true);
    setError(null);
    try {
      await window.remote.adminLogin({
        target,
        password: password.trim(),
        remember,
      });
      setPassword("");
      const next = await window.remote.adminStatus(target);
      setStatusState(next);
      await refresh(true);
      notify("已登录服务端管理", "success");
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout(): Promise<void> {
    setBusyKey("logout");
    try {
      await window.remote.adminLogout({ target, forget: false });
      setStatusState((prev) => (prev ? { ...prev, session: false } : prev));
      setOverview(null);
      setDevices([]);
      setInvites([]);
      setSessions([]);
      setActivity([]);
      setError(null);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function openConsole(): Promise<void> {
    setBusyKey("console");
    try {
      const result = await window.remote.openAdminConsole(target);
      if (!result.ok) setError(result.error ?? "无法打开网页管理后台");
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function runAction(
    key: string,
    input: {
      method: "POST" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
    },
    successMessage: string,
  ): Promise<void> {
    setBusyKey(key);
    setError(null);
    try {
      const result = await window.remote.adminRequest({ target, ...input });
      if (!result.ok) {
        setError(result.error ?? "操作失败，请稍后再试。");
        return;
      }
      notify(successMessage, "success");
      await refresh(true);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function createInvite(): Promise<void> {
    setBusyKey("invite-create");
    setError(null);
    try {
      const result = await window.remote.adminRequest({
        target,
        method: "POST",
        path: "/api/admin/invites",
        body: {
          label: inviteLabel.trim() || "未命名邀请码",
          maxUses: Number(inviteMaxUses) || 0,
          expiresInDays: Number(inviteDays) || 0,
        },
      });
      if (!result.ok) {
        setError(result.error ?? "创建邀请码失败");
        return;
      }
      const invite =
        typeof result.data === "object" && result.data !== null
          ? (result.data as { invite?: AdminInvite }).invite
          : undefined;
      setCreatedInvite(invite ?? null);
      setInviteLabel("");
      notify("邀请码已创建", "success");
      await refresh(true);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function saveServerSettings(): Promise<void> {
    setBusyKey("settings-save");
    setError(null);
    try {
      const result = await window.remote.adminRequest({
        target,
        method: "PATCH",
        path: "/api/admin/settings",
        body: {
          registrationMode,
          serverName: serverName.trim(),
        },
      });
      if (!result.ok) {
        setError(result.error ?? "保存服务端设置失败");
        return;
      }
      notify("服务端设置已保存", "success");
      await refresh(true);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function savePolicy(): Promise<void> {
    setBusyKey("policy-save");
    setError(null);
    try {
      const result = await window.remote.adminRequest({
        target,
        method: "PATCH",
        path: "/api/admin/settings",
        body: {
          policy: {
            maxSessions: Number(maxSessionsInput) || 0,
            sessionLimitMinutes: Number(limitInput) || 0,
            cooldownMinutes: Number(cooldownInput) || 0,
            freezeMinutes: Number(freezeInput) || 10,
          },
        },
      });
      if (!result.ok) {
        setError(result.error ?? "保存风控策略失败");
        return;
      }
      const data = result.data as { policy?: ServerPolicy } | null;
      if (data?.policy) {
        policyRef.current = data.policy;
        setPolicy(data.policy);
        setMaxSessionsInput(String(data.policy.maxSessions));
        setLimitInput(String(data.policy.sessionLimitMinutes));
        setCooldownInput(String(data.policy.cooldownMinutes));
        setFreezeInput(String(data.policy.freezeMinutes));
      }
      notify("风控策略已生效", "success");
      await refresh(true);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function createBlock(): Promise<void> {
    const value = blockValue.trim();
    if (!value) {
      setError(blockKind === "device" ? "请填写设备 ID。" : "请填写 IP 地址。");
      return;
    }
    setBusyKey("block-create");
    setError(null);
    try {
      const result = await window.remote.adminRequest({
        target,
        method: "POST",
        path: "/api/admin/blocks",
        body: {
          kind: blockKind,
          value,
          label: blockLabel.trim() || value,
          permanent: blockPermanent,
          minutes: Number(blockMinutes) || policy.freezeMinutes,
          reason:
            blockReason.trim() ||
            (blockPermanent ? "管理员拉黑" : `管理员冻结 ${Number(blockMinutes) || policy.freezeMinutes} 分钟`),
        },
      });
      if (!result.ok) {
        setError(result.error ?? "提交拉黑或冻结失败");
        return;
      }
      setBlockValue("");
      setBlockLabel("");
      setBlockReason("");
      notify(blockPermanent ? "已拉黑该对象" : "已冻结该对象", "success");
      await refresh(true);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function quickFreeze(device: AdminDevice): Promise<void> {
    if (
      !window.confirm(
        `冻结“${device.name}”${policy.freezeMinutes} 分钟？期间该设备无法登录，正在进行的远控会被断开。`,
      )
    ) {
      return;
    }
    await runAction(
      `device-${device.id}`,
      {
        method: "POST",
        path: "/api/admin/blocks",
        body: {
          kind: "device",
          value: device.id,
          label: device.name,
          minutes: policy.freezeMinutes,
          reason: `管理员冻结 ${policy.freezeMinutes} 分钟`,
        },
      },
      `已冻结“${device.name}”${policy.freezeMinutes} 分钟`,
    );
  }

  async function startLocal(): Promise<void> {
    if (localBusy) return;
    setLocalBusy(true);
    setError(null);
    try {
      const next = await window.remote.startLocalServer();
      localRef.current = next;
      setLocal(next);
      if (!next.running) {
        if (next.error) setError(next.error);
        return;
      }
      await window.remote.updateSettings({ localServerEnabled: true });
      setTarget("local");
      notify("本机服务端已启动，正在打开管理面板", "success");
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLocalBusy(false);
    }
  }

  async function stopLocal(): Promise<void> {
    if (localBusy) return;
    if (!window.confirm("停止本机服务端？正在使用它的客户端会断开连接。")) return;
    setLocalBusy(true);
    setError(null);
    try {
      const next = await window.remote.stopLocalServer();
      localRef.current = next;
      setLocal(next);
      setLocalPassword(null);
      setStatusState((prev) => (prev ? { ...prev, session: false } : prev));
      setOverview(null);
      setDevices([]);
      setInvites([]);
      setSessions([]);
      setActivity([]);
      await window.remote.updateSettings({ localServerEnabled: false });
      notify("本机服务端已停止", "info");
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLocalBusy(false);
    }
  }

  async function toggleLocalPassword(): Promise<void> {
    if (localPassword) {
      setLocalPassword(null);
      return;
    }
    try {
      const result = await window.remote.localServerPassword();
      setLocalPassword(result.password);
    } catch (err) {
      setError(cleanError(err));
    }
  }

  async function useLocalServer(): Promise<void> {
    if (!local?.running) return;
    try {
      await onUseServer(local.url);
    } catch (err) {
      setError(cleanError(err));
    }
  }

  const ownDevice = useMemo(
    () => devices.find((device) => device.id === settings.deviceId) ?? null,
    [devices, settings.deviceId],
  );

  const visibleDevices = useMemo(() => {
    if (deviceFilter === "all") return devices;
    if (deviceFilter === "online") return devices.filter((device) => device.online);
    return devices.filter((device) => device.status === deviceFilter);
  }, [devices, deviceFilter]);

  const pendingCount = devices.filter((device) => device.status === "pending").length;
  const activeInviteCount = invites.filter((invite) => invite.active).length;
  const capacity = capacityLabel({
    sessions: sessions.length,
    maxSessions: policy.maxSessions,
    remainingSlots: overview?.stats.remainingSlots ?? null,
  });
  const sessionKbps = overview?.stats.sessionKbps ?? 0;
  const statusTone: "idle" | "busy" | "online" | "error" = sessionActive
    ? "online"
    : target === "local"
      ? localRunning || local?.starting
        ? "busy"
        : "idle"
      : status?.configured
        ? "busy"
        : "idle";
  const statusLabel = sessionActive
    ? "管理已连接"
    : target === "local"
      ? local?.starting
        ? "正在启动本机服务"
        : localRunning
          ? "本机服务运行中"
          : "本机服务未启动"
      : status?.configured
        ? "需要登录"
        : "未配置管理员";

  return (
    <section className="panel server-panel" data-testid="server-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-icon">
              <ServerIcon size={14} />
            </span>
            服务端
          </span>
          <h1>把远控服务分享给别人</h1>
          <p>
            管理在线客户端、邀请码与远程会话。管理员密码只保存在这台电脑的加密存储中。
          </p>
        </div>
        <StatusPill tone={statusTone} label={statusLabel} />
      </div>

      <HelpTip
        title="第一次提供服务？"
        onOpenGuide={onOpenGuide}
        onAskAi={onAskAi}
      >
        先部署云服务器或启动本机服务端，再在“邀请码”页生成邀请码发给朋友；对方填写服务器地址和邀请码后即可接入。
      </HelpTip>

      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="server-scope" role="tablist" aria-label="管理对象">
        <button
          type="button"
          role="tab"
          aria-selected={target === "remote"}
          className={`scope-option${target === "remote" ? " active" : ""}`}
          onClick={() => setTarget("remote")}
        >
          <span className="scope-option-mark">
            <ShieldIcon size={16} />
          </span>
          <span className="scope-option-copy">
            <strong>远程服务端</strong>
            <small>{settings.serverUrl}</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={target === "local"}
          className={`scope-option${target === "local" ? " active" : ""}`}
          onClick={() => setTarget("local")}
        >
          <span className="scope-option-mark">
            <ServerIcon size={16} />
          </span>
          <span className="scope-option-copy">
            <strong>本机服务端</strong>
            <small>
              {local?.running
                ? local.url
                : local?.starting
                  ? "正在启动…"
                  : "尚未启动，可一键开启"}
            </small>
          </span>
          {local?.running && <span className="scope-live" />}
        </button>
      </div>

      {target === "local" && local !== null && !local.running ? (
        <div className="local-setup">
          <div className="server-login-copy">
            <span className="server-kicker">
              <ServerIcon size={15} /> 一键本机服务
            </span>
            <h2>在这台电脑上运行服务端</h2>
            <p>
              无需购买服务器。启动后，这台电脑就是若道远程的信令服务器，局域网设备可以直接使用远控码连接；需要公网使用时，可在设置中填写端口映射或反向代理后的地址。
            </p>
            <div className="server-login-facts">
              <span>
                <ShieldIcon size={14} /> 管理员密码自动生成并加密保存在本机
              </span>
              <span>
                <MonitorIcon size={14} /> 客户端数据保存在本机，随时可以停止
              </span>
              <span>
                <ServerIcon size={14} /> 默认端口 {settings.localServerPort}，可在设置中修改
              </span>
            </div>
            <button type="button" className="text-button" onClick={onOpenSettings}>
              修改端口与公网地址
            </button>
          </div>
          <div className="server-login-card local-setup-card">
            <span className="server-kicker">
              <PowerIcon size={15} /> 一键启动
            </span>
            <h3>准备好了吗？</h3>
            <p className="tiny-note">
              启动后会自动打开本机管理面板。局域网内默认可直接接入；对外分享前，建议先切换为邀请制或审核制。
            </p>
            {local.error && <InlineAlert>{local.error}</InlineAlert>}
            <button
              type="button"
              className="button primary wide"
              disabled={localBusy || local.starting}
              onClick={() => void startLocal()}
            >
              {localBusy || local.starting ? (
                <span className="spinner" />
              ) : (
                <PowerIcon size={16} />
              )}
              {local.starting ? "正在启动本机服务端…" : "启动本机服务端"}
            </button>
            <p className="server-login-hint">首次启动通常 1-2 秒完成，无需安装任何额外软件。</p>
          </div>
        </div>
      ) : loading ? (
        <div className="server-center">
          <span className="spinner large" />
          <p>正在读取服务端状态…</p>
        </div>
      ) : !status ? (
        <div className="server-center">
          <AlertIcon size={26} />
          <h2>无法读取服务端状态</h2>
          <p>请确认服务器地址正确，并在设置中检查网络连接。</p>
          <button type="button" className="button primary" onClick={() => void refresh(true)}>
            重试
          </button>
        </div>
      ) : !sessionActive && target === "local" ? (
        <div className="server-login-layout">
          <div className="server-login-copy">
            <span className="server-kicker">
              <ServerIcon size={15} /> 本机管理
            </span>
            <h2>连接 {local?.url ?? status.serverUrl}</h2>
            <p>
              本机服务端正在运行，管理员密码已保存在本机加密存储中，正常情况下会自动登录。若一直停在这里，可以停止后重新启动本机服务端。
            </p>
            <div className="server-login-facts">
              <span>
                <ShieldIcon size={14} /> 管理员密码只在本机使用
              </span>
              <span>
                <ServerIcon size={14} /> 端口 {local?.port ?? settings.localServerPort}
              </span>
            </div>
          </div>
          <div className="server-login-card">
            <button
              type="button"
              className="button primary wide"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? <span className="spinner" /> : <RefreshIcon size={16} />}
              重新登录本机管理
            </button>
            <button
              type="button"
              className="button ghost wide"
              disabled={localBusy}
              onClick={() => void stopLocal()}
            >
              <PowerIcon size={16} /> 停止本机服务端
            </button>
            <p className="server-login-hint">
              管理员密码可在本机服务端运行后，通过面板上的“显示”按钮查看。
            </p>
          </div>
        </div>
      ) : !sessionActive ? (
        <div className="server-login-layout">
          <div className="server-login-copy">
            <span className="server-kicker">
              <ShieldIcon size={15} /> 管理员接入
            </span>
            <h2>登录 {status.serverUrl}</h2>
            <p>
              输入部署时设置的管理员密码。密码会使用系统加密存储保存在本机，仅用于向这台服务器获取管理令牌。
            </p>
            <div className="server-login-facts">
              <span>
                <ShieldIcon size={14} /> 管理员密码不会发送给其他客户端
              </span>
              <span>
                <ServerIcon size={14} /> 支持邀请制、审核制与开放接入
              </span>
            </div>
            <button type="button" className="text-button" onClick={onOpenSettings}>
              修改服务器地址
            </button>
          </div>

          <form
            className="server-login-card"
            onSubmit={(event) => {
              event.preventDefault();
              void submitLogin();
            }}
          >
            <label className="field">
              <div className="field-label">
                <span>管理员密码</span>
                <span className="field-hint">ADMIN_PASSWORD</span>
              </div>
              <div className="input-shell">
                <ShieldIcon size={17} />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入管理员密码"
                  autoComplete="current-password"
                  maxLength={256}
                />
              </div>
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>在本机记住密码，下次自动登录</span>
            </label>
            <button type="submit" className="button primary wide" disabled={loggingIn}>
              {loggingIn ? <span className="spinner" /> : <ShieldIcon size={16} />}
              {loggingIn ? "正在登录…" : "登录并管理"}
            </button>
            {status.configured && (
              <p className="server-login-hint">
                已保存过密码，但自动登录未成功。请确认服务器正在运行。
              </p>
            )}
            <div className="server-deploy-entry">
              <div>
                <strong>还没有服务器？</strong>
                <span>在 Linux 云服务器上一键安装，自动配置 HTTPS 与 TURN 中转。</span>
              </div>
              <button type="button" className="button ghost small" onClick={onOpenDeploy}>
                <ServerIcon size={15} />
                一键部署新服务器
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {target === "local" && local && (
            <div className="local-status-card">
              <div className="local-status-head">
                <span className="online-dot on" />
                <strong>本机服务端运行中</strong>
                <span className="local-port">端口 {local.port}</span>
                <div className="local-status-actions">
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => void useLocalServer()}
                  >
                    设为我的服务器
                  </button>
                  <button
                    type="button"
                    className="mini-button danger"
                    disabled={localBusy}
                    onClick={() => void stopLocal()}
                  >
                    停止
                  </button>
                </div>
              </div>
              <div className="local-address-grid">
                <div className="local-address">
                  <span>本机地址</span>
                  <code>{local.url}</code>
                  <CopyButton value={local.url} label="复制本机地址" />
                </div>
                {local.publicUrl && (
                  <div className="local-address highlight">
                    <span>公网地址</span>
                    <code>{local.publicUrl}</code>
                    <CopyButton value={local.publicUrl} label="复制公网地址" />
                  </div>
                )}
                {local.lanUrls.length > 0 && (
                  <div className="local-address">
                    <span>局域网</span>
                    <code>{local.lanUrls.join("　")}</code>
                    <CopyButton value={local.lanUrls[0]} label="复制局域网地址" />
                  </div>
                )}
                <div className="local-address">
                  <span>管理员密码</span>
                  <code className={localPassword ? "revealed" : undefined}>
                    {localPassword ?? "••••••••（已加密保存）"}
                  </code>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void toggleLocalPassword()}
                  >
                    {localPassword ? "隐藏" : "显示"}
                  </button>
                  {localPassword && (
                    <CopyButton value={localPassword} label="复制管理员密码" />
                  )}
                </div>
              </div>
              <p className="server-note">
                把本机、局域网或公网地址告诉对方，他们填写服务器地址、邀请码和远控码即可连接。对外开放前，建议在“服务端设置”中切换为邀请制或审核制。
              </p>
            </div>
          )}
          <div className="server-toolbar">
            <div className="server-identity">
              <span className="server-identity-mark">
                <ServerIcon size={18} />
              </span>
              <div>
                <strong>{overview?.server.name ?? "若道远程服务"}</strong>
                <span>
                  {overview?.server.publicUrl || status.serverUrl}
                  <span className="server-dot" />
                  {modeLabel(overview?.server.registrationMode)}
                  <span className="server-dot" />
                  v{overview?.server.version ?? "0.1.0"}
                </span>
              </div>
            </div>
            <div className="server-toolbar-actions">
              <button
                type="button"
                className="button ghost small"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? <span className="spinner small" /> : <RefreshIcon size={15} />}
                刷新
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={() => void openConsole()}
                disabled={busyKey === "console"}
              >
                <LinkIcon size={15} />
                网页后台
              </button>
              {target === "remote" && (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => void logout()}
                  disabled={busyKey === "logout"}
                >
                  <XIcon size={15} />
                  退出
                </button>
              )}
            </div>
          </div>

          <nav className="server-tabs" aria-label="服务端管理">
            <button
              type="button"
              className={`server-tab${tab === "overview" ? " active" : ""}`}
              onClick={() => setTab("overview")}
            >
              概览
            </button>
            <button
              type="button"
              className={`server-tab${tab === "devices" ? " active" : ""}`}
              onClick={() => setTab("devices")}
            >
              客户端
              {pendingCount > 0 && <span className="server-tab-badge">{pendingCount}</span>}
            </button>
            <button
              type="button"
              className={`server-tab${tab === "invites" ? " active" : ""}`}
              onClick={() => setTab("invites")}
            >
              邀请码
              {activeInviteCount > 0 && (
                <span className="server-tab-badge soft">{activeInviteCount}</span>
              )}
            </button>
            <button
              type="button"
              className={`server-tab${tab === "sessions" ? " active" : ""}`}
              onClick={() => setTab("sessions")}
            >
              会话
              {sessions.length > 0 && <span className="server-tab-badge">{sessions.length}</span>}
            </button>
            <button
              type="button"
              className={`server-tab${tab === "risk" ? " active" : ""}`}
              onClick={() => setTab("risk")}
            >
              风控
              {blocks.length + cooldowns.length > 0 && (
                <span className="server-tab-badge soft">{blocks.length + cooldowns.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`server-tab${tab === "history" ? " active" : ""}`}
              onClick={() => setTab("history")}
            >
              历史记录
            </button>
            <button
              type="button"
              className={`server-tab${tab === "activity" ? " active" : ""}`}
              onClick={() => setTab("activity")}
            >
              动态
            </button>
            <button
              type="button"
              className={`server-tab${tab === "settings" ? " active" : ""}`}
              onClick={() => setTab("settings")}
            >
              服务端设置
            </button>
            <span className="server-updated">
              {lastUpdated ? `更新于 ${formatAgo(lastUpdated)}` : ""}
            </span>
          </nav>

          {tab === "overview" && (
            <div className="server-tab-body">
              <div className="stat-grid">
                <div className="stat-card accent">
                  <span className="stat-label">在线客户端</span>
                  <strong>{overview?.stats.onlineDevices ?? 0}</strong>
                  <span className="stat-foot">
                    共 {devices.length} 台 · {sessions.length} 个会话
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">待批准</span>
                  <strong>{overview?.stats.pendingDevices ?? 0}</strong>
                  <span className="stat-foot">需要管理员放行的客户端</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">已允许</span>
                  <strong>{overview?.stats.approvedDevices ?? 0}</strong>
                  <span className="stat-foot">可正常发起或被远控</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">有效邀请码</span>
                  <strong>{overview?.stats.activeInvites ?? 0}</strong>
                  <span className="stat-foot">可供新客户端接入</span>
                </div>
                <div className={`stat-card${capacity.full ? " full" : ""}`}>
                  <span className="stat-label">远控席位</span>
                  <strong>{capacity.label}</strong>
                  <span className="stat-foot">{capacity.hint}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">运行时间</span>
                  <strong className="stat-text">
                    {formatUptime(overview?.server.uptimeSeconds)}
                  </strong>
                  <span className="stat-foot">信令服务器已运行</span>
                </div>
              </div>

              <div className="server-card version-card">
                <div className="server-card-head">
                  <DownloadIcon size={17} />
                  <strong>版本与更新</strong>
                  <span className="server-card-aside">
                    更新源 {serverUpdate?.channel ?? "stable"}
                  </span>
                </div>
                <div className="version-grid">
                  <div className="version-item">
                    <div className="version-item-head">
                      <span>客户端</span>
                      <StatusPill
                        tone={clientUpdateTone(clientPhase)}
                        label={CLIENT_PHASE_LABELS[clientPhase]}
                      />
                    </div>
                    <strong>v{clientVersion ?? clientUpdate?.currentVersion ?? "—"}</strong>
                    <small>
                      {clientUpdate?.autoUpdate
                        ? "自动检查并后台下载，退出应用时安装"
                        : "自动更新已关闭，可手动检查"}
                      {clientUpdate?.release &&
                      (clientPhase === "available" || clientPhase === "ready")
                        ? ` · 最新 v${clientUpdate.release.version}`
                        : ""}
                    </small>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={onOpenClientUpdate}
                    >
                      <DownloadIcon size={14} /> 检查客户端更新
                    </button>
                  </div>
                  <div className="version-item">
                    <div className="version-item-head">
                      <span>服务端</span>
                      <StatusPill
                        tone={
                          serverUpdate && !serverUpdateSupported
                            ? "idle"
                            : updateTone(serverUpdate?.phase ?? "idle")
                        }
                        label={
                          serverUpdate
                            ? serverUpdateSupported
                              ? UPDATE_PHASE_LABELS[serverUpdate.phase]
                              : target === "local"
                                ? "随客户端升级"
                                : "未启用更新"
                            : "读取中"
                        }
                      />
                    </div>
                    <strong>{serverVersion ? `v${serverVersion}` : "—"}</strong>
                    <small>{serverUpdateSummary}</small>
                    {target === "remote" && (
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() => setTab("settings")}
                      >
                        <ServerIcon size={14} /> 管理服务端更新
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="server-card">
                <div className="server-card-head">
                  <ServerIcon size={17} />
                  <strong>服务器带宽与负载</strong>
                  <span className="server-card-aside">
                    <StatusPill tone={networkRisk.tone} label={networkRisk.label} />
                  </span>
                </div>
                {overview?.network ? (
                  <div className="network-grid">
                    <div className="network-metric">
                      <span>服务器下行</span>
                      <strong>{formatRate(overview.network.bandwidthInKbps)}</strong>
                      <small>网卡接收 · 全部流量</small>
                    </div>
                    <div className="network-metric">
                      <span>服务器上行</span>
                      <strong>{formatRate(overview.network.bandwidthOutKbps)}</strong>
                      <small>网卡发送 · 全部流量</small>
                    </div>
                    <div className="network-metric">
                      <span>信令下行</span>
                      <strong>{formatRate(overview.network.wsInKbps)}</strong>
                      <small>WebSocket 接收</small>
                    </div>
                    <div className="network-metric">
                      <span>信令上行</span>
                      <strong>{formatRate(overview.network.wsOutKbps)}</strong>
                      <small>WebSocket 发送</small>
                    </div>
                    <div className="network-metric">
                      <span>远控占用码率</span>
                      <strong>{formatRate(sessionKbps)}</strong>
                      <small>{sessions.length} 路会话上报之和</small>
                    </div>
                    <div className="network-metric">
                      <span>剩余远控席位</span>
                      <strong>
                        {capacity.remaining === null ? "不限" : `${capacity.remaining} 路`}
                      </strong>
                      <small>
                        {policy.maxSessions > 0
                          ? `上限 ${policy.maxSessions} 路 · 当前 ${sessions.length} 路`
                          : "可在风控页设置并发上限"}
                      </small>
                    </div>
                    <div className="network-metric">
                      <span>CPU</span>
                      <strong>{overview.network.cpuPct.toFixed(1)}%</strong>
                      <small>服务端进程与系统均值</small>
                    </div>
                    <div className="network-metric">
                      <span>1 分钟负载</span>
                      <strong>{overview.network.load1.toFixed(2)}</strong>
                      <small>Linux load average</small>
                    </div>
                    <div className="network-metric">
                      <span>信令延迟</span>
                      <strong>{overview.network.lagMs.toFixed(1)} ms</strong>
                      <small>事件循环采样</small>
                    </div>
                    <div className="network-metric">
                      <span>内存占用</span>
                      <strong>{overview.network.memoryPct.toFixed(1)}%</strong>
                      <small>{overview.network.memoryMb} MB RSS</small>
                    </div>
                  </div>
                ) : (
                  <p className="server-note">服务端指标采样中，约 5 秒后显示。</p>
                )}
                <p className="server-note">
                  当前 {sessions.length} 人正在远控 · {capacity.hint} · 单次时长{" "}
                  {remoteMinutes(policy.sessionLimitMinutes)} · 到达上限后冷却{" "}
                  {remoteMinutes(policy.cooldownMinutes)}
                  {overview?.security ? ` · 已封禁 IP ${overview.security.activeBans} 个` : ""}
                  {overview?.network && !overview.network.nicSupported
                    ? " · 当前系统未暴露网卡计数，仅信令流量可参考"
                    : ""}
                </p>
              </div>

              <div className="server-columns">
                <div className="server-card">
                  <div className="server-card-head">
                    <MonitorIcon size={17} />
                    <strong>本机接入状态</strong>
                  </div>
                  {ownDevice ? (
                    <>
                      <div className="own-device">
                        <span className={`online-dot${ownDevice.online ? " on" : ""}`} />
                        <div>
                          <strong>{ownDevice.name}</strong>
                          <span>
                            {ownDevice.id.slice(0, 8)} ·{" "}
                            {platformLabel(ownDevice.platform)} · 最近{" "}
                            {formatAgo(ownDevice.lastSeen)}
                          </span>
                        </div>
                        <StatusPill
                          tone={deviceStatusLabel(ownDevice.status).tone}
                          label={deviceStatusLabel(ownDevice.status).label}
                        />
                      </div>
                      {ownDevice.status === "pending" && (
                        <button
                          type="button"
                          className="button primary wide"
                          disabled={busyKey === `device-${ownDevice.id}`}
                          onClick={() =>
                            void runAction(
                              `device-${ownDevice.id}`,
                              {
                                method: "PATCH",
                                path: `/api/admin/devices/${encodeURIComponent(ownDevice.id)}`,
                                body: { status: "approved" },
                              },
                              "已允许本机进行远控",
                            )
                          }
                        >
                          <CheckIcon size={16} /> 允许本机远控
                        </button>
                      )}
                      {ownDevice.status === "blocked" && (
                        <p className="server-note">
                          本机当前被禁止远控。点击“客户端”页可解封。
                        </p>
                      )}
                      {ownDevice.status === "approved" && !settings.inviteCode && (
                        <p className="server-note">
                          服务端开启邀请制时，可先在“邀请码”页生成邀请码并填入本机。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="server-note">
                      还没有看到本机记录。回到“本机被控”页上线一次后，这里会显示接入状态。
                    </p>
                  )}
                </div>

                <div className="server-card">
                  <div className="server-card-head">
                    <ShieldIcon size={17} />
                    <strong>接入方式</strong>
                  </div>
                  <div className="mode-options compact">
                    {(Object.keys(REGISTRATION_MODES) as RegistrationMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`mode-option${
                          overview?.server.registrationMode === mode ? " selected" : ""
                        }`}
                        onClick={() => setTab("settings")}
                      >
                        <span className="mode-option-head">
                          <strong>{REGISTRATION_MODES[mode].label}</strong>
                          {overview?.server.registrationMode === mode && (
                            <span className="mode-check">
                              <CheckIcon size={13} />
                            </span>
                          )}
                        </span>
                        <span className="mode-option-hint">{REGISTRATION_MODES[mode].hint}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setTab("settings")}
                  >
                    调整接入方式
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "devices" && (
            <div className="server-tab-body">
              <div className="table-toolbar">
                <div className="filter-pills">
                  {(
                    [
                      ["all", "全部"],
                      ["online", "在线"],
                      ["pending", "待批准"],
                      ["blocked", "已禁止"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`filter-pill${deviceFilter === value ? " active" : ""}`}
                      onClick={() => setDeviceFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="table-count">{visibleDevices.length} 台客户端</span>
              </div>

              {visibleDevices.length === 0 ? (
                <div className="server-empty">
                  <MonitorIcon size={24} />
                  <p>没有符合条件的客户端。</p>
                </div>
              ) : (
                <div className="device-table">
                  <div className="device-row head">
                    <span>客户端</span>
                    <span>状态</span>
                    <span>远控码</span>
                    <span>最近在线</span>
                    <span>操作</span>
                  </div>
                  {visibleDevices.map((device) => {
                    const busy = busyKey === `device-${device.id}`;
                    return (
                      <div className="device-row" key={device.id}>
                        <div className="device-name">
                          <span className={`online-dot${device.online ? " on" : ""}`} />
                          <div>
                            <strong>{device.name}</strong>
                            <span>
                              {platformLabel(device.platform)} · v{device.version}
                              {device.roles.length > 0 && ` · ${device.roles.includes("host") ? "被控" : "控制"}`}
                              {" · "}ID {device.id.slice(0, 8)}
                            </span>
                          </div>
                        </div>
                        <div>
                          <StatusPill
                            tone={deviceStatusLabel(device.status).tone}
                            label={deviceStatusLabel(device.status).label}
                          />
                        </div>
                        <div className="device-code">
                          {device.code ? formatCode(device.code) : "—"}
                        </div>
                        <div className="device-last">
                          <span>{formatAgo(device.lastSeen)}</span>
                          <span>{device.ip || device.lastIp || "—"}</span>
                        </div>
                        <div className="device-actions">
                          <CopyButton value={device.id} label="复制设备 ID" />
                          {device.status === "pending" && (
                            <button
                              type="button"
                              className="mini-button primary"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `device-${device.id}`,
                                  {
                                    method: "PATCH",
                                    path: `/api/admin/devices/${encodeURIComponent(device.id)}`,
                                    body: { status: "approved" },
                                  },
                                  `已允许“${device.name}”进行远控`,
                                )
                              }
                            >
                              批准
                            </button>
                          )}
                          {device.status === "approved" && (
                            <button
                              type="button"
                              className="mini-button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `device-${device.id}`,
                                  {
                                    method: "PATCH",
                                    path: `/api/admin/devices/${encodeURIComponent(device.id)}`,
                                    body: { status: "blocked" },
                                  },
                                  `已禁止“${device.name}”进行远控`,
                                )
                              }
                            >
                              禁止
                            </button>
                          )}
                          {device.status === "blocked" && (
                            <button
                              type="button"
                              className="mini-button primary"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `device-${device.id}`,
                                  {
                                    method: "PATCH",
                                    path: `/api/admin/devices/${encodeURIComponent(device.id)}`,
                                    body: { status: "approved" },
                                  },
                                  `已恢复“${device.name}”的远控权限`,
                                )
                              }
                            >
                              解封
                            </button>
                          )}
                          {device.status !== "blocked" && (
                            <button
                              type="button"
                              className="mini-button"
                              disabled={busy}
                              title={`临时冻结 ${policy.freezeMinutes} 分钟，期间无法登录`}
                              onClick={() => void quickFreeze(device)}
                            >
                              冻结 {policy.freezeMinutes} 分
                            </button>
                          )}
                          {device.online && (
                            <button
                              type="button"
                              className="mini-button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `device-${device.id}`,
                                  {
                                    method: "POST",
                                    path: `/api/admin/devices/${encodeURIComponent(device.id)}/disconnect`,
                                  },
                                  `已断开“${device.name}”`,
                                )
                              }
                            >
                              断开
                            </button>
                          )}
                          <button
                            type="button"
                            className="mini-button danger"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`移除客户端“${device.name}”？对方需要重新接入。`)) {
                                return;
                              }
                              void runAction(
                                `device-${device.id}`,
                                {
                                  method: "DELETE",
                                  path: `/api/admin/devices/${encodeURIComponent(device.id)}`,
                                },
                                `已移除“${device.name}”`,
                              );
                            }}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "invites" && (
            <div className="server-tab-body">
              <div className="invite-layout">
                <div className="server-card">
                  <div className="server-card-head">
                    <HashIcon size={17} />
                    <strong>创建邀请码</strong>
                  </div>
                  <div className="invite-fields">
                    <label className="field">
                      <div className="field-label">
                        <span>备注名称</span>
                        <span className="field-hint">便于识别</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={inviteLabel}
                          onChange={(event) => setInviteLabel(event.target.value)}
                          placeholder="例如：设计部-小王"
                          maxLength={40}
                        />
                      </div>
                    </label>
                    <div className="invite-field-row">
                      <label className="field">
                        <div className="field-label">
                          <span>可用次数</span>
                          <span className="field-hint">0 为不限</span>
                        </div>
                        <div className="input-shell">
                          <input
                            value={inviteMaxUses}
                            onChange={(event) =>
                              setInviteMaxUses(event.target.value.replace(/[^0-9]/g, ""))
                            }
                            inputMode="numeric"
                            placeholder="0"
                            maxLength={4}
                          />
                        </div>
                      </label>
                      <label className="field">
                        <div className="field-label">
                          <span>有效期（天）</span>
                          <span className="field-hint">0 为长期</span>
                        </div>
                        <div className="input-shell">
                          <input
                            value={inviteDays}
                            onChange={(event) =>
                              setInviteDays(event.target.value.replace(/[^0-9]/g, ""))
                            }
                            inputMode="numeric"
                            placeholder="0"
                            maxLength={4}
                          />
                        </div>
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button primary wide"
                    disabled={busyKey === "invite-create"}
                    onClick={() => void createInvite()}
                  >
                    {busyKey === "invite-create" ? (
                      <span className="spinner" />
                    ) : (
                      <HashIcon size={16} />
                    )}
                    生成邀请码
                  </button>
                  {createdInvite && (
                    <div className="invite-created">
                      <span>新邀请码</span>
                      <strong>{formatInvite(createdInvite.code)}</strong>
                      <div className="invite-created-actions">
                        <CopyButton value={createdInvite.code} label="复制邀请码" withLabel />
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void onApplyInvite(createdInvite.code)}
                        >
                          填入本机
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="server-card grow">
                  <div className="server-card-head">
                    <ShieldIcon size={17} />
                    <strong>邀请码列表</strong>
                    <span className="card-head-note">{invites.length} 个</span>
                  </div>
                  {invites.length === 0 ? (
                    <div className="server-empty compact">
                      <HashIcon size={22} />
                      <p>还没有邀请码。</p>
                    </div>
                  ) : (
                    <div className="invite-list">
                      {invites.map((invite) => (
                        <div className={`invite-item${invite.active ? "" : " inactive"}`} key={invite.code}>
                          <div className="invite-code-block">
                            <strong>{formatInvite(invite.code)}</strong>
                            <span>{invite.label}</span>
                          </div>
                          <div className="invite-meta">
                            <span>
                              {invite.uses}
                              {invite.maxUses > 0 ? ` / ${invite.maxUses}` : ""} 次使用
                            </span>
                            <span>
                              {invite.expiresAt ? `${formatTime(invite.expiresAt)} 过期` : "长期有效"}
                            </span>
                            <span>
                              {invite.active
                                ? invite.revokedAt
                                  ? "已撤销"
                                  : "有效"
                                : invite.revokedAt
                                  ? "已撤销"
                                  : "已失效"}
                            </span>
                          </div>
                          <div className="invite-actions">
                            <CopyButton value={invite.code} label="复制邀请码" />
                            <button
                              type="button"
                              className="mini-button"
                              disabled={busyKey === `invite-${invite.code}`}
                              onClick={() => void onApplyInvite(invite.code)}
                            >
                              填入本机
                            </button>
                            {invite.active && !invite.revokedAt && (
                              <button
                                type="button"
                                className="mini-button"
                                disabled={busyKey === `invite-${invite.code}`}
                                onClick={() =>
                                  void runAction(
                                    `invite-${invite.code}`,
                                    {
                                      method: "POST",
                                      path: `/api/admin/invites/${encodeURIComponent(invite.code)}/revoke`,
                                    },
                                    "邀请码已撤销",
                                  )
                                }
                              >
                                撤销
                              </button>
                            )}
                            <button
                              type="button"
                              className="mini-button danger"
                              disabled={busyKey === `invite-${invite.code}`}
                              onClick={() =>
                                void runAction(
                                  `invite-${invite.code}`,
                                  {
                                    method: "DELETE",
                                    path: `/api/admin/invites/${encodeURIComponent(invite.code)}`,
                                  },
                                  "邀请码已删除",
                                )
                              }
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "sessions" && (
            <div className="server-tab-body">
              {sessions.length === 0 ? (
                <div className="server-empty">
                  <PowerIcon size={24} />
                  <p>当前没有进行中的远程会话。</p>
                </div>
              ) : (
                <div className="session-list">
                  {sessions.map((session) => {
                    const risk = sessionRisk(session.telemetry);
                    return (
                      <div className="session-item" key={session.id}>
                        <div className="session-pair">
                          <span className="session-peer">
                            <MonitorIcon size={15} />
                            <strong>{session.host.name}</strong>
                          </span>
                          <ArrowRightIcon size={16} />
                          <span className="session-peer">
                            <ShieldIcon size={15} />
                            <strong>{session.controller.name}</strong>
                          </span>
                        </div>
                        <div className="session-meta-line">
                          <span>远控码 {formatCode(session.code)}</span>
                          <span>开始于 {formatTime(session.createdAt)}</span>
                          {session.endsAt ? (
                            <span>
                              剩余 {formatDuration(Math.max(0, session.endsAt - Date.now()))} 自动结束
                            </span>
                          ) : null}
                          <span>被控方 IP {session.host.ip || "—"}</span>
                          <span>控制方 IP {session.controller.ip || "—"}</span>
                        </div>
                        <button
                          type="button"
                          className="mini-button danger"
                          disabled={busyKey === `session-${session.id}`}
                          onClick={() =>
                            void runAction(
                              `session-${session.id}`,
                              {
                                method: "POST",
                                path: `/api/admin/sessions/${encodeURIComponent(session.id)}/end`,
                              },
                              "会话已结束",
                            )
                          }
                        >
                          结束会话
                        </button>
                        <div className="session-telemetry">
                          <StatusPill tone={risk.tone} label={risk.label} />
                          {session.telemetry ? (
                            <>
                              <span>RTT {Math.round(session.telemetry.rttMs)} ms</span>
                              <span>丢包 {session.telemetry.lossPct.toFixed(1)}%</span>
                              <span>抖动 {Math.round(session.telemetry.jitterMs)} ms</span>
                              <span>码率 {Math.round(session.telemetry.kbps)} Kbps</span>
                              {session.telemetry.fps > 0 && (
                                <span>{Math.round(session.telemetry.fps)} FPS</span>
                              )}
                              {session.telemetry.width > 0 && (
                                <span>
                                  {session.telemetry.width}×{session.telemetry.height}
                                </span>
                              )}
                              <span className="muted">
                                {session.telemetry.reporter === "host" ? "被控端" : "控制端"}上报 ·{" "}
                                {formatAgo(session.telemetry.updatedAt)}
                              </span>
                            </>
                          ) : (
                            <span className="muted">等待客户端上报实时质量，约 5 秒一次。</span>
                          )}
                        </div>
                        {session.dangerEvents.length > 0 && (
                          <div className="danger-events">
                            {session.dangerEvents.map((event, index) => (
                              <span className="danger-tag" key={`${event.at}-${index}`}>
                                {event.label} · {formatTime(event.at)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "risk" && (
            <div className="server-tab-body">
              <div className="risk-layout">
                <div className="server-card">
                  <div className="server-card-head">
                    <ShieldIcon size={17} />
                    <strong>并发与时长限制</strong>
                    <span className="server-card-aside">立即生效</span>
                  </div>
                  <div className="risk-form-grid">
                    <label className="field">
                      <div className="field-label">
                        <span>最大同时远控人数</span>
                        <span className="field-hint">0 为不限</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={maxSessionsInput}
                          onChange={(event) =>
                            setMaxSessionsInput(event.target.value.replace(/[^0-9]/g, ""))
                          }
                          inputMode="numeric"
                          placeholder="0"
                          maxLength={5}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <div className="field-label">
                        <span>单次远控时长（分钟）</span>
                        <span className="field-hint">0 为不限</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={limitInput}
                          onChange={(event) =>
                            setLimitInput(event.target.value.replace(/[^0-9]/g, ""))
                          }
                          inputMode="numeric"
                          placeholder="0"
                          maxLength={4}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <div className="field-label">
                        <span>超时后冷却（分钟）</span>
                        <span className="field-hint">到达时长上限后等待</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={cooldownInput}
                          onChange={(event) =>
                            setCooldownInput(event.target.value.replace(/[^0-9]/g, ""))
                          }
                          inputMode="numeric"
                          placeholder="5"
                          maxLength={4}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <div className="field-label">
                        <span>默认冻结时长（分钟）</span>
                        <span className="field-hint">快捷冻结使用</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={freezeInput}
                          onChange={(event) =>
                            setFreezeInput(event.target.value.replace(/[^0-9]/g, ""))
                          }
                          inputMode="numeric"
                          placeholder="10"
                          maxLength={5}
                        />
                      </div>
                    </label>
                  </div>
                  <p className="field-help">
                    达到人数上限后，新用户会看到“服务器远控席位已满”并需要等待；达到单次时长后会话自动结束，控制方需要等待冷却结束后才能再次发起远控。当前生效：并发{" "}
                    {policy.maxSessions > 0 ? `${policy.maxSessions} 人` : "不限"}、单次{" "}
                    {remoteMinutes(policy.sessionLimitMinutes)}、冷却{" "}
                    {remoteMinutes(policy.cooldownMinutes)}、冻结默认{" "}
                    {remoteMinutes(policy.freezeMinutes)}。
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busyKey === "policy-save"}
                    onClick={() => void savePolicy()}
                  >
                    {busyKey === "policy-save" ? (
                      <span className="spinner" />
                    ) : (
                      <CheckIcon size={16} />
                    )}
                    保存风控策略
                  </button>
                </div>

                <div className="server-card">
                  <div className="server-card-head">
                    <AlertIcon size={17} />
                    <strong>拉黑 / 冻结设备或 IP</strong>
                  </div>
                  <div className="filter-pills">
                    <button
                      type="button"
                      className={`filter-pill${blockKind === "device" ? " active" : ""}`}
                      onClick={() => setBlockKind("device")}
                    >
                      指定电脑
                    </button>
                    <button
                      type="button"
                      className={`filter-pill${blockKind === "ip" ? " active" : ""}`}
                      onClick={() => setBlockKind("ip")}
                    >
                      指定 IP
                    </button>
                  </div>
                  <label className="field">
                    <div className="field-label">
                      <span>{blockKind === "device" ? "设备 ID" : "IP 地址"}</span>
                      <span className="field-hint">
                        {blockKind === "device" ? "可在下方列表复制" : "支持 IPv4 / IPv6"}
                      </span>
                    </div>
                    <div className="input-shell">
                      <input
                        value={blockValue}
                        onChange={(event) => setBlockValue(event.target.value)}
                        placeholder={
                          blockKind === "device" ? "例如 5b1c…（设备 ID）" : "例如 203.0.113.10"
                        }
                        maxLength={64}
                      />
                    </div>
                  </label>
                  <div className="risk-form-row">
                    <label className="field">
                      <div className="field-label">
                        <span>备注名称</span>
                        <span className="field-hint">可选</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={blockLabel}
                          onChange={(event) => setBlockLabel(event.target.value)}
                          placeholder="例如：小王-公司电脑"
                          maxLength={64}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <div className="field-label">
                        <span>冻结时长（分钟）</span>
                        <span className="field-hint">默认 {policy.freezeMinutes}</span>
                      </div>
                      <div className="input-shell">
                        <input
                          value={blockMinutes}
                          onChange={(event) =>
                            setBlockMinutes(event.target.value.replace(/[^0-9]/g, ""))
                          }
                          placeholder={String(policy.freezeMinutes)}
                          inputMode="numeric"
                          disabled={blockPermanent}
                          maxLength={5}
                        />
                      </div>
                    </label>
                  </div>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={blockPermanent}
                      onChange={(event) => setBlockPermanent(event.target.checked)}
                    />
                    <span>永久拉黑（不自动解封，需要管理员手动解除）</span>
                  </label>
                  <label className="field">
                    <div className="field-label">
                      <span>原因</span>
                      <span className="field-hint">会写入客户端与服务端日志</span>
                    </div>
                    <div className="input-shell">
                      <input
                        value={blockReason}
                        onChange={(event) => setBlockReason(event.target.value)}
                        placeholder={blockPermanent ? "例如：多次违规操作" : "例如：临时限制 10 分钟"}
                        maxLength={120}
                      />
                    </div>
                  </label>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busyKey === "block-create"}
                    onClick={() => void createBlock()}
                  >
                    {busyKey === "block-create" ? (
                      <span className="spinner" />
                    ) : (
                      <ShieldIcon size={16} />
                    )}
                    {blockPermanent ? "永久拉黑" : "冻结一段时间"}
                  </button>
                  <p className="field-help">
                    限制立即生效：命中设备或 IP 的客户端会被断开，并在一段时间内无法登录或发起远控。操作会记录到“动态”与服务端安全日志。
                  </p>
                </div>
              </div>

              <div className="server-card">
                <div className="server-card-head">
                  <ShieldIcon size={17} />
                  <strong>生效中的限制</strong>
                  <span className="card-head-note">
                    {blocks.length} 条拉黑/冻结 · {cooldowns.length} 条冷却
                  </span>
                </div>
                {blocks.length === 0 && cooldowns.length === 0 ? (
                  <div className="server-empty compact">
                    <ShieldIcon size={22} />
                    <p>当前没有拉黑、冻结或冷却中的用户。</p>
                  </div>
                ) : (
                  <div className="risk-list">
                    {blocks.map((block) => (
                      <div className="risk-item" key={block.id}>
                        <div className="risk-item-main">
                          <span className={`risk-kind ${block.kind}`}>
                            {block.kind === "device" ? "设备" : "IP"}
                          </span>
                          <div>
                            <strong>{block.label || block.value}</strong>
                            <code>{block.value}</code>
                          </div>
                          <StatusPill
                            tone={block.expiresAt === null ? "error" : "busy"}
                            label={
                              block.expiresAt === null
                                ? "永久拉黑"
                                : `冻结至 ${formatTime(block.expiresAt)}`
                            }
                          />
                        </div>
                        <div className="risk-item-meta">
                          <span>{block.reason || "未填写原因"}</span>
                          <span>操作于 {formatTime(block.createdAt)}</span>
                        </div>
                        <button
                          type="button"
                          className="mini-button primary"
                          disabled={busyKey === `block-${block.id}`}
                          onClick={() =>
                            void runAction(
                              `block-${block.id}`,
                              {
                                method: "DELETE",
                                path: `/api/admin/blocks/${encodeURIComponent(block.id)}`,
                              },
                              "限制已解除",
                            )
                          }
                        >
                          解除
                        </button>
                      </div>
                    ))}
                    {cooldowns.map((cooldown) => (
                      <div className="risk-item cooldown" key={cooldown.key}>
                        <div className="risk-item-main">
                          <span className="risk-kind cooldown">冷却</span>
                          <div>
                            <strong>{cooldown.label || cooldown.key}</strong>
                            <code>{cooldown.key}</code>
                          </div>
                          <StatusPill
                            tone="busy"
                            label={`剩余 ${remainingLabel(cooldown.until)}`}
                          />
                        </div>
                        <div className="risk-item-meta">
                          <span>
                            {closeReasonLabel(cooldown.reason)} · 结束于{" "}
                            {formatTime(cooldown.until)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mini-button"
                          disabled={busyKey === `cooldown-${cooldown.key}`}
                          onClick={() =>
                            void runAction(
                              `cooldown-${cooldown.key}`,
                              {
                                method: "DELETE",
                                path: `/api/admin/cooldowns/${encodeURIComponent(cooldown.key)}`,
                              },
                              "冷却限制已解除",
                            )
                          }
                        >
                          解除冷却
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="server-tab-body">
              {history.length === 0 ? (
                <div className="server-empty">
                  <PowerIcon size={24} />
                  <p>还没有已结束的远控会话记录。</p>
                </div>
              ) : (
                <div className="session-list">
                  {history.map((record) => (
                    <div className="session-item" key={record.id}>
                      <div className="session-pair">
                        <span className="session-peer">
                          <MonitorIcon size={15} />
                          <strong>{record.host.name}</strong>
                          <span className="session-ip">{record.host.ip || "—"}</span>
                        </span>
                        <ArrowRightIcon size={16} />
                        <span className="session-peer">
                          <ShieldIcon size={15} />
                          <strong>{record.controller.name}</strong>
                          <span className="session-ip">{record.controller.ip || "—"}</span>
                        </span>
                      </div>
                      <div className="session-meta-line">
                        <span>{formatTime(record.startedAt)} 开始</span>
                        <span>持续 {formatDuration(record.durationMs)}</span>
                        <span>结束原因：{closeReasonLabel(record.reason)}</span>
                        {record.telemetry && (
                          <span>
                            平均 RTT {Math.round(record.telemetry.rttMs)} ms · 丢包{" "}
                            {record.telemetry.lossPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      {record.dangerEvents.length > 0 ? (
                        <div className="danger-events">
                          {record.dangerEvents.map((event, index) => (
                            <span className="danger-tag" key={`${event.at}-${index}`}>
                              {event.label} · {formatTime(event.at)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="history-safe">无危险操作记录</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="server-tab-body">
              {activity.length === 0 ? (
                <div className="server-empty">
                  <ShieldIcon size={24} />
                  <p>还没有管理动态。</p>
                </div>
              ) : (
                <ol className="activity-list">
                  {activity.map((entry) => (
                    <li key={entry.id}>
                      <span className="activity-dot" />
                      <div className="activity-main">
                        <strong>{ACTIVITY_LABELS[entry.action] ?? entry.action}</strong>
                        {entry.detail && <span>{entry.detail}</span>}
                        {entry.deviceId && (
                          <span className="activity-device">客户端 {entry.deviceId.slice(0, 8)}</span>
                        )}
                      </div>
                      <time>{formatTime(entry.at)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {tab === "settings" && (
            <div className="server-tab-body">
              <div className="server-card settings-shell">
                <div className="server-card-head">
                  <ServerIcon size={17} />
                  <strong>服务端设置</strong>
                </div>
                <label className="field">
                  <div className="field-label">
                    <span>服务名称</span>
                    <span className="field-hint">客户端握手时显示</span>
                  </div>
                  <div className="input-shell">
                    <ServerIcon size={17} />
                    <input
                      value={serverName}
                      onChange={(event) => setServerName(event.target.value)}
                      maxLength={64}
                      placeholder="若道远程服务"
                    />
                  </div>
                </label>

                <div className="field">
                  <div className="field-label">
                    <span>新客户端接入方式</span>
                    <span className="field-hint">立即生效</span>
                  </div>
                  <div className="mode-options">
                    {(Object.keys(REGISTRATION_MODES) as RegistrationMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`mode-option${registrationMode === mode ? " selected" : ""}`}
                        onClick={() => setRegistrationMode(mode)}
                      >
                        <span className="mode-option-head">
                          <strong>{REGISTRATION_MODES[mode].label}</strong>
                          {registrationMode === mode && (
                            <span className="mode-check">
                              <CheckIcon size={13} />
                            </span>
                          )}
                        </span>
                        <span className="mode-option-hint">{REGISTRATION_MODES[mode].hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-shell-foot">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busyKey === "settings-save"}
                    onClick={() => void saveServerSettings()}
                  >
                    {busyKey === "settings-save" ? (
                      <span className="spinner" />
                    ) : (
                      <CheckIcon size={16} />
                    )}
                    保存服务端设置
                  </button>
                  <button type="button" className="button ghost" onClick={onOpenSettings}>
                    <RefreshIcon size={15} /> 本机连接设置
                  </button>
                </div>
              </div>

              <div className="server-card settings-shell server-update-card">
                <div className="server-card-head">
                  <DownloadIcon size={17} />
                  <strong>服务端更新</strong>
                  {serverUpdate && (
                    <StatusPill
                      tone={updateTone(serverUpdate.phase)}
                      label={UPDATE_PHASE_LABELS[serverUpdate.phase]}
                    />
                  )}
                </div>

                <div className="server-update-meta">
                  <span>当前版本 {serverVersion ? `v${serverVersion}` : "—"}</span>
                  <span>更新源 {serverUpdate?.channel ?? "stable"}</span>
                  {serverUpdate?.systemUpdater ? (
                    <span>系统自动更新 · 空闲时安装</span>
                  ) : serverUpdate?.applyMode === "auto" ? (
                    <span>自动更新已开启</span>
                  ) : serverUpdate?.applyMode === "manual" ? (
                    <span>手动安装</span>
                  ) : null}
                </div>
                {serverUpdate?.systemUpdater && serverUpdateSupported && (
                  <p className="field-help">
                    系统更新服务每小时检查一次；检测到远控会话时自动延后，安装失败会自动回滚。
                  </p>
                )}

                {serverUpdate && !serverUpdate.supported && (
                  <InlineAlert kind="info">
                    {target === "local"
                      ? "本机服务端的程序随客户端一起升级，请更新客户端。"
                      : serverUpdate.reason ?? "当前服务端未启用更新功能。"}
                  </InlineAlert>
                )}

                {serverUpdate?.latest &&
                  (serverUpdate.phase === "available" || serverUpdate.phase === "ready") && (
                    <div className="server-update-release">
                      <strong>最新版本 v{serverUpdate.latest.version}</strong>
                      {serverUpdate.latest.size ? (
                        <span>{Math.max(1, Math.round(serverUpdate.latest.size / 1024))} KB</span>
                      ) : null}
                      {serverUpdate.latest.notes && <p>{serverUpdate.latest.notes}</p>}
                    </div>
                  )}

                {serverUpdate?.error && <InlineAlert>{serverUpdate.error}</InlineAlert>}
                {updateMessage && <p className="field-help">{updateMessage}</p>}

                {serverUpdate?.manualCommand && (
                  <div className="server-update-command">
                    <div className="field-label">
                      <span>在服务器上执行</span>
                      <span className="field-hint">替换文件并重启服务</span>
                    </div>
                    <code>{serverUpdate.manualCommand}</code>
                    <CopyButton
                      value={serverUpdate.manualCommand}
                      label="复制更新命令"
                      withLabel
                    />
                  </div>
                )}

                <div className="settings-shell-foot">
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!serverUpdate?.supported || updateBusy !== null}
                    onClick={() => void runServerUpdate("check")}
                  >
                    {updateBusy === "check" ? (
                      <span className="spinner" />
                    ) : (
                      <RefreshIcon size={15} />
                    )}
                    检查更新
                  </button>
                  {serverUpdate?.phase === "available" && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={updateBusy !== null}
                      onClick={() => void runServerUpdate("download")}
                    >
                      {updateBusy === "download" ? (
                        <span className="spinner" />
                      ) : (
                        <DownloadIcon size={15} />
                      )}
                      下载并校验
                    </button>
                  )}
                  {serverUpdate?.phase === "ready" && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={updateBusy !== null}
                      onClick={() => void runServerUpdate("apply")}
                    >
                      {updateBusy === "apply" ? (
                        <span className="spinner" />
                      ) : (
                        <CheckIcon size={15} />
                      )}
                      立即更新
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="panel-foot trust-row">
        <span>
          <ShieldIcon size={14} /> 管理员令牌只保存在本机内存
        </span>
        <span>
          <CopyIcon size={14} /> 邀请码可按次数与有效期控制
        </span>
        <span>
          <ServerIcon size={14} /> 支持随时禁止或断开客户端
        </span>
      </div>
    </section>
  );
}
