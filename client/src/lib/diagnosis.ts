import type { HostPhase } from "../hooks/useHost";
import type { ControllerPhase } from "../hooks/useController";
import type { AppInfo, DeployStep, Settings } from "../types";
import type { AccessRejectReason } from "./signaling";

import { t, tf } from "../i18n";


export interface DiagnosisInput {
  appInfo: AppInfo | null;
  settings: Settings;
  host: {
    phase: HostPhase;
    error: string | null;
    accessIssue: AccessRejectReason | null;
    hasSession: boolean;
  };
  controller: {
    phase: ControllerPhase;
    error: string | null;
    accessIssue: AccessRejectReason | null;
  };
  deploy: {
    phase: "idle" | "running" | "done" | "error";
    error: string | null;
    steps: DeployStep[];
  };
}

export interface DiagnosisIssue {
  id: string;
  tone: "error" | "warning" | "info";
  title: string;
  detail: string;
  suggestion: string;
  faqId?: string;
}

export interface Diagnosis {
  issues: DiagnosisIssue[];
  context: string;
  suggestions: string[];
  headline: string;
}

const DEFAULT_LOCAL_URL = "http://127.0.0.1:8787";

const HOST_LABELS: Record<HostPhase, string> = {
  idle: t("未上线"),
  connecting: t("正在上线"),
  pending: t("等待管理员批准"),
  online: t("已上线"),
  error: t("连接异常"),
};

const CONTROLLER_LABELS: Record<ControllerPhase, string> = {
  idle: t("待连接"),
  lookup: t("正在查找设备"),
  waiting: t("等待管理员批准"),
  verifying: t("正在校验访问密钥"),
  connecting: t("正在建立通道"),
  connected: t("控制中"),
  error: t("连接失败"),
};

const DEPLOY_LABELS: Record<DiagnosisInput["deploy"]["phase"], string> = {
  idle: t("未开始"),
  running: t("进行中"),
  done: t("已完成"),
  error: t("失败"),
};

function cleanError(value: string | null): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

export function redactForContext(input: string): string {
  let text = String(input ?? "");
  text = text.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
    t("[已隐藏私钥]"),
  );
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    t("[已隐藏令牌]"),
  );
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, t("$1[已隐藏]"));
  text = text.replace(
    /\b(password|passwd|passphrase|secret|token|api[_-]?key)\b(\s*[:=：]\s*)([^\s,，;；]+)/gi,
    t("$1$2[已隐藏]"),
  );
  text = text.replace(
    /(远控码|访问密钥|管理员密码|登录密码|SSH\s*密码|密码|私钥口令|口令)(\s*[:：=]?\s*)([A-Za-z0-9@#$%^&*._+-]{4,})/gi,
    t("$1$2[已隐藏]"),
  );
  text = text.replace(/\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g, t("[已隐藏号码]"));
  return text;
}

function hostIssue(input: DiagnosisInput): DiagnosisIssue | null {
  const { phase, error, accessIssue } = input.host;
  if (phase === "pending") {
    return {
      id: "host-pending",
      tone: "info",
      title: t("本机正在等待管理员批准"),
      detail: t("服务器开启了审核制，批准后会自动上线，不需要重新操作。"),
      suggestion: t("联系管理员，在服务端「客户端」页找到这台设备并点击“允许”。"),
      faqId: "approval",
    };
  }
  if (phase !== "error") return null;
  const detail = cleanError(error) || t("本机被控连接异常。");
  if (accessIssue === "invite-required" || accessIssue === "invite-invalid") {
    return {
      id: "host-invite",
      tone: "error",
      title: t("本机缺少有效的邀请码"),
      detail,
      suggestion: t("向管理员索取邀请码，打开右上角设置填入“邀请码”，再重新上线。"),
      faqId: "invite",
    };
  }
  if (accessIssue === "blocked") {
    return {
      id: "host-blocked",
      tone: "error",
      title: t("本机已被管理员禁止远控"),
      detail,
      suggestion: t("联系管理员，在服务端“客户端”页把本机状态改为“已允许”。"),
      faqId: "blocked",
    };
  }
  if (accessIssue === "network" || /无法接入|连接服务器失败|超时/.test(detail)) {
    return {
      id: "host-network",
      tone: "error",
      title: t("本机无法接入服务器"),
      detail,
      suggestion:
        t("检查设置中的服务器地址是否正确、服务器是否正在运行、网络是否可达；本机服务端需要在「服务端」页启动。"),
      faqId: "server-url",
    };
  }
  if (/屏幕|录制|共享|权限/.test(detail)) {
    return {
      id: "host-screen",
      tone: "error",
      title: t("无法获取屏幕画面"),
      detail,
      suggestion: t("在系统隐私设置中允许屏幕录制，然后重新点击“开始被控”。"),
      faqId: "screen",
    };
  }
  return {
    id: "host-error",
    tone: "error",
    title: t("本机被控连接异常"),
    detail,
    suggestion: t("先停止再重新开始被控；如果反复失败，让 AI 结合状态帮你判断。"),
    faqId: "server-url",
  };
}

function controllerIssue(input: DiagnosisInput): DiagnosisIssue | null {
  const { phase, error, accessIssue } = input.controller;
  if (phase !== "error") return null;
  const detail = cleanError(error) || t("远程连接失败。");
  if (accessIssue === "invite-required" || accessIssue === "invite-invalid") {
    return {
      id: "control-invite",
      tone: "error",
      title: t("本机缺少有效的邀请码"),
      detail,
      suggestion: t("向管理员索取邀请码，填入右上角设置后重新连接。"),
      faqId: "invite",
    };
  }
  if (accessIssue === "blocked") {
    return {
      id: "control-blocked",
      tone: "error",
      title: t("本机已被管理员禁止远控"),
      detail,
      suggestion: t("联系管理员在服务端“客户端”页恢复本机权限。"),
      faqId: "blocked",
    };
  }
  if (/找不到|没有找到/.test(detail)) {
    return {
      id: "control-not-found",
      tone: "error",
      title: t("没有找到远控码对应的设备"),
      detail,
      suggestion:
        t("确认对方已经点击“开始被控”并保持在线，核对 9 位远控码，并确保两端服务器地址一致。"),
      faqId: "not-found",
    };
  }
  if (/密钥不正确|访问密钥错误|invalid.key/i.test(detail)) {
    return {
      id: "control-key",
      tone: "error",
      title: t("访问密钥不正确"),
      detail,
      suggestion: t("让对方重新复制访问密钥；注意密钥不含 I/O/0/1，对方更换密钥后旧密钥会失效。"),
      faqId: "invalid-key",
    };
  }
  if (/正在被其他|对方正忙|忙碌/.test(detail)) {
    return {
      id: "control-busy",
      tone: "warning",
      title: t("对方正在被其他设备控制"),
      detail,
      suggestion: t("等对方结束当前会话后再连接，或让对方确认没有其他人在操作。"),
    };
  }
  if (/频繁/.test(detail)) {
    return {
      id: "control-rate",
      tone: "warning",
      title: t("尝试次数过于频繁"),
      detail,
      suggestion: t("等待一分钟再试，避免连续输入错误密钥。"),
    };
  }
  if (/不能控制本机|控制自己/.test(detail)) {
    return {
      id: "control-self",
      tone: "warning",
      title: t("不能控制本机"),
      detail,
      suggestion: t("请使用另一台电脑作为控制端，或让同事从他的电脑连接。"),
    };
  }
  if (/已离线|对方已下线/.test(detail)) {
    return {
      id: "control-offline",
      tone: "error",
      title: t("对方已离线"),
      detail,
      suggestion: t("请对方重新打开「本机被控」并点击“开始被控”，获取新的远控码后再连接。"),
      faqId: "not-found",
    };
  }
  if (accessIssue === "network" || /服务器|网络|超时/.test(detail)) {
    return {
      id: "control-network",
      tone: "error",
      title: t("无法连接服务器"),
      detail,
      suggestion: t("确认对方在线、服务器地址一致且服务器正在运行，然后重试。"),
      faqId: "server-url",
    };
  }
  return {
    id: "control-error",
    tone: "error",
    title: t("远程连接失败"),
    detail,
    suggestion: t("让对方重新开始被控后再试；如果仍失败，让 AI 结合状态帮你判断。"),
  };
}

function deployIssue(input: DiagnosisInput): DiagnosisIssue | null {
  if (input.deploy.phase !== "error") return null;
  const failed = input.deploy.steps.find((step) => step.status === "error");
  const detail = cleanError(input.deploy.error) || t("安装脚本返回了错误。");
  const title = failed ? tf("服务器部署在「{0}」失败", failed.title) : t("服务器部署失败");
  let suggestion =
    t("展开安装日志查看最后几行报错，确认 SSH 账号、端口、密码或私钥正确，云安全组已放行所需端口，然后重新部署。");
  let faqId = "deploy-fail";
  if (/指纹/.test(detail)) {
    suggestion =
      t("服务器指纹与上次记录不一致。如果是重装系统，可以点击“清除已保存的服务器指纹”后重新部署；否则先确认没有连到错误的服务器。");
    faqId = "deploy-prepare";
  } else if (/密码|认证|authentication|permission denied/i.test(detail)) {
    suggestion = t("确认 SSH 用户名、密码或私钥正确，并确认账号有 sudo 权限或直接使用 root。");
  } else if (/域名|DNS|解析|certificate|证书/i.test(detail)) {
    suggestion = t("确认域名 A 记录已经指向这台服务器并生效；也可以先清空域名，改用 http://服务器IP 安装。");
  } else if (/端口|port|占用|address already in use/i.test(detail)) {
    suggestion =
      t("安装器会自动避开已占用的端口，不会停止现有网站服务；请确认云安全组已放行日志中实际选择的端口，并确认 443 未被其他服务占用（否则无法自动启用 HTTPS）。");
  } else if (/磁盘|disk|空间|no space/i.test(detail)) {
    suggestion = t("清理服务器磁盘或更换一台有足够空间的服务器；安装约需要 200MB。");
  } else if (/libatomic|GLIBC/i.test(detail)) {
    suggestion =
      t("服务器的系统库过旧（glibc / libatomic），Node.js 无法启动。安装器会自动改用兼容构建；如果仍然失败，请把系统升级到 Ubuntu 22.04+ 或 Debian 12+ 后重新部署。");
  } else if (/超时|timeout|网络|connect/i.test(detail)) {
    suggestion = t("检查服务器 IP、SSH 端口和网络是否可达，确认云安全组已放行 SSH 端口。");
  }
  return {
    id: "deploy-error",
    tone: "error",
    title,
    detail,
    suggestion,
    faqId,
  };
}

function environmentIssues(input: DiagnosisInput): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];
  const { settings, appInfo } = input;
  if (appInfo && !appInfo.inputAvailable) {
    issues.push({
      id: "input-unavailable",
      tone: "warning",
      title: t("这台电脑只能观看画面，无法注入鼠标键盘"),
      detail: t("当前系统或权限不支持输入控制，作为控制端时对方画面只能看。"),
      suggestion: t("需要在 Windows 客户端上控制对方，或在对方电脑上手动操作。"),
      faqId: "input",
    });
  }
  if (settings.serverUrl.replace(/\/+$/, "") === DEFAULT_LOCAL_URL) {
    issues.push({
      id: "local-server-url",
      tone: "info",
      title: t("当前使用本机默认服务器"),
      detail: t("地址 http://127.0.0.1:8787 只适合同一台电脑或同一局域网。"),
      suggestion:
        t("只在本机使用可以忽略；要让互联网上的朋友接入，请在「服务端」页部署云服务器，安装完成后会自动切换地址。"),
      faqId: "server-url",
    });
  }
  return issues;
}

function stepSummary(steps: DeployStep[]): string {
  if (steps.length === 0) return t("还没有开始");
  const done = steps.filter((step) => step.status === "success" || step.status === "skipped").length;
  const failed = steps.find((step) => step.status === "error");
  const running = steps.find((step) => step.status === "running");
  if (failed) return tf("{0}/{1} 步完成，失败于「{2}」", done, steps.length, failed.title);
  if (running) return tf("{0}/{1} 步完成，正在「{2}」", done, steps.length, running.title);
  return tf("{0}/{1} 步完成", done, steps.length);
}

export function buildDiagnosis(input: DiagnosisInput): Diagnosis {
  const { settings, appInfo } = input;
  const issues = [
    deployIssue(input),
    hostIssue(input),
    controllerIssue(input),
    ...environmentIssues(input),
  ].filter((issue): issue is DiagnosisIssue => issue !== null);

  const deployItems = input.deploy.steps
    .filter((step) => step.status === "error" || step.status === "running")
    .map((step) => `  - ${step.title}：${step.status === "error" ? t("失败") : t("进行中")} ${step.note}`);

  const contextLines = [
    tf("【客户端】v{0} · {1} · {2}", appInfo?.version ?? t("未知"), appInfo?.platform ?? t("未知平台"), appInfo?.inputAvailable ? t("支持输入控制") : t("仅观看画面")),
    tf("【服务器地址】{0}{1}", settings.serverUrl, settings.serverUrl.replace(/\/+$/, "") === DEFAULT_LOCAL_URL ? t("（内置本机默认地址）") : ""),
    tf("【邀请码】{0}", settings.inviteCode ? t("已填写") : t("未填写")),
    tf("【本机被控】{0}{1}{2}", HOST_LABELS[input.host.phase], input.host.hasSession ? t(" · 有活动会话") : "", input.host.error ? tf(" · 最近错误：{0}", cleanError(input.host.error)) : ""),
    tf("【控制远程设备】{0}{1}", CONTROLLER_LABELS[input.controller.phase], input.controller.error ? tf(" · 最近错误：{0}", cleanError(input.controller.error)) : ""),
    tf("【服务端管理】{0} · {1}", settings.adminReady ? t("已保存管理员密码") : t("未配置管理员密码"), settings.localServerEnabled ? tf("本机服务端已启用（端口 {0}）", settings.localServerPort) : t("本机服务端未启用")),
    tf("【服务器部署】{0} · {1}{2}", DEPLOY_LABELS[input.deploy.phase], stepSummary(input.deploy.steps), input.deploy.error ? tf(" · 错误：{0}", cleanError(input.deploy.error)) : ""),
    ...(deployItems.length ? [t("【部署步骤】"), ...deployItems] : []),
    ...(issues.length
      ? [t("【客户端自动检测】"), ...issues.map((issue) => `  - ${issue.title}：${issue.detail}`)]
      : []),
  ];

  const suggestions: string[] = [];
  const pushSuggestion = (value: string) => {
    const text = value.trim();
    if (text && !suggestions.includes(text)) suggestions.push(text);
  };

  const errorIssue = issues.find((issue) => issue.tone === "error");
  if (errorIssue) {
    pushSuggestion(tf("我遇到了「{0}」，请结合当前状态告诉我最可能的原因和具体操作步骤。", errorIssue.title));
  }
  for (const issue of issues) {
    if (issue.faqId === "invite") pushSuggestion(t("服务器提示需要邀请码，我怎么让管理员生成并填写？"));
    if (issue.id === "host-pending") {
      pushSuggestion(t("本机一直等待管理员批准，管理员应该在哪里放行？"));
    }
    if (issue.id === "input-unavailable") {
      pushSuggestion(t("为什么这台电脑只能看画面，不能控制对方鼠标键盘？"));
    }
    if (issue.id === "local-server-url") {
      pushSuggestion(t("我该用本机服务端还是云服务器？服务器地址应该怎么填？"));
    }
    if (issue.faqId === "not-found") {
      pushSuggestion(t("输入远控码后提示找不到设备，可能有哪些原因？"));
    }
  }
  pushSuggestion(t("远控码和访问密钥有什么区别？"));
  pushSuggestion(t("怎样把服务端安全地分享给朋友？"));
  pushSuggestion(t("部署服务器前需要准备什么？"));

  const headline = issues.some((issue) => issue.tone === "error")
    ? tf("检测到 {0} 个需要处理的问题", issues.filter((issue) => issue.tone === "error").length)
    : issues.length
      ? tf("当前没有严重问题，有 {0} 条使用提示", issues.length)
      : t("当前状态正常");

  return {
    issues,
    context: redactForContext(contextLines.join("\n")),
    suggestions: suggestions.slice(0, 6),
    headline,
  };
}

export function errorQuestion(area: string, error: string | null): string {
  const detail = cleanError(error);
  return detail
    ? tf("我在「{0}」遇到错误：{1}。请结合当前状态帮我判断原因，并给出具体操作步骤。", area, detail)
    : tf("我在「{0}」遇到问题，请结合当前状态帮我排查。", area);
}

export function deployQuestion(error: string | null, steps: DeployStep[]): string {
  const failed = steps.find((step) => step.status === "error");
  const detail = cleanError(error) || t("安装脚本返回了错误");
  return failed
    ? tf("服务器部署在「{0}」步骤失败：{1}。请判断最可能的原因，并告诉我按顺序怎么处理。", failed.title, detail)
    : tf("服务器部署失败：{0}。请结合当前状态判断原因，并告诉我接下来怎么做。", detail);
}
