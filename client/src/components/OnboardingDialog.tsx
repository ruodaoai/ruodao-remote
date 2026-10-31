import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  HashIcon,
  LockIcon,
  MonitorIcon,
  MousePointerIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "./icons";

interface OnboardingDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenGuide: () => void;
}

const TOTAL_STEPS = 3;

function StepDots({ step }: { step: number }) {
  return (
    <div className="onboarding-dots" aria-label={`第 ${step + 1} 步，共 ${TOTAL_STEPS} 步`}>
      {Array.from({ length: TOTAL_STEPS }, (_, index) => (
        <span key={index} className={index === step ? "active" : index < step ? "done" : ""} />
      ))}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="onboarding-step">
      <span className="onboarding-art">
        <MonitorIcon size={40} />
        <span className="onboarding-art-link">
          <LockIcon size={18} />
        </span>
      </span>
      <h2>欢迎使用若道远程</h2>
      <p className="onboarding-lead">
        不用注册、不用记密码，一串远控码加一串访问密钥，就能安全地看到并操作另一台电脑。
      </p>
      <div className="onboarding-cards">
        <div className="onboarding-card">
          <span className="onboarding-card-icon">
            <MonitorIcon size={20} />
          </span>
          <strong>本机被控</strong>
          <p>把电脑临时交给可信的人，开始后生成远控码。</p>
        </div>
        <div className="onboarding-card">
          <span className="onboarding-card-icon">
            <MousePointerIcon size={20} />
          </span>
          <strong>远控别人</strong>
          <p>输入对方的远控码和访问密钥，直接操作对方屏幕。</p>
        </div>
        <div className="onboarding-card">
          <span className="onboarding-card-icon">
            <ServerIcon size={20} />
          </span>
          <strong>分享服务</strong>
          <p>部署自己的服务器，用邀请码让朋友接入。</p>
        </div>
      </div>
    </div>
  );
}

function PairStep() {
  return (
    <div className="onboarding-step">
      <h2>远控只需要两串号码</h2>
      <p className="onboarding-lead">
        远控码用来找到设备，访问密钥用来证明你有权连接。两个都正确，才会建立加密画面。
      </p>
      <div className="onboarding-pair">
        <div className="onboarding-pair-code">
          <span>远控码</span>
          <strong>123 456 789</strong>
          <small>9 位数字，每次上线生成</small>
        </div>
        <span className="onboarding-pair-plus">+</span>
        <div className="onboarding-pair-key">
          <span>访问密钥</span>
          <strong>ABCDE 23456</strong>
          <small>10 位字符，只在本机校验</small>
        </div>
      </div>
      <div className="onboarding-ways">
        <div>
          <span className="onboarding-way-icon">
            <MonitorIcon size={19} />
          </span>
          <div>
            <strong>我要被控</strong>
            <p>打开「本机被控」→ 开始被控 → 把两串号码一起发给对方。</p>
          </div>
        </div>
        <div>
          <span className="onboarding-way-icon">
            <MousePointerIcon size={19} />
          </span>
          <div>
            <strong>我要远控</strong>
            <p>打开「控制远程设备」→ 输入对方的两串号码 → 连接。</p>
          </div>
        </div>
      </div>
      <div className="onboarding-note">
        <ShieldIcon size={16} />
        <span>
          访问密钥不会上传服务器；对方点“更换密钥”后，旧密钥立即失效。只把号码发给信任的人。
        </span>
      </div>
    </div>
  );
}

function ShareStep() {
  return (
    <div className="onboarding-step">
      <h2>给朋友提供服务，或让 AI 帮你</h2>
      <p className="onboarding-lead">
        需要让互联网上的朋友接入时，先准备一台服务器；遇到看不懂的提示，随时问 AI。
      </p>
      <div className="onboarding-final-grid">
        <div className="onboarding-final-card">
          <span className="onboarding-card-icon">
            <ServerIcon size={20} />
          </span>
          <strong>三种提供服务的方式</strong>
          <ul>
            <li>
              <CheckIcon size={14} />
              本机一键启动：适合同一局域网
            </li>
            <li>
              <CheckIcon size={14} />
              云服务器一键部署：自动 HTTPS + TURN
            </li>
            <li>
              <CheckIcon size={14} />
              生成邀请码：控制谁能接入
            </li>
          </ul>
          <p>部署完成后，在「服务端」页管理在线客户端和远控权限。</p>
        </div>
        <div className="onboarding-final-card ai">
          <span className="onboarding-card-icon">
            <SparkIcon size={20} />
          </span>
          <strong>看不懂就问 AI</strong>
          <ul>
            <li>
              <SparkIcon size={14} />
              点右上角「问 AI」，登录若道账号
            </li>
            <li>
              <LockIcon size={14} />
              自动附带当前状态，隐藏密钥和密码
            </li>
            <li>
              <BookIcon size={14} />
              回答会给出可以照着做的步骤
            </li>
          </ul>
          <p>AI 回答可能出错，涉及删除数据或开放公网时请先确认。</p>
        </div>
      </div>
      <div className="onboarding-ready">
        <HashIcon size={16} />
        <span>准备好了？建议先打开「使用指南」，按你的目标看一遍对应步骤。</span>
      </div>
    </div>
  );
}

export function OnboardingDialog({ open, onClose, onOpenGuide }: OnboardingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="onboarding-dialog"
      data-testid="onboarding"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="onboarding-shell">
        <header className="onboarding-head">
          <StepDots step={step} />
          <button type="button" className="text-button" onClick={onClose}>
            跳过
          </button>
        </header>

        <div className="onboarding-body">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <PairStep />}
          {step === 2 && <ShareStep />}
        </div>

        <footer className="onboarding-foot">
          <button type="button" className="text-button" onClick={onOpenGuide}>
            <BookIcon size={14} />
            查看完整使用指南
          </button>
          <div className="onboarding-actions">
            {step > 0 && (
              <button type="button" className="button ghost" onClick={() => setStep(step - 1)}>
                上一步
              </button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <button type="button" className="button primary" onClick={() => setStep(step + 1)}>
                下一步
                <ArrowRightIcon size={16} />
              </button>
            ) : (
              <button type="button" className="button primary" onClick={onClose}>
                <CheckIcon size={16} />
                开始使用
              </button>
            )}
          </div>
        </footer>

        <button
          type="button"
          className="icon-button onboarding-close"
          aria-label="关闭新手引导"
          onClick={onClose}
        >
          <XIcon size={17} />
        </button>
      </div>
    </dialog>
  );
}
