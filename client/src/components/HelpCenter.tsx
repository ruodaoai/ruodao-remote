import { useEffect, useMemo, useRef, useState } from "react";
import type { Diagnosis, DiagnosisIssue } from "../lib/diagnosis";
import {
  filterHelpFaqs,
  filterHelpScenarios,
  type HelpFaqItem,
  type HelpScenario,
} from "../lib/help";
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  ChevronDownIcon,
  HelpIcon,
  InfoIcon,
  SearchIcon,
  SparkIcon,
  XIcon,
} from "./icons";

interface HelpCenterProps {
  open: boolean;
  diagnosis: Diagnosis;
  onClose: () => void;
  onAskAi: (question?: string) => void;
  onReplayOnboarding: () => void;
  onOpenDeploy: () => void;
}

type HelpTab = "guide" | "faq" | "trouble";

const SCENARIO_QUESTION: Record<string, string> = {
  host: "我想让别人控制我的电脑，应该怎么操作？",
  control: "我想控制另一台电脑，需要对方提供什么？",
  share: "我想部署服务端并把服务分享给朋友，应该按什么顺序操作？",
  ai: "我不太会用若道远程，请用最简单的步骤告诉我怎么开始。",
};

const TAB_LABELS: Record<HelpTab, string> = {
  guide: "快速上手",
  faq: "常见问题",
  trouble: "故障排查",
};

function ScenarioCard({
  scenario,
  onAskAi,
}: {
  scenario: HelpScenario;
  onAskAi: (question?: string) => void;
}) {
  return (
    <article className="help-scenario">
      <div className="help-scenario-head">
        <span className="help-scenario-badge">{scenario.eyebrow}</span>
        <h3>{scenario.title}</h3>
        <p>{scenario.summary}</p>
      </div>
      <ol className="help-steps">
        {scenario.steps.map((step, index) => (
          <li key={step.title}>
            <span className="help-step-index">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="help-scenario-foot">
        <span>{scenario.note}</span>
        <button
          type="button"
          className="text-button ai"
          onClick={() => onAskAi(SCENARIO_QUESTION[scenario.id])}
        >
          <SparkIcon size={13} />
          问 AI
        </button>
      </div>
    </article>
  );
}

function FaqRow({
  item,
  expanded,
  onToggle,
  onAskAi,
}: {
  item: HelpFaqItem;
  expanded: boolean;
  onToggle: () => void;
  onAskAi: (question?: string) => void;
}) {
  return (
    <div className={`help-faq${expanded ? " open" : ""}`}>
      <button
        type="button"
        className="help-faq-question"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>{item.question}</span>
        <ChevronDownIcon size={16} />
      </button>
      {expanded && (
        <div className="help-faq-answer">
          <p>{item.answer}</p>
          {item.steps && (
            <ol>
              {item.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className="text-button ai"
            onClick={() => onAskAi(`${item.question} 请结合当前状态告诉我具体怎么做。`)}
          >
            <SparkIcon size={13} />
            这个问题问 AI
          </button>
        </div>
      )}
    </div>
  );
}

function issueToneIcon(issue: DiagnosisIssue) {
  if (issue.tone === "error") return <AlertIcon size={17} />;
  if (issue.tone === "warning") return <AlertIcon size={17} />;
  return <InfoIcon size={17} />;
}

export function HelpCenter({
  open,
  diagnosis,
  onClose,
  onAskAi,
  onReplayOnboarding,
  onOpenDeploy,
}: HelpCenterProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<HelpTab>("guide");
  const [query, setQuery] = useState("");
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);

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
    if (!open) return;
    setQuery("");
    setTab("guide");
    setExpandedFaq(null);
  }, [open]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab]);

  const scenarios = useMemo(() => filterHelpScenarios(query), [query]);
  const faqs = useMemo(() => filterHelpFaqs(query), [query]);
  const errorCount = diagnosis.issues.filter((issue) => issue.tone === "error").length;

  function openFaq(id: string): void {
    setTab("faq");
    setQuery("");
    setExpandedFaq(id);
  }

  function askIssue(issue: DiagnosisIssue): void {
    onAskAi(
      `我遇到了「${issue.title}」：${issue.detail}。请结合当前状态判断原因，并给出按顺序的操作步骤。`,
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="help-dialog"
      data-testid="help-center"
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
      <div className="help-shell">
        <header className="help-head">
          <span className="help-head-icon">
            <BookIcon size={22} />
          </span>
          <div className="help-head-copy">
            <span className="eyebrow">使用指南</span>
            <h2>3 分钟看懂若道远程</h2>
            <p>从被控、远控到把服务分享给朋友，按场景找到对应步骤。</p>
          </div>
          <div className="help-head-actions">
            <button
              type="button"
              className="button ghost small"
              onClick={onReplayOnboarding}
            >
              <HelpIcon size={15} />
              新手引导
            </button>
            <button type="button" className="icon-button" aria-label="关闭使用指南" onClick={onClose}>
              <XIcon size={18} />
            </button>
          </div>
        </header>

        <div className="help-toolbar">
          <nav className="help-tabs" aria-label="指南分类">
            {(Object.keys(TAB_LABELS) as HelpTab[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`help-tab${tab === item ? " active" : ""}`}
                onClick={() => setTab(item)}
              >
                {TAB_LABELS[item]}
                {item === "trouble" && errorCount > 0 && (
                  <span className="help-tab-badge">{errorCount}</span>
                )}
              </button>
            ))}
          </nav>
          <label className="help-search">
            <SearchIcon size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索：邀请码、黑屏、部署失败…"
              aria-label="搜索使用指南"
            />
            {query && (
              <button
                type="button"
                className="help-search-clear"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <XIcon size={14} />
              </button>
            )}
          </label>
        </div>

        <div className="help-body" ref={bodyRef}>
          {query && (
            <p className="help-search-note">
              “{query}” 找到 {scenarios.length} 个场景、{faqs.length} 个问题
            </p>
          )}

          {tab === "guide" && (
            <div className="help-guide">
              <div className="help-intro">
                <div>
                  <strong>先选一个你的目标</strong>
                  <p>
                    若道远程不需要注册就能远控。第一次使用建议按顺序看一遍“我要被控”和“我要远控”，
                    需要给朋友提供服务时再看“我要分享”。
                  </p>
                </div>
                <button type="button" className="button primary small" onClick={onOpenDeploy}>
                  部署服务器
                </button>
              </div>
              {scenarios.length === 0 ? (
                <div className="help-empty">
                  <SearchIcon size={22} />
                  <strong>没有找到相关步骤</strong>
                  <p>换个关键词试试，或直接问 AI。</p>
                </div>
              ) : (
                <div className="help-scenario-grid">
                  {scenarios.map((scenario) => (
                    <ScenarioCard key={scenario.id} scenario={scenario} onAskAi={onAskAi} />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "faq" && (
            <div className="help-faq-list">
              {faqs.length === 0 ? (
                <div className="help-empty">
                  <SearchIcon size={22} />
                  <strong>没有找到这个问题</strong>
                  <p>可以换个说法，或让 AI 结合当前状态回答。</p>
                  <button type="button" className="button primary small" onClick={() => onAskAi(query)}>
                    <SparkIcon size={15} />
                    问 AI
                  </button>
                </div>
              ) : (
                faqs.map((item) => (
                  <FaqRow
                    key={item.id}
                    item={item}
                    expanded={expandedFaq === item.id}
                    onToggle={() => setExpandedFaq(expandedFaq === item.id ? null : item.id)}
                    onAskAi={onAskAi}
                  />
                ))
              )}
            </div>
          )}

          {tab === "trouble" && (
            <div className="help-trouble">
              <div className={`help-health tone-${errorCount > 0 ? "error" : diagnosis.issues.length ? "warn" : "ok"}`}>
                <span className="help-health-icon">
                  {errorCount > 0 ? (
                    <AlertIcon size={20} />
                  ) : diagnosis.issues.length ? (
                    <InfoIcon size={20} />
                  ) : (
                    <CheckIcon size={20} />
                  )}
                </span>
                <div>
                  <strong>{diagnosis.headline}</strong>
                  <p>
                    这是客户端根据当前连接状态、服务器配置和最近错误自动检测的结果，
                    只用于本地提示，不会自动上传。
                  </p>
                </div>
                <button
                  type="button"
                  className="button primary small"
                  onClick={() =>
                    onAskAi(
                      "请全面检查我当前的连接和部署状态，判断有没有需要处理的问题，并给出按顺序的操作建议。",
                    )
                  }
                >
                  <SparkIcon size={15} />
                  让 AI 全面检查
                </button>
              </div>

              {diagnosis.issues.length === 0 ? (
                <div className="help-empty">
                  <CheckIcon size={22} />
                  <strong>暂时没有检测到问题</strong>
                  <p>如果仍然无法使用，可以直接问 AI，并描述你看到的现象。</p>
                </div>
              ) : (
                <div className="help-issue-list">
                  {diagnosis.issues.map((issue) => (
                    <article key={issue.id} className={`help-issue tone-${issue.tone}`}>
                      <span className="help-issue-icon">{issueToneIcon(issue)}</span>
                      <div className="help-issue-main">
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                        <span className="help-issue-suggestion">{issue.suggestion}</span>
                        <div className="help-issue-actions">
                          {issue.faqId && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => openFaq(issue.faqId as string)}
                            >
                              查看相关说明
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-button ai"
                            onClick={() => askIssue(issue)}
                          >
                            <SparkIcon size={13} />
                            让 AI 分析
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <div className="help-trouble-foot">
                <span>
                  <InfoIcon size={14} />
                  部署失败、连接被拒等动态错误会显示在上面的检测结果中。
                </span>
                <button type="button" className="text-button" onClick={() => openFaq("deploy-fail")}>
                  部署失败怎么办？
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="help-foot">
          <span>
            <BookIcon size={14} />
            仍然看不懂？可以让 AI 结合当前状态一步步带你操作。
          </span>
          <div className="help-foot-actions">
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setTab("guide");
                setQuery("");
              }}
            >
              从头看一遍
            </button>
            <button type="button" className="button primary small" onClick={() => onAskAi()}>
              <SparkIcon size={15} />
              问 AI 助手
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
