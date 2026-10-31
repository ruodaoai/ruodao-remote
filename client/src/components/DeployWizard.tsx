import { useEffect, useMemo, useRef, useState } from "react";
import type { DeployConfig, DeployStepStatus, RegistrationMode } from "../types";
import type { DeployController } from "../hooks/useDeploy";
import { deployQuestion } from "../lib/diagnosis";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  LockIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "./icons";
import { CopyButton, InlineAlert } from "./ui";

interface DeployWizardProps {
  open: boolean;
  deploy: DeployController;
  onClose: () => void;
  onAskAi?: (question: string) => void;
  onOpenGuide?: () => void;
}

const MODE_OPTIONS: { value: RegistrationMode; label: string; hint: string }[] = [
  { value: "invite", label: "邀请制", hint: "朋友凭邀请码接入，适合对外分享" },
  { value: "approval", label: "审核制", hint: "新客户端需管理员批准后才能远控" },
  { value: "open", label: "开放接入", hint: "拿到地址即可接入，仅建议内网使用" },
];

const STEP_ICON: Record<DeployStepStatus, "check" | "alert" | "dot" | "skip"> = {
  success: "check",
  error: "alert",
  running: "dot",
  pending: "dot",
  skipped: "skip",
};

export function DeployWizard({
  open,
  deploy,
  onClose,
  onAskAi,
  onOpenGuide,
}: DeployWizardProps) {
  const [host, setHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [domain, setDomain] = useState("");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("invite");
  const [installTurn, setInstallTurn] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(true);
  const logRef = useRef<HTMLDivElement | null>(null);

  const running = deploy.phase === "running";
  const totalSteps = deploy.steps.length || 11;
  const doneCount = deploy.steps.filter(
    (step) => step.status === "success" || step.status === "skipped",
  ).length;
  const activeStep = deploy.steps.find((step) => step.status === "running");
  const fingerprintError = Boolean(deploy.error && deploy.error.includes("指纹"));
  const result = deploy.result;
  const publicTcpPorts = result
    ? Array.from(new Set([result.publicPort, result.redirectPort].filter((port) => port > 0)))
    : [];
  const securityGroupPorts = result
    ? [
        `TCP ${publicTcpPorts.join("、")}`,
        ...(result.turn && result.turnPort > 0 ? [`TCP/UDP ${result.turnPort}`] : []),
        ...(result.turn && result.relayMin > 0
          ? [`UDP ${result.relayMin}-${result.relayMax}`]
          : []),
      ].join("、")
    : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && deploy.phase !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, deploy.phase, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !logsOpen) return;
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, logsOpen, deploy.logs.length]);

  const logs = useMemo(() => deploy.logs.slice(-300), [deploy.logs]);

  function readConfig(): DeployConfig | null {
    const hostValue = host.trim();
    const portValue = Number(sshPort);
    const userValue = username.trim();
    if (!hostValue) {
      setFormError("请填写服务器 IP 或域名。");
      return null;
    }
    if (!/^[A-Za-z0-9.:_-]+$/.test(hostValue)) {
      setFormError("服务器地址格式不正确，请填写 IPv4 地址或域名。");
      return null;
    }
    if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
      setFormError("SSH 端口需要在 1 到 65535 之间。");
      return null;
    }
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(userValue)) {
      setFormError("SSH 用户名格式不正确。");
      return null;
    }
    if (authMode === "password" && !password) {
      setFormError("请填写 SSH 密码，或切换到 SSH 私钥登录。");
      return null;
    }
    if (authMode === "key" && !privateKeyPath.trim()) {
      setFormError("请选择 SSH 私钥文件。");
      return null;
    }
    const domainValue = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (domainValue && (!/^[A-Za-z0-9.-]+$/.test(domainValue) || !domainValue.includes("."))) {
      setFormError("域名格式不正确，例如 remote.example.com。");
      return null;
    }
    setFormError(null);
    return {
      host: hostValue,
      sshPort: portValue,
      username: userValue,
      password: authMode === "password" ? password : "",
      privateKeyPath: authMode === "key" ? privateKeyPath.trim() : "",
      passphrase: authMode === "key" ? passphrase : "",
      domain: domainValue.toLowerCase(),
      registrationMode,
      installTurn,
    };
  }

  function submit(): void {
    const config = readConfig();
    if (!config) return;
    void deploy.start(config);
  }

  async function pickKey(): Promise<void> {
    try {
      const picked = await window.remote.pickDeployKey();
      if (picked) setPrivateKeyPath(picked);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "无法打开文件选择器。");
    }
  }

  function close(): void {
    if (running) return;
    if (deploy.phase === "done") {
      deploy.reset();
      setPassword("");
      setPassphrase("");
    }
    onClose();
  }

  function backToForm(): void {
    deploy.reset();
    setFormError(null);
  }

  if (!open) return null;

  const title =
    deploy.phase === "done"
      ? "部署完成"
      : deploy.phase === "error"
        ? "部署未完成"
        : running
          ? "正在部署服务端"
          : "一键部署服务端";

  return (
    <div
      className="deploy-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) close();
      }}
    >
      <div
        className="deploy-modal"
        role="dialog"
        aria-modal="true"
        aria-label="一键部署服务端"
        data-testid="deploy-wizard"
      >
        <header className="deploy-head">
          <div className="deploy-head-main">
            <span className="deploy-head-icon">
              <ServerIcon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <span>在 Linux 云服务器上安装若道远程 · Node.js + Caddy + TURN</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={close}
            disabled={running}
          >
            <XIcon size={18} />
          </button>
        </header>

        {running && (
          <div className="deploy-progress-bar">
            <span style={{ width: `${Math.round((doneCount / totalSteps) * 100)}%` }} />
          </div>
        )}

        <div className="deploy-body">
          {deploy.phase === "idle" && (
            <>
              <div className="deploy-callout">
                <ServerIcon size={16} />
                <div>
                  <strong>新服务器或已有网站都能安装</strong>
                  <span>
                    推荐 Ubuntu 22.04+ / Debian 12+，支持 root 或带 sudo 的账号。安装会占用约
                    200MB 磁盘，不会改动 SSH 配置，也不会停止 nginx、宝塔等现有服务。
                  </span>
                </div>
              </div>

              <div className="deploy-preflight">
                <div className="deploy-preflight-head">
                  <span>
                    <ShieldIcon size={16} />
                  </span>
                  <div>
                    <strong>部署前检查</strong>
                    <small>满足这些条件，安装成功率更高</small>
                  </div>
                </div>
                <ul>
                  <li>
                    <CheckIcon size={13} /> Ubuntu 22.04+ / Debian 12+，root 或带 sudo 的账号
                  </li>
                  <li>
                    <CheckIcon size={13} /> 无需域名：只填 IP 时会自动使用 sslip.io 免费域名申请 HTTPS
                  </li>
                  <li>
                    <CheckIcon size={13} /> 云安全组先放行 SSH 端口；部署完成后按结果页提示放行实际端口
                  </li>
                  <li>
                    <CheckIcon size={13} /> 始终启用免费 HTTPS，业务入口使用非标准端口并隐藏管理路径
                  </li>
                </ul>
                <div className="deploy-preflight-actions">
                  {onOpenGuide && (
                    <button type="button" className="text-button" onClick={onOpenGuide}>
                      查看部署指南
                    </button>
                  )}
                  {onAskAi && (
                    <button
                      type="button"
                      className="text-button ai"
                      onClick={() =>
                        onAskAi(
                          "我准备在一台服务器上部署若道远程服务端，服务器上可能已经有 nginx、宝塔或其他网站服务。请说明安装器会怎样避开已占用端口、哪些现有服务不会被改动，以及我需要提前检查什么。",
                        )
                      }
                    >
                      <SparkIcon size={13} />
                      问 AI
                    </button>
                  )}
                </div>
              </div>

              <section className="deploy-section">
                <div className="deploy-section-head">
                  <h3>服务器连接</h3>
                  <span>SSH 密码只用于本次安装，不会保存在本机</span>
                </div>
                <div className="deploy-grid">
                  <label className="field deploy-span-2">
                    <div className="field-label">
                      <span>服务器 IP 或域名</span>
                    </div>
                    <div className="input-shell">
                      <ServerIcon size={17} />
                      <input
                        value={host}
                        onChange={(event) => setHost(event.target.value)}
                        placeholder="例如 203.0.113.10"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <div className="field-label">
                      <span>SSH 端口</span>
                      <span className="field-hint">默认 22，建议改为非标准端口</span>
                    </div>
                    <div className="input-shell">
                      <LockIcon size={17} />
                      <input
                        value={sshPort}
                        onChange={(event) => setSshPort(event.target.value)}
                        inputMode="numeric"
                        placeholder="22"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <div className="field-label">
                      <span>登录账号</span>
                    </div>
                    <div className="input-shell">
                      <ShieldIcon size={17} />
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="root"
                        autoComplete="username"
                        spellCheck={false}
                      />
                    </div>
                  </label>
                </div>

                <div className="deploy-auth-toggle" role="tablist" aria-label="SSH 登录方式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === "password"}
                    className={authMode === "password" ? "active" : ""}
                    onClick={() => setAuthMode("password")}
                  >
                    密码登录
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === "key"}
                    className={authMode === "key" ? "active" : ""}
                    onClick={() => setAuthMode("key")}
                  >
                    SSH 私钥
                  </button>
                </div>

                {authMode === "password" ? (
                  <label className="field">
                    <div className="field-label">
                      <span>SSH 密码</span>
                    </div>
                    <div className="input-shell">
                      <LockIcon size={17} />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="服务器登录密码"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      >
                        {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                      </button>
                    </div>
                  </label>
                ) : (
                  <div className="deploy-key-block">
                    <label className="field">
                      <div className="field-label">
                        <span>私钥文件</span>
                      </div>
                      <div className="input-shell">
                        <LockIcon size={17} />
                        <input
                          value={privateKeyPath}
                          onChange={(event) => setPrivateKeyPath(event.target.value)}
                          placeholder="C:\\Users\\你\\.ssh\\id_ed25519"
                          spellCheck={false}
                        />
                        <button type="button" className="text-button" onClick={() => void pickKey()}>
                          浏览
                        </button>
                      </div>
                    </label>
                    <label className="field">
                      <div className="field-label">
                        <span>私钥口令</span>
                        <span className="field-hint">可选</span>
                      </div>
                      <div className="input-shell">
                        <LockIcon size={17} />
                        <input
                          type={showPassphrase ? "text" : "password"}
                          value={passphrase}
                          onChange={(event) => setPassphrase(event.target.value)}
                          placeholder="私钥未设置口令时留空"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="input-action"
                          onClick={() => setShowPassphrase((value) => !value)}
                          aria-label={showPassphrase ? "隐藏口令" : "显示口令"}
                        >
                          {showPassphrase ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                        </button>
                      </div>
                    </label>
                  </div>
                )}
              </section>

              <section className="deploy-section">
                <div className="deploy-section-head">
                  <h3>域名与 HTTPS</h3>
                  <span>始终启用，Let's Encrypt 免费证书</span>
                </div>
                <label className="field">
                  <div className="field-label">
                    <span>自有域名</span>
                    <span className="field-hint">可选，不填也能用 HTTPS</span>
                  </div>
                  <div className="input-shell">
                    <LinkIcon size={17} />
                    <input
                      value={domain}
                      onChange={(event) => setDomain(event.target.value)}
                      placeholder="remote.example.com"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </label>
                <p className="deploy-hint">
                  填写自有域名时，请先把 A 记录指向服务器 IP。不填域名时，安装器会用
                  sslip.io 自动生成免费域名并签发 Let's Encrypt 证书。HTTPS
                  业务入口使用随机非标准端口，管理后台使用随机隐藏路径；TCP 80 只用于证书验证与跳转。
                </p>
              </section>

              <section className="deploy-section">
                <div className="deploy-section-head">
                  <h3>新客户端接入方式</h3>
                  <span>部署完成后可在服务端设置中修改</span>
                </div>
                <div className="deploy-mode-grid">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`deploy-mode${registrationMode === option.value ? " active" : ""}`}
                      onClick={() => setRegistrationMode(option.value)}
                    >
                      <span className="deploy-mode-mark">
                        {registrationMode === option.value && <CheckIcon size={12} />}
                      </span>
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </button>
                  ))}
                </div>
              </section>

              <label className="deploy-check">
                <input
                  type="checkbox"
                  checked={installTurn}
                  onChange={(event) => setInstallTurn(event.target.checked)}
                />
                <div>
                  <strong>安装 TURN 中转（推荐）</strong>
                  <span>
                    跨运营商或严格 NAT 环境下，音视频会通过 TURN 中继。安装器会自动挑选空闲端口；如果服务器上已有其他
                    TURN 配置或实例，会跳过且不做任何修改。
                  </span>
                </div>
              </label>

              <div className="deploy-security">
                <ShieldIcon size={15} />
                <span>
                  安装过程约 3-8 分钟。会安装 Node.js、独立 Caddy、fail2ban，写入
                  /opt/ruodao 与 systemd 服务，不覆盖 /etc/caddy
                  或其他站点配置，并生成只保存在本机的管理员密码、隐藏管理路径与健康令牌。
                </span>
              </div>

              {formError && <InlineAlert>{formError}</InlineAlert>}
            </>
          )}

          {running && (
            <>
              {deploy.hostKey && (
                <div className="deploy-hostkey" role="alert">
                  <div className="deploy-hostkey-head">
                    <span className="deploy-hostkey-icon">
                      <ShieldIcon size={18} />
                    </span>
                    <div>
                      <strong>首次连接这台服务器</strong>
                      <span>
                        请确认下方指纹与云服务商控制台或服务器记录一致，再信任该服务器。
                      </span>
                    </div>
                  </div>
                  <code>{deploy.hostKey.fingerprint}</code>
                  <div className="deploy-hostkey-meta">
                    主机 {deploy.hostKey.host}:{deploy.hostKey.port}
                  </div>
                  <div className="deploy-hostkey-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void deploy.confirmHostKey(false)}
                    >
                      取消部署
                    </button>
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() => void deploy.confirmHostKey(true)}
                      disabled={!deploy.runId}
                    >
                      信任并继续
                    </button>
                  </div>
                </div>
              )}

              <ol className="deploy-steps">
                {deploy.steps.map((step, index) => (
                  <li key={step.id} className={`deploy-step status-${step.status}`}>
                    <span className="deploy-step-mark">
                      {STEP_ICON[step.status] === "check" ? (
                        <CheckIcon size={13} />
                      ) : STEP_ICON[step.status] === "alert" ? (
                        <AlertIcon size={13} />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </span>
                    <div className="deploy-step-main">
                      <div className="deploy-step-title">
                        <strong>{step.title}</strong>
                        {step.status === "running" && <span className="spinner small" />}
                        {step.status === "skipped" && <span className="deploy-step-tag">已跳过</span>}
                      </div>
                      <span>{step.note || step.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="deploy-log">
                <div className="deploy-log-head">
                  <span>安装日志</span>
                  <button type="button" className="text-button" onClick={() => setLogsOpen((v) => !v)}>
                    {logsOpen ? "收起" : "展开"}
                  </button>
                </div>
                {logsOpen && (
                  <div className="deploy-log-body" ref={logRef}>
                    {logs.length === 0 ? (
                      <span className="deploy-log-empty">等待服务器响应…</span>
                    ) : (
                      logs.map((entry, index) => (
                        <span
                          key={`${index}-${entry.line}`}
                          className={entry.stream === "stderr" ? "log-error" : undefined}
                        >
                          {entry.line}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {deploy.phase === "done" && deploy.result && (
            <>
              <div className="deploy-success">
                <span className="deploy-success-icon">
                  <CheckIcon size={20} />
                </span>
                <div>
                  <strong>服务端已部署完成</strong>
                  <span>{deploy.result.serverUrl}</span>
                </div>
              </div>
              <div className="deploy-badges">
                <span className="good">HTTPS 已启用</span>
                <span>
                  入口 TCP {deploy.result.publicPort}
                  {deploy.result.publicPort === 443 ? "" : "（非标准端口）"}
                </span>
                <span>
                  {deploy.result.redirectPort
                    ? `TCP ${deploy.result.redirectPort} · 证书验证与跳转`
                    : "TCP 443 · TLS-ALPN 验证"}
                </span>
                <span className={deploy.result.turn ? "good" : "warn"}>
                  {deploy.result.turn ? `TURN ${deploy.result.turnPort}` : "未启用 TURN"}
                </span>
                <span className="good">隐藏管理入口</span>
                <span className="good">自动更新已开启</span>
                {deploy.result.version && <span>服务端 v{deploy.result.version}</span>}
              </div>

              <div className="deploy-result-card">
                <div className="deploy-secret-row">
                  <span>服务器地址</span>
                  <code>{deploy.result.serverUrl}</code>
                  <CopyButton value={deploy.result.serverUrl} label="复制服务器地址" />
                </div>
                <div className="deploy-secret-row">
                  <span>管理后台</span>
                  <code>{`${deploy.result.serverUrl}${deploy.result.adminPath}`}</code>
                  <CopyButton
                    value={`${deploy.result.serverUrl}${deploy.result.adminPath}`}
                    label="复制管理后台地址"
                  />
                </div>
                <div className="deploy-secret-row">
                  <span>管理员密码</span>
                  <code>{deploy.result.adminPassword}</code>
                  <CopyButton value={deploy.result.adminPassword} label="复制管理员密码" />
                </div>
                <p>
                  {deploy.result.adminPersisted
                    ? "管理员密码已加密保存在本机，下次会自动登录。"
                    : "系统加密存储不可用，管理员密码未保存，请立即复制留存。"}
                  {deploy.result.reusedPassword ? "（复用了这台服务器原有的管理员密码）" : ""}
                </p>
              </div>

              {deploy.result.inviteCode && (
                <div className="deploy-invite">
                  <div>
                    <strong>默认邀请码</strong>
                    <span>有效期 7 天 · 最多 20 次 · 可随时撤销</span>
                  </div>
                  <code>{deploy.result.inviteCode}</code>
                  <CopyButton value={deploy.result.inviteCode} label="复制邀请码" />
                </div>
              )}

              {deploy.result.registrationMode === "approval" && (
                <InlineAlert kind="info">
                  当前为审核制：本机和其他新客户端会先出现在“待批准”列表，在设备页允许后才能被远控。
                </InlineAlert>
              )}
              {deploy.result.registrationMode === "open" && (
                <InlineAlert kind="info">
                  当前为开放接入：任何拿到服务器地址的人都能接入。对外开放前建议切换为邀请制或审核制。
                </InlineAlert>
              )}

              {deploy.result.publicPort !== 443 && (
                <InlineAlert kind="info">
                  {`HTTPS 业务入口使用非标准端口 TCP ${deploy.result.publicPort}，TCP ${deploy.result.redirectPort || 80} 仅用于证书验证与跳转。请确保云安全组放行这两个 TCP 端口。`}
                </InlineAlert>
              )}
              {deploy.result.redirectPort === 0 && (
                <InlineAlert kind="info">
                  80 端口属于服务器上的其他服务，本次 HTTPS 只监听 443，没有接管 80。证书通过
                  TLS-ALPN 验证，请确保云安全组放行 TCP 443。
                </InlineAlert>
              )}

              <div className="deploy-next">
                <strong>下一步</strong>
                <ul>
                  <li>在“服务端”页查看在线设备，决定是否允许对方远控。</li>
                  {deploy.result.registrationMode === "invite" && (
                    <li>把服务器地址与邀请码告诉朋友，他们填写后即可用远控码连接。</li>
                  )}
                  {deploy.result.registrationMode === "approval" && (
                    <li>把服务器地址告诉朋友，他们提交接入申请后，你在“服务端”页批准。</li>
                  )}
                  {deploy.result.registrationMode === "open" && (
                    <li>把服务器地址告诉朋友即可接入；对外开放前建议切换为邀请制或审核制。</li>
                  )}
                  <li>
                    需要长期被控：在「本机被控」页开启「启动后自动被控」，之后每次打开应用都会自动上线。
                  </li>
                  <li>
                    {`云服务商安全组通常还需放行 ${securityGroupPorts}，否则公网访问或 TURN 中转会失败。`}
                  </li>
                  <li>
                    已安装系统级更新服务：每小时检查服务端新版本，无远控会话时自动安装并重启，失败会自动回滚。客户端更新在「设置 → 检查更新」中随时可查。
                  </li>
                </ul>
              </div>
            </>
          )}

          {deploy.phase === "error" && (
            <>
              <InlineAlert>{deploy.error ?? "部署失败，请重试。"}</InlineAlert>
              {onAskAi && (
                <div className="deploy-error-ai">
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => onAskAi(deployQuestion(deploy.error, deploy.steps))}
                  >
                    <SparkIcon size={15} />
                    让 AI 分析这次失败
                  </button>
                  <span>AI 会结合失败的步骤和错误信息给出排查顺序，不会发送 SSH 密码。</span>
                </div>
              )}
              <div className="deploy-error-tips">
                <strong>排查建议</strong>
                <ul>
                  <li>确认服务器 IP、SSH 端口、账号密码正确，且安全组已放行 SSH 端口。</li>
                  <li>如果填写了域名，请确认 A 记录已指向这台服务器并已生效。</li>
                  <li>
                    安装器会自动避开已占用端口，不会停止 nginx、宝塔等现有服务；放行云安全组时请以日志中实际选择的端口为准。
                  </li>
                  <li>
                    免费证书需要通过 TCP 80 或 TCP 443 验证。如果两个端口都被其他服务占用，请先释放其中一个再重试。
                  </li>
                  <li>重试会自动复用已生成的配置，不会重复破坏数据。</li>
                </ul>
              </div>
              <div className="deploy-log">
                <div className="deploy-log-head">
                  <span>安装日志</span>
                  <button type="button" className="text-button" onClick={() => setLogsOpen((v) => !v)}>
                    {logsOpen ? "收起" : "展开"}
                  </button>
                </div>
                {logsOpen && (
                  <div className="deploy-log-body" ref={logRef}>
                    {logs.length === 0 ? (
                      <span className="deploy-log-empty">没有更多日志</span>
                    ) : (
                      logs.map((entry, index) => (
                        <span
                          key={`${index}-${entry.line}`}
                          className={entry.stream === "stderr" ? "log-error" : undefined}
                        >
                          {entry.line}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="deploy-foot">
          {deploy.phase === "idle" && (
            <>
              <span className="deploy-foot-note">
                <ShieldIcon size={14} /> 密码只用于本次 SSH 连接
              </span>
              <button type="button" className="button ghost" onClick={close}>
                取消
              </button>
              <button type="button" className="button primary" onClick={submit}>
                开始一键安装
                <ArrowRightIcon size={16} />
              </button>
            </>
          )}
          {running && (
            <>
              <span className="deploy-foot-note">
                {activeStep ? `正在执行：${activeStep.title}` : "正在准备…"} · 已完成{" "}
                {doneCount}/{deploy.steps.length || 11}
              </span>
              <button type="button" className="button ghost" onClick={() => void deploy.cancel()}>
                取消部署
              </button>
            </>
          )}
          {deploy.phase === "done" && (
            <>
              <span className="deploy-foot-note">
                <CheckIcon size={14} /> 已切换到新的服务器
              </span>
              <button type="button" className="button primary" onClick={close}>
                进入服务端管理
              </button>
            </>
          )}
          {deploy.phase === "error" && (
            <>
              {fingerprintError && (
                <button type="button" className="button ghost" onClick={() => void deploy.forgetHost()}>
                  清除已保存的服务器指纹
                </button>
              )}
              <button type="button" className="button ghost" onClick={backToForm}>
                返回修改
              </button>
              <button type="button" className="button primary" onClick={submit}>
                重新部署
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
