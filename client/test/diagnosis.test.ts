import { describe, expect, it } from "vitest";
import {
  buildDiagnosis,
  deployQuestion,
  errorQuestion,
  redactForContext,
  type DiagnosisInput,
} from "../src/lib/diagnosis";
import type { AppInfo, DeployStep, Settings } from "../src/types";

const DEFAULT_INFO: AppInfo = {
  version: "0.1.0",
  platform: "win32",
  inputAvailable: true,
  smoke: false,
};

const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://127.0.0.1:8787",
  deviceName: "测试电脑",
  autoStartHost: false,
  preferredCode: "",
  keyPersisted: true,
  deviceId: "device-1",
  inviteCode: "",
  adminReady: false,
  adminServerUrl: "",
  localServerEnabled: false,
  localServerPort: 8787,
  localServerPublicUrl: "",
  launchAtLogin: false,
  autoUpdate: true,
};

function step(
  id: DeployStep["id"],
  title: string,
  status: DeployStep["status"],
  note = "",
): DeployStep {
  return { id, title, detail: "", status, note };
}

function input(
  overrides: {
    appInfo?: AppInfo | null;
    settings?: Partial<Settings>;
    host?: Partial<DiagnosisInput["host"]>;
    controller?: Partial<DiagnosisInput["controller"]>;
    deploy?: Partial<DiagnosisInput["deploy"]>;
  } = {},
): DiagnosisInput {
  return {
    appInfo: overrides.appInfo === undefined ? DEFAULT_INFO : overrides.appInfo,
    settings: { ...DEFAULT_SETTINGS, ...overrides.settings },
    host: { phase: "idle", error: null, accessIssue: null, hasSession: false, ...overrides.host },
    controller: { phase: "idle", error: null, accessIssue: null, ...overrides.controller },
    deploy: { phase: "idle", error: null, steps: [], ...overrides.deploy },
  };
}

describe("redactForContext", () => {
  it("hides remote codes, access keys and passwords", () => {
    const text = redactForContext(
      "远控码 123 456 789，访问密钥 ABCDE23456，密码：hunter2，SSH 密码: pass1234",
    );
    expect(text).not.toContain("123 456 789");
    expect(text).not.toContain("ABCDE23456");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("pass1234");
    expect(text).toContain("[已隐藏");
  });

  it("hides tokens and private keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const text = redactForContext(`Authorization: Bearer abcdefghijklmnop ${jwt}\n${key}`);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("MIIEowIBAAKCAQEA");
    expect(text).toContain("[已隐藏令牌]");
    expect(text).toContain("[已隐藏私钥]");
  });

  it("keeps ordinary troubleshooting text readable", () => {
    const text = "连接服务器失败：请确认地址 http://127.0.0.1:8787 是否可访问";
    expect(redactForContext(text)).toBe(text);
  });
});

describe("buildDiagnosis", () => {
  it("flags the default local server and suggests the cloud option", () => {
    const diagnosis = buildDiagnosis(input());
    expect(diagnosis.issues.map((issue) => issue.id)).toContain("local-server-url");
    expect(diagnosis.headline).toContain("1 条使用提示");
    expect(diagnosis.suggestions).toContain("我该用本机服务端还是云服务器？服务器地址应该怎么填？");
    expect(diagnosis.context).toContain("http://127.0.0.1:8787");
    expect(diagnosis.context).toContain("【邀请码】未填写");
  });

  it("describes a pending host approval without treating it as an error", () => {
    const diagnosis = buildDiagnosis(input({ host: { phase: "pending" } }));
    const issue = diagnosis.issues.find((item) => item.id === "host-pending");
    expect(issue?.tone).toBe("info");
    expect(issue?.faqId).toBe("approval");
    expect(diagnosis.headline).not.toContain("需要处理");
    expect(diagnosis.suggestions).toContain("本机一直等待管理员批准，管理员应该在哪里放行？");
  });

  it("turns a blocked host into an actionable error", () => {
    const diagnosis = buildDiagnosis(
      input({
        host: { phase: "error", error: "管理员已禁止此客户端", accessIssue: "blocked" },
      }),
    );
    const issue = diagnosis.issues.find((item) => item.id === "host-blocked");
    expect(issue?.tone).toBe("error");
    expect(issue?.faqId).toBe("blocked");
    expect(diagnosis.headline).toContain("1 个需要处理的问题");
  });

  it("recognises host invite and network failures", () => {
    const invite = buildDiagnosis(
      input({ host: { phase: "error", error: "需要邀请码", accessIssue: "invite-required" } }),
    );
    expect(invite.issues.find((item) => item.id === "host-invite")?.faqId).toBe("invite");

    const network = buildDiagnosis(
      input({ host: { phase: "error", error: "无法接入服务器", accessIssue: "network" } }),
    );
    expect(network.issues.find((item) => item.id === "host-network")?.faqId).toBe("server-url");
  });

  it("classifies controller errors from their messages", () => {
    const notFound = buildDiagnosis(
      input({ controller: { phase: "error", error: "找不到这个远控码对应的设备" } }),
    );
    expect(notFound.issues.find((item) => item.id === "control-not-found")?.faqId).toBe(
      "not-found",
    );

    const invalidKey = buildDiagnosis(
      input({ controller: { phase: "error", error: "访问密钥不正确" } }),
    );
    expect(invalidKey.issues.find((item) => item.id === "control-key")?.faqId).toBe("invalid-key");

    const busy = buildDiagnosis(
      input({ controller: { phase: "error", error: "对方正在被其他设备控制" } }),
    );
    expect(busy.issues.find((item) => item.id === "control-busy")?.tone).toBe("warning");

    const offline = buildDiagnosis(
      input({ controller: { phase: "error", error: "对方已离线" } }),
    );
    expect(offline.issues.find((item) => item.id === "control-offline")?.faqId).toBe("not-found");
  });

  it("maps deploy failures to the failed step and a matching suggestion", () => {
    const diagnosis = buildDiagnosis(
      input({
        settings: { serverUrl: "https://remote.example.com" },
        deploy: {
          phase: "error",
          error: "域名 DNS 解析失败",
          steps: [
            step("connect", "连接服务器", "success"),
            step("proxy", "配置网站入口", "error", "certificate error"),
          ],
        },
      }),
    );
    const issue = diagnosis.issues.find((item) => item.id === "deploy-error");
    expect(issue?.title).toContain("配置网站入口");
    expect(issue?.suggestion).toContain("域名 A 记录");
    expect(diagnosis.context).toContain("失败于「配置网站入口」");
    expect(diagnosis.context).toContain("配置网站入口：失败");
  });

  it("points fingerprint mismatches at the saved-host reset", () => {
    const diagnosis = buildDiagnosis(
      input({
        deploy: {
          phase: "error",
          error: "服务器指纹与上次记录不一致",
          steps: [step("connect", "连接服务器", "error")],
        },
      }),
    );
    const issue = diagnosis.issues.find((item) => item.id === "deploy-error");
    expect(issue?.suggestion).toContain("清除已保存的服务器指纹");
    expect(issue?.faqId).toBe("deploy-prepare");
  });

  it("explains Node.js failures caused by old system libraries", () => {
    const diagnosis = buildDiagnosis(
      input({
        deploy: {
          phase: "error",
          error:
            "安装 Node.js失败（退出码 127）：/usr/local/bin/node: error while loading shared libraries: libatomic.so.1: cannot open shared object file: No such file or directory",
          steps: [step("packages", "安装运行环境", "error")],
        },
      }),
    );
    const issue = diagnosis.issues.find((item) => item.id === "deploy-error");
    expect(issue?.suggestion).toContain("glibc");
    expect(issue?.suggestion).toContain("Ubuntu 22.04+");
  });

  it("warns when the platform cannot inject input", () => {
    const diagnosis = buildDiagnosis(input({ appInfo: { ...DEFAULT_INFO, inputAvailable: false } }));
    const issue = diagnosis.issues.find((item) => item.id === "input-unavailable");
    expect(issue?.tone).toBe("warning");
    expect(diagnosis.context).toContain("仅观看画面");
    expect(diagnosis.suggestions).toContain("为什么这台电脑只能看画面，不能控制对方鼠标键盘？");
  });

  it("keeps secrets out of the AI context even when errors contain them", () => {
    const diagnosis = buildDiagnosis(
      input({
        host: {
          phase: "error",
          error: "连接失败：远控码 123 456 789，访问密钥 ABCDE23456，密码：hunter2",
          accessIssue: "network",
        },
      }),
    );
    expect(diagnosis.context).not.toContain("123 456 789");
    expect(diagnosis.context).not.toContain("ABCDE23456");
    expect(diagnosis.context).not.toContain("hunter2");
    expect(diagnosis.context).toContain("[已隐藏");
  });

  it("deduplicates and limits suggested questions", () => {
    const diagnosis = buildDiagnosis(
      input({
        host: { phase: "pending" },
        controller: { phase: "error", error: "找不到远控码对应的设备" },
      }),
    );
    expect(diagnosis.suggestions.length).toBeLessThanOrEqual(6);
    expect(new Set(diagnosis.suggestions).size).toBe(diagnosis.suggestions.length);
  });
});

describe("question builders", () => {
  it("collapses whitespace in error questions", () => {
    expect(errorQuestion("本机被控", "  连接\n失败  ")).toContain("连接 失败");
    expect(errorQuestion("控制远程设备", null)).toContain("遇到问题");
  });

  it("names the failed deploy step", () => {
    const question = deployQuestion("权限不足", [
      step("connect", "连接服务器", "success"),
      step("packages", "安装依赖", "error"),
    ]);
    expect(question).toContain("安装依赖");
    expect(question).toContain("权限不足");
  });
});
