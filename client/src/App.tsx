import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantDialog } from "./components/AssistantDialog";
import { CommunityPanel } from "./components/CommunityPanel";
import { ControlPanel } from "./components/ControlPanel";
import { DeployWizard } from "./components/DeployWizard";
import { HelpCenter } from "./components/HelpCenter";
import { HostPanel } from "./components/HostPanel";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { ServerPanel } from "./components/ServerPanel";
import { SharedServersPanel } from "./components/SharedServersPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { ToastStack } from "./components/ui";
import { UpdateDialog } from "./components/UpdateDialog";
import {
  ChatIcon,
  GlobeIcon,
  HelpIcon,
  LinkIcon,
  MonitorIcon,
  MousePointerIcon,
  ServerIcon,
  SettingsIcon,
  SparkIcon,
} from "./components/icons";
import { useAssistant } from "./hooks/useAssistant";
import { useCatalog } from "./hooks/useCatalog";
import { useCommunity } from "./hooks/useCommunity";
import { useController } from "./hooks/useController";
import { useDeploy } from "./hooks/useDeploy";
import { useHost } from "./hooks/useHost";
import { useUpdate } from "./hooks/useUpdate";
import { buildDiagnosis, type Diagnosis } from "./lib/diagnosis";
import { markOnboardingDone, shouldShowOnboarding } from "./lib/onboarding";
import type { AppInfo, Settings, SettingsPatch, Toast, ToastKind } from "./types";

import { t, tf } from "./i18n";


const EMPTY_DIAGNOSIS: Diagnosis = {
  issues: [],
  context: "",
  suggestions: [],
  headline: t("当前状态正常"),
};

type Tab = "host" | "control" | "server" | "shared" | "community";

function readSmokeParams(): {
  code: string;
  key: string;
  deviceId: string;
  deviceName: string;
} {
  if (!window.remote.smoke) return { code: "", key: "", deviceId: "", deviceName: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code") ?? "",
    key: params.get("key") ?? "",
    deviceId: params.get("smokeDevice") ?? "",
    deviceName: params.get("smokeName") ?? "",
  };
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => (readSmokeParams().code ? "control" : "host"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSeed, setAssistantSeed] = useState<{ id: number; question: string } | null>(
    null,
  );
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [smokeParams] = useState(readSmokeParams);
  // Smoke runs two windows in one Electron instance; a query-scoped device
  // identity lets the same server see them as distinct members.
  const activeSettings = useMemo<Settings | null>(() => {
    if (!settings || !smokeParams.deviceId) return settings;
    return {
      ...settings,
      deviceId: smokeParams.deviceId,
      deviceName: smokeParams.deviceName || "Smoke Client",
    };
  }, [settings, smokeParams.deviceId, smokeParams.deviceName]);

  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map<number, number>());
  const assistantSeedSeq = useRef(0);
  const onboardingChecked = useRef(false);
  const updateNotified = useRef("");
  const assistant = useAssistant();
  const community = useCommunity();
  const update = useUpdate();

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = toastSeq.current + 1;
      toastSeq.current = id;
      // 主进程返回的提示直接是中文，这里统一再过一次词典。
      setToasts((list) => [...list.slice(-3), { id, message: t(message), kind }]);
      const timer = window.setTimeout(() => {
        toastTimers.current.delete(id);
        setToasts((list) => list.filter((toast) => toast.id !== id));
      }, 4200);
      toastTimers.current.set(id, timer);
    },
    [],
  );

  const host = useHost(activeSettings, appInfo, notify);
  const controller = useController(activeSettings, appInfo, notify);
  const catalogEnabled =
    tab === "control" && (controller.phase === "idle" || controller.phase === "error");
  const catalog = useCatalog(activeSettings, appInfo, catalogEnabled, notify, (peer, token) => {
    void controller.connectWithToken(peer, token);
  });
  const deploy = useDeploy({
    notify,
    onDone: async () => {
      try {
        const stored = await window.remote.getSettings();
        setSettings(stored);
      } catch (error) {
        notify(error instanceof Error ? error.message : t("读取新的服务器配置失败"), "error");
      }
    },
  });

  const diagnosis = useMemo(
    () =>
      activeSettings
        ? buildDiagnosis({
            appInfo,
            settings: activeSettings,
            host: {
              phase: host.phase,
              error: host.error,
              accessIssue: host.accessIssue,
              hasSession: Boolean(host.session),
            },
            controller: {
              phase: controller.phase,
              error: controller.error,
              accessIssue: controller.accessIssue,
            },
            deploy: {
              phase: deploy.phase,
              error: deploy.error,
              steps: deploy.steps,
            },
          })
        : EMPTY_DIAGNOSIS,
    [
      appInfo,
      activeSettings,
      host.phase,
      host.error,
      host.accessIssue,
      host.session,
      controller.phase,
      controller.error,
      controller.accessIssue,
      deploy.phase,
      deploy.error,
      deploy.steps,
    ],
  );

  const openAssistant = useCallback((question = "") => {
    assistantSeedSeq.current += 1;
    setAssistantSeed({ id: assistantSeedSeq.current, question });
    setAssistantOpen(true);
  }, []);

  const openGuide = useCallback(() => {
    setAssistantOpen(false);
    setHelpOpen(true);
  }, []);

  const closeOnboarding = useCallback(() => {
    markOnboardingDone();
    setOnboardingOpen(false);
  }, []);

  const openGuideFromOnboarding = useCallback(() => {
    markOnboardingDone();
    setOnboardingOpen(false);
    setHelpOpen(true);
  }, []);

  useEffect(() => {
    if (!settings || !appInfo || onboardingChecked.current) return;
    onboardingChecked.current = true;
    if (window.remote.smoke && !new URLSearchParams(window.location.search).has("onboarding")) {
      return;
    }
    if (shouldShowOnboarding()) setOnboardingOpen(true);
  }, [settings, appInfo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, stored] = await Promise.all([
          window.remote.appInfo(),
          window.remote.getSettings(),
        ]);
        if (cancelled) return;
        setAppInfo(info);
        setSettings(stored);
      } catch (error) {
        if (cancelled) return;
        setBootError(error instanceof Error ? error.message : t("客户端初始化失败"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const sessionId = host.session?.sessionId ?? null;
  useEffect(() => {
    if (sessionId && host.session) {
      notify(tf("“{0}”已接入本机", host.session.controllerName), "info");
    }
  }, [sessionId]);

  const updatePhase = update.status?.phase;
  const updateVersion = update.status?.release?.version ?? "";
  useEffect(() => {
    if (!updateVersion) return;
    if (updatePhase === "available" && updateNotified.current !== `available:${updateVersion}`) {
      updateNotified.current = `available:${updateVersion}`;
      notify(tf("发现新版本 v{0}，点右上角版本号查看", updateVersion), "info");
    }
    if (updatePhase === "ready" && updateNotified.current !== `ready:${updateVersion}`) {
      updateNotified.current = `ready:${updateVersion}`;
      notify(tf("新版本 v{0} 已下载，退出应用时自动安装", updateVersion), "success");
    }
  }, [updatePhase, updateVersion, notify]);

  async function saveSettings(
    patch: SettingsPatch,
    message = t("设置已保存"),
  ): Promise<void> {
    const hostActive = host.phase === "online" || host.phase === "connecting" || host.phase === "pending";
    const controlling = controller.phase !== "idle" && controller.phase !== "error";
    const next = await window.remote.updateSettings(patch);
    if (hostActive) host.stop();
    if (controlling) controller.disconnect();
    setSettings(next);
    notify(message, "success");
  }

  async function useSharedServer(
    url: string,
    inviteCode: string,
    name: string,
  ): Promise<void> {
    const hostActive =
      host.phase === "online" || host.phase === "connecting" || host.phase === "pending";
    const controlling = controller.phase !== "idle" && controller.phase !== "error";
    if (
      (hostActive || controlling) &&
      !window.confirm(t("切换服务器会断开当前连接，确定继续吗？"))
    ) {
      return;
    }
    await saveSettings(
      { serverUrl: url, inviteCode },
      tf("已填入「{0}」的服务器地址和邀请码，输入远控码即可连接", name),
    );
    setTab("control");
  }

  async function applyInvite(code: string): Promise<void> {
    const next = await window.remote.updateSettings({ inviteCode: code });
    setSettings(next);
    notify(t("邀请码已填入，可在「本机被控」页开启启动自动被控"), "success");
  }

  async function updatePreference(patch: SettingsPatch, message: string): Promise<void> {
    try {
      const next = await window.remote.updateSettings(patch);
      setSettings(next);
      notify(message, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : t("保存启动偏好失败"), "error");
    }
  }

  if (!settings) {
    return (
      <div className="boot-screen">
        <span className="brand-mark large">
          <LinkIcon size={28} />
        </span>
        {bootError ? (
          <>
            <h1>{t("客户端未能启动")}</h1>
            <p className="boot-error">{bootError}</p>
            <button
              type="button"
              className="button primary"
              onClick={() => window.location.reload()}
            >
              {t("重新启动")}
            </button>
          </>
        ) : (
          <>
            <span className="spinner large" />
            <p>{t("正在准备安全连接…")}</p>
          </>
        )}
      </div>
    );
  }

  const controlInSession =
    tab === "control" &&
    (controller.phase === "connected" ||
      (controller.phase === "connecting" && controller.stream !== null));

  return (
    <div className={`app-shell${controlInSession ? " in-session" : ""}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <LinkIcon size={22} />
          </span>
          <div className="brand-copy">
            <span className="brand-name">{t("若道远程")}</span>
            <span className="brand-sub">{t("免注册 · 远控码直连")}</span>
          </div>
        </div>

        <nav className="mode-tabs" aria-label={t("使用模式")}>
          <button
            type="button"
            data-testid="tab-host"
            className={`mode-tab${tab === "host" ? " active" : ""}`}
            onClick={() => setTab("host")}
          >
            <MonitorIcon size={16} />
            {t("本机被控")}
            {host.session && <span className="tab-dot" aria-label={t("会话进行中")} />}
          </button>
          <button
            type="button"
            data-testid="tab-control"
            className={`mode-tab${tab === "control" ? " active" : ""}`}
            onClick={() => setTab("control")}
          >
            <MousePointerIcon size={16} />
            {t("控制远程设备")}
            {controller.phase === "connected" && (
              <span className="tab-dot" aria-label={t("会话进行中")} />
            )}
          </button>
          <button
            type="button"
            data-testid="tab-server"
            className={`mode-tab${tab === "server" ? " active" : ""}`}
            onClick={() => setTab("server")}
          >
            <ServerIcon size={16} />
            {t("服务端")}
            {settings.adminReady && <span className="tab-dot" aria-label={t("已保存管理员密码")} />}
          </button>
          <button
            type="button"
            data-testid="tab-shared"
            className={`mode-tab${tab === "shared" ? " active" : ""}`}
            onClick={() => setTab("shared")}
          >
            <GlobeIcon size={16} />
            {t("共享服务器")}
          </button>
          <button
            type="button"
            data-testid="tab-community"
            className={`mode-tab${tab === "community" ? " active" : ""}`}
            onClick={() => setTab("community")}
          >
            <ChatIcon size={16} />
            {t("社区留言")}
          </button>
        </nav>

        <div className="header-right">
          <div className="header-help">
            <button
              type="button"
              className="header-action"
              data-testid="open-help"
              onClick={openGuide}
              title={t("使用指南")}
            >
              <HelpIcon size={17} />
              <span>{t("使用指南")}</span>
            </button>
            <button
              type="button"
              className="header-action ai"
              data-testid="open-assistant"
              onClick={() => openAssistant()}
              title={t("问 AI")}
            >
              <SparkIcon size={17} />
              <span>{t("问 AI")}</span>
            </button>
          </div>
          <button
            type="button"
            className={`version-pill version-button${
              updatePhase === "available" || updatePhase === "downloading" || updatePhase === "ready"
                ? " has-update"
                : ""
            }`}
            data-testid="open-update"
            title={
              updatePhase === "available" || updatePhase === "ready"
                ? tf("新版本 v{0} 可用", updateVersion)
                : t("查看软件更新")
            }
            onClick={() => setUpdateOpen(true)}
          >
            v{appInfo?.version ?? "0.1.0"}
            {(updatePhase === "available" ||
              updatePhase === "downloading" ||
              updatePhase === "ready") && <span className="version-dot" />}
          </button>
          <button
            type="button"
            className="icon-button"
            data-testid="open-settings"
            aria-label={t("打开设置")}
            title={t("设置")}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      <main className="app-main">
        {tab === "host" ? (
          <HostPanel
            phase={host.phase}
            code={host.code}
            accessKey={host.accessKey}
            keyVisible={host.keyVisible}
            keyPersisted={host.keyPersisted}
            session={host.session}
            preview={host.preview}
            error={host.error}
            accessIssue={host.accessIssue}
            busy={host.busy}
            identityReady={host.identityReady}
            inputPaused={host.inputPaused}
            clipboardAllowed={host.clipboardAllowed}
            chatMessages={host.chatMessages}
            published={host.published}
            publishNote={host.publishNote}
            publishBusy={host.publishBusy}
            requests={host.requests}
            settings={activeSettings ?? settings}
            autoStartHost={settings.autoStartHost}
            launchAtLogin={settings.launchAtLogin}
            onStart={() => void host.start()}
            onStop={host.stop}
            onRotateKey={() => void host.rotateKey()}
            onToggleKey={host.toggleKeyVisible}
            onTogglePause={host.toggleInputPause}
            onToggleClipboard={host.toggleClipboard}
            onToggleAutoStart={(value) =>
              void updatePreference(
                { autoStartHost: value },
                value ? t("已开启：下次启动会自动开始被控") : t("已关闭启动自动被控"),
              )
            }
            onToggleLaunchAtLogin={(value) =>
              void updatePreference(
                { launchAtLogin: value },
                value ? t("已开启开机自动启动") : t("已关闭开机自动启动"),
              )
            }
            onSendChat={host.sendChat}
            onSetPublish={host.setPublish}
            onDecideRequest={host.decideRequest}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGuide={openGuide}
            onAskAi={openAssistant}
          />
        ) : tab === "control" ? (
          <ControlPanel
            phase={controller.phase}
            hostName={controller.hostName}
            error={controller.error}
            accessIssue={controller.accessIssue}
            stream={controller.stream}
            stats={controller.stats}
            serverStats={controller.serverStats}
            sessionEndsAt={controller.sessionEndsAt}
            channelReady={controller.channelReady}
            inputPaused={controller.inputPaused}
            clipboardAllowed={controller.clipboardAllowed}
            clipboardEnabled={controller.clipboardEnabled}
            quality={controller.quality}
            chatMessages={controller.chatMessages}
            settings={activeSettings ?? settings}
            catalogHosts={catalog.hosts}
            catalogStatus={catalog.status}
            catalogError={catalog.error}
            catalogRequest={catalog.request}
            initialCode={smokeParams.code}
            initialKey={smokeParams.key}
            onConnect={(code, key) => void controller.connect(code, key)}
            onDisconnect={controller.disconnect}
            sendInput={controller.sendInput}
            onDangerShortcut={controller.noteDangerShortcut}
            onToggleClipboard={() => controller.setClipboardSync(!controller.clipboardEnabled)}
            onChangeQuality={controller.changeQuality}
            onSendChat={controller.sendChat}
            onRequestHost={catalog.requestControl}
            onCancelRequest={catalog.cancelRequest}
            onRefreshCatalog={catalog.refresh}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGuide={openGuide}
            onAskAi={openAssistant}
          />
        ) : tab === "server" ? (
          <ServerPanel
            settings={settings}
            clientVersion={appInfo?.version ?? null}
            clientUpdate={update.status}
            notify={notify}
            onApplyInvite={applyInvite}
            onUseServer={(url) => saveSettings({ serverUrl: url })}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenDeploy={() => setDeployOpen(true)}
            onOpenGuide={openGuide}
            onAskAi={() => openAssistant()}
            onOpenClientUpdate={() => setUpdateOpen(true)}
          />
        ) : tab === "shared" ? (
          <SharedServersPanel
            settings={settings}
            assistant={assistant}
            onUseServer={useSharedServer}
            notify={notify}
          />
        ) : (
          <CommunityPanel assistant={assistant} community={community} />
        )}
      </main>

      <footer className="app-foot">
        <span>{t("若道远程 · 自建信令 · 无账号模式")}</span>
        <span className="foot-sep" />
        <span>{t("当前系统：")}{appInfo?.inputAvailable ? t("支持输入控制") : t("仅观看画面")}</span>
        <span className="foot-sep" />
        <button type="button" className="foot-link" onClick={openGuide}>
          {t("使用指南")}
        </button>
        <span className="foot-sep" />
        <button type="button" className="foot-link ai" onClick={() => openAssistant()}>
          {t("问 AI")}
        </button>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        appInfo={appInfo}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onOpenGuide={openGuide}
        onAskAi={() => openAssistant()}
      />

      <UpdateDialog
        open={updateOpen}
        status={update.status}
        busy={update.busy}
        actionError={update.actionError}
        onClose={() => setUpdateOpen(false)}
        onCheck={() => void update.check()}
        onDownload={() => void update.download()}
        onInstall={() => void update.install()}
        onToggleAuto={(enabled) => void update.setAuto(enabled)}
        onOpenFolder={() => void update.openFolder()}
      />

      <DeployWizard
        open={deployOpen}
        deploy={deploy}
        onClose={() => setDeployOpen(false)}
        onAskAi={openAssistant}
        onOpenGuide={openGuide}
      />

      <HelpCenter
        open={helpOpen}
        diagnosis={diagnosis}
        onClose={() => setHelpOpen(false)}
        onAskAi={(question) => openAssistant(question ?? "")}
        onReplayOnboarding={() => {
          setHelpOpen(false);
          setOnboardingOpen(true);
        }}
        onOpenDeploy={() => {
          setHelpOpen(false);
          setDeployOpen(true);
        }}
      />

      <AssistantDialog
        open={assistantOpen}
        assistant={assistant}
        diagnosis={diagnosis}
        seed={assistantSeed}
        onClose={() => setAssistantOpen(false)}
        onOpenGuide={openGuide}
      />

      <OnboardingDialog
        open={onboardingOpen}
        onClose={closeOnboarding}
        onOpenGuide={openGuideFromOnboarding}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
