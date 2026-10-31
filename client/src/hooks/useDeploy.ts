import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeployConfig,
  DeployEvent,
  DeployResult,
  DeployStep,
  ToastKind,
} from "../types";

const INITIAL_STEPS: DeployStep[] = [
  { id: "connect", title: "连接服务器", detail: "验证 SSH 指纹并使用账号登录", status: "pending", note: "" },
  { id: "inspect", title: "检查系统环境", detail: "确认发行版、磁盘，并规划不冲突的端口", status: "pending", note: "" },
  { id: "packages", title: "安装运行环境", detail: "准备 Node.js 与独立的 Caddy 入口", status: "pending", note: "" },
  { id: "turn", title: "配置 TURN 中转", detail: "为复杂网络准备音视频中继", status: "pending", note: "" },
  { id: "server", title: "部署信令服务", detail: "上传服务端并注册 systemd 服务", status: "pending", note: "" },
  { id: "proxy", title: "配置网站入口", detail: "由独立 Caddy 反向代理并自动申请 HTTPS", status: "pending", note: "" },
  { id: "firewall", title: "放行防火墙端口", detail: "只放行本次实际使用的端口", status: "pending", note: "" },
  { id: "defense", title: "加固入侵防护", detail: "启用 fail2ban、SSH 限速与内核防护", status: "pending", note: "" },
  { id: "verify", title: "验证公网访问", detail: "检查健康接口与管理员登录", status: "pending", note: "" },
  { id: "finish", title: "保存配置", detail: "把服务器地址与管理员密码写入本机", status: "pending", note: "" },
];

export interface DeployLogEntry {
  line: string;
  stream: "stdout" | "stderr";
}

export interface DeployHostKeyPrompt {
  host: string;
  port: number;
  fingerprint: string;
  previous: string | null;
}

export type DeployPhase = "idle" | "running" | "done" | "error";

export interface DeployController {
  phase: DeployPhase;
  steps: DeployStep[];
  logs: DeployLogEntry[];
  hostKey: DeployHostKeyPrompt | null;
  result: DeployResult | null;
  error: string | null;
  runId: string;
  start: (config: DeployConfig) => Promise<void>;
  cancel: () => Promise<void>;
  confirmHostKey: (accept: boolean) => Promise<void>;
  forgetHost: () => Promise<void>;
  reset: () => void;
}

interface DeployOptions {
  notify: (message: string, kind?: ToastKind) => void;
  onDone: (result: DeployResult) => void | Promise<void>;
}

function initialSteps(): DeployStep[] {
  return INITIAL_STEPS.map((step) => ({ ...step }));
}

export function useDeploy({ notify, onDone }: DeployOptions): DeployController {
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const [logs, setLogs] = useState<DeployLogEntry[]>([]);
  const [hostKey, setHostKey] = useState<DeployHostKeyPrompt | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const notifyRef = useRef(notify);
  const doneRef = useRef(onDone);
  const runIdRef = useRef("");
  const lastTargetRef = useRef({ host: "", port: 22 });

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    return window.remote.onDeployEvent((event: DeployEvent) => {
      switch (event.type) {
        case "step":
          setSteps((list) =>
            list.map((item) => (item.id === event.step.id ? event.step : item)),
          );
          break;
        case "log":
          setLogs((list) => {
            const next = [...list, { line: event.line, stream: event.stream }];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
          break;
        case "host-key":
          setHostKey(event.prompt);
          break;
        case "done":
          setHostKey(null);
          setResult(event.result);
          setPhase("done");
          notifyRef.current("服务端部署完成，已切换为新的服务器", "success");
          void doneRef.current(event.result);
          break;
        case "error":
          setHostKey(null);
          setError(event.message);
          setPhase("error");
          notifyRef.current("服务器部署未完成，请查看提示", "error");
          break;
        case "cancelled":
          setHostKey(null);
          setPhase("idle");
          setSteps((list) => list.map((step) => (step.status === "running" ? { ...step, status: "pending" } : step)));
          notifyRef.current("已取消服务器部署", "info");
          break;
        default:
          break;
      }
    });
  }, []);

  const start = useCallback(async (config: DeployConfig) => {
    setPhase("running");
    setSteps(initialSteps());
    setLogs([]);
    setHostKey(null);
    setResult(null);
    setError(null);
    setRunId("");
    runIdRef.current = "";
    lastTargetRef.current = { host: config.host, port: config.sshPort };
    try {
      const response = await window.remote.startDeploy(config);
      runIdRef.current = response.runId;
      setRunId(response.runId);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")
          : "无法启动部署任务。";
      setError(message);
      setPhase("error");
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    await window.remote.cancelDeploy(runIdRef.current);
  }, []);

  const confirmHostKey = useCallback(async (accept: boolean) => {
    if (!runIdRef.current) return;
    setHostKey(null);
    await window.remote.confirmDeployHostKey({ runId: runIdRef.current, accept });
    if (!accept) {
      await window.remote.cancelDeploy(runIdRef.current);
    }
  }, []);

  const forgetHost = useCallback(async () => {
    const target = hostKey ?? {
      host: lastTargetRef.current.host,
      port: lastTargetRef.current.port,
      fingerprint: "",
      previous: null,
    };
    if (!target.host) return;
    await window.remote.forgetDeployHost({ host: target.host, port: target.port });
    notifyRef.current("已清除该服务器的指纹记录，可以重新部署", "info");
  }, [hostKey]);

  const reset = useCallback(() => {
    if (phase === "running") return;
    setPhase("idle");
    setSteps([]);
    setLogs([]);
    setHostKey(null);
    setResult(null);
    setError(null);
    setRunId("");
    runIdRef.current = "";
  }, [phase]);

  return {
    phase,
    steps,
    logs,
    hostKey,
    result,
    error,
    runId,
    start,
    cancel,
    confirmHostKey,
    forgetHost,
    reset,
  };
}
