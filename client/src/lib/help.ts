export type HelpScenarioId = "host" | "control" | "share" | "ai";

export interface HelpStep {
  title: string;
  detail: string;
}

export interface HelpScenario {
  id: HelpScenarioId;
  eyebrow: string;
  title: string;
  summary: string;
  steps: HelpStep[];
  note: string;
}

export const HELP_SCENARIOS: HelpScenario[] = [
  {
    id: "host",
    eyebrow: "我要被控",
    title: "让别人控制这台电脑",
    summary: "适合把家里的电脑、办公室电脑临时交给同事或家人处理。",
    steps: [
      {
        title: "打开「本机被控」并开始",
        detail: "点击“开始被控”，在系统弹窗中允许共享主屏幕。",
      },
      {
        title: "把两串号码一起发给对方",
        detail: "页面上会显示 9 位远控码和 10 位访问密钥，两个都需要。",
      },
      {
        title: "对方连接后随时可以结束",
        detail: "画面出现后，可点击“结束会话并下线”立即断开；关闭应用也会停止共享。",
      },
    ],
    note: "只把远控码和访问密钥发给信任的人。访问密钥只在本机校验，服务器不会保存明文。",
  },
  {
    id: "control",
    eyebrow: "我要远控",
    title: "控制另一台电脑",
    summary: "输入对方提供的远控码和访问密钥，就能看到并操作对方屏幕。",
    steps: [
      {
        title: "确认对方已经上线",
        detail: "让对方打开「本机被控」并点击“开始被控”，保持应用在线。",
      },
      {
        title: "输入远控码和访问密钥",
        detail: "在「控制远程设备」页填入对方的两串号码，点击“连接远程设备”。",
      },
      {
        title: "连接成功后直接操作",
        detail: "鼠标和键盘会作用于对方电脑；点击顶部“结束控制”即可断开。",
      },
      {
        title: "也可以从共享设备发起申请",
        detail: "对方在「本机被控」页打开“共享给本服成员”后，会出现在本页下方的共享设备列表；点击“申请远控”，对方同意后自动连接。",
      },
    ],
    note: "两端必须使用同一个服务器地址。连不上时先确认对方在线、号码没有输错；共享设备申请必须在 60 秒内由对方同意。",
  },
  {
    id: "share",
    eyebrow: "我要分享",
    title: "把服务提供给别人使用",
    summary: "部署一台自己的信令服务器，朋友就能凭邀请码接入你的远控网络。",
    steps: [
      {
        title: "先准备服务器",
        detail: "在「服务端」页一键部署 Linux 云服务器，或直接一键启动本机服务端。",
      },
      {
        title: "生成邀请码",
        detail: "登录服务端管理后，在“邀请码”页创建邀请码，可限制使用次数和有效期。",
      },
      {
        title: "把服务器地址和邀请码发给朋友",
        detail: "对方在设置中填写服务器地址和邀请码，就能接入；管理员可在“客户端”页批准或禁止远控。",
      },
    ],
    note: "对公网开放时推荐使用邀请制或审核制，并保持 HTTPS。开放接入只适合可信内网。",
  },
  {
    id: "ai",
    eyebrow: "我看不懂",
    title: "让 AI 助手帮你判断",
    summary: "遇到看不懂的提示或反复失败的步骤，可以让 AI 结合当前状态给出排查步骤。",
    steps: [
      {
        title: "点击右上角「问 AI」",
        detail: "使用若道账号登录。没有账号可以在登录窗口点击“注册若道账号”。",
      },
      {
        title: "直接描述现象或使用推荐问题",
        detail: "AI 会自动附带当前运行状态，已隐藏密码、访问密钥、远控码和邀请码。",
      },
      {
        title: "照着步骤操作，仍不行就继续追问",
        detail: "可以点“查看将发送的状态”确认内容，再补充报错截图中的文字（不要发密钥）。",
      },
    ],
    note: "AI 回答可能出错，涉及删除数据、开放公网、修改防火墙等操作时请先确认影响。",
  },
];

export interface HelpFaqItem {
  id: string;
  question: string;
  answer: string;
  steps?: string[];
  keywords: string[];
}

export const HELP_FAQS: HelpFaqItem[] = [
  {
    id: "account",
    question: "使用若道远程需要注册账号吗？",
    answer:
      "远控本身不需要账号：只要拿到远控码和访问密钥就能连接。只有「问 AI」需要登录若道账号，用于调用你账号下的模型，远控连接不会因此经过若道账号体系。",
    keywords: ["账号", "注册", "登录", "AI"],
  },
  {
    id: "pair",
    question: "远控码和访问密钥有什么区别？",
    answer:
      "远控码用来定位“哪台设备”，每次上线才生成；访问密钥用来证明“你有权连接”，由被控端在本机生成。两者缺一不可，请一起发给对方，不要公开发布。",
    steps: [
      "被控端在「本机被控」页把两串号码一起发给对方。",
      "控制端在「控制远程设备」页分别填入远控码和访问密钥。",
      "被控端点“更换密钥”后，旧密钥立即失效。",
    ],
    keywords: ["远控码", "密钥", "连接", "区别"],
  },
  {
    id: "server-url",
    question: "服务器地址应该填什么？",
    answer:
      "客户端默认使用 http://127.0.0.1:8787，也就是内置本机服务端，只适合同一台电脑或同一局域网。要让互联网上的朋友接入，需要部署一台公网服务器，然后在两端都填写同一个 https://你的域名。",
    steps: [
      "只在本机或局域网使用：在「服务端」→“本机服务端”一键启动即可。",
      "给互联网上的朋友使用：在「服务端」→“一键部署新服务器”，安装完成后会自动填入地址。",
      "手动修改：打开右上角设置，在“服务器地址”中填写同一地址。",
    ],
    keywords: ["服务器", "地址", "127.0.0.1", "域名", "局域网", "公网"],
  },
  {
    id: "invite",
    question: "提示需要邀请码怎么办？",
    answer:
      "说明这台服务器开启了邀请制。邀请码由服务器管理员在「服务端」→“邀请码”页创建，拿到后填入右上角设置的“邀请码”，再重新连接即可。",
    steps: [
      "向管理员索取邀请码，或管理员在邀请码页点击“生成邀请码”。",
      "客户端打开设置 → 邀请码，粘贴后保存。",
      "回到「本机被控」或「控制远程设备」页重试。",
    ],
    keywords: ["邀请码", "邀请制", "接入", "管理员"],
  },
  {
    id: "approval",
    question: "为什么一直显示等待管理员批准？",
    answer:
      "服务器使用的是审核制。新客户端接入或发起远控后需要管理员放行，批准后会自动继续，不需要重新连接。",
    steps: [
      "管理员登录服务端管理，打开“客户端”页。",
      "找到状态为“待批准”的设备，点击“允许”。",
      "客户端每 5 秒自动检查，批准后会自动继续。",
    ],
    keywords: ["审核", "批准", "等待", "管理员", "待批准"],
  },
  {
    id: "not-found",
    question: "提示找不到远控码对应的设备？",
    answer:
      "通常是对方没有上线、远控码已失效，或两端连到了不同的服务器。远控码只在被控端本次在线期间有效。",
    steps: [
      "确认对方已经点击“开始被控”，页面显示“已上线”。",
      "核对 9 位远控码，注意不要输成访问密钥。",
      "确认两端设置中的服务器地址完全一致。",
    ],
    keywords: ["找不到", "未找到", "not-found", "离线", "远控码"],
  },
  {
    id: "invalid-key",
    question: "提示访问密钥不正确？",
    answer:
      "访问密钥是 10 位字符，不含 I、O、0、1。请直接从被控端复制，避免识别错误；对方更换密钥后旧密钥会立即失效。",
    steps: [
      "让对方在「本机被控」页点击访问密钥右侧的复制按钮。",
      "控制端粘贴时不要带入空格或多余字符。",
      "如果对方刚点过“更换密钥”，请使用新密钥。",
    ],
    keywords: ["密钥", "不正确", "错误", "invalid-key", "复制"],
  },
  {
    id: "screen",
    question: "画面黑屏、卡顿或无法开始共享？",
    answer:
      "先确认系统允许屏幕录制，再检查网络。跨运营商或严格 NAT 环境下需要 TURN 中转；部署时勾选安装 TURN 能明显改善连接成功率。",
    steps: [
      "被控端重新点击“开始被控”，并在系统弹窗中允许共享。",
      "Windows 设置 → 隐私和安全性 → 屏幕截图/录屏，确认允许桌面应用。",
      "两端尽量使用稳定网络；跨网络时部署 TURN，并按结果页提示放行实际使用的 TURN 端口与中继范围。",
    ],
    keywords: ["黑屏", "卡顿", "屏幕", "共享", "TURN", "权限"],
  },
  {
    id: "input",
    question: "为什么只能看画面，不能操作鼠标键盘？",
    answer:
      "如果窗口底部显示“仅观看画面”，说明当前系统不支持输入注入，或权限不足。对方处于 UAC 安全桌面、锁屏等界面时也无法注入操作。",
    steps: [
      "确认控制端底部状态是否显示“支持输入控制”。",
      "让对方解锁电脑，并关闭会拦截模拟输入的安全软件后重试。",
      "涉及系统级弹窗时，请对方在本机手动操作。",
    ],
    keywords: ["输入", "鼠标", "键盘", "只能看", "仅观看"],
  },
  {
    id: "session-tools",
    question: "远程会话中可以聊天、同步剪贴板或调整画质吗？",
    answer:
      "可以。连接建立后，控制端顶部工具栏可以切换“适应 / 填充 / 原尺寸”、选择画质档位（流畅、均衡、清晰），并通过气泡按钮打开会话消息。剪贴板同步默认关闭，需要被控端在会话卡片中点击“剪贴板未允许”改为允许，控制端再手动开启；只同步纯文本，单条最多 64 KB。被控端也可以随时“暂停操作”，暂停后画面仍实时可见，但键盘和鼠标不会生效。",
    steps: [
      "调整画面：在控制端顶部选择适应、填充或原尺寸；原尺寸会按真实像素显示，可滚动查看。",
      "调整画质：网络较差时选“流畅”，局域网或需要看清文字时选“清晰”。",
      "发送消息：点击控制端顶部的会话消息按钮，输入后按 Enter；被控端在右侧会话卡片展开消息。",
      "同步剪贴板：被控端先允许，控制端再点击剪贴板按钮开启；剪贴板中可能有密码，请只在可信会话中开启。",
      "暂停操作：被控端点击“暂停操作”，控制端会显示“仅查看”，恢复后键鼠才会继续发送。",
    ],
    keywords: ["聊天", "会话消息", "剪贴板", "复制", "粘贴", "画质", "清晰", "流畅", "视图", "原尺寸", "暂停", "仅查看"],
  },
  {
    id: "shared-host",
    question: "「控制远程设备」页的共享设备是什么？",
    answer:
      "同一服务器的成员可以主动把电脑发布出来。对方在「本机被控」页打开“共享给本服成员”后，你会在这台电脑的共享设备列表中看到它；申请远控必须由对方点“允许”，共享列表不会暴露远控码、访问密钥或 IP。对方忙线、拒绝或 60 秒内未处理时，申请会失效。",
    steps: [
      "让对方开始被控，并在身份面板打开“共享给本服成员”，可填写使用说明。",
      "在「控制远程设备」→“共享设备”中找到对方，点击“申请远控”。",
      "对方同意后会自动建立连接；想取消时点击申请提示中的“取消申请”。",
    ],
    keywords: ["共享设备", "共享", "发布", "申请", "允许", "本服", "成员", "资源"],
  },
  {
    id: "blocked",
    question: "提示管理员已禁止此客户端？",
    answer:
      "管理员在服务端把这个客户端设为了“已禁止”。需要管理员在“客户端”页把它改回“已允许”，客户端不需要重新安装。",
    steps: [
      "联系服务器管理员，说明设备名称。",
      "管理员在「服务端」→“客户端”页找到该设备，点击“允许”。",
      "客户端重新连接即可。",
    ],
    keywords: ["禁止", "blocked", "管理员", "已禁止", "解封"],
  },
  {
    id: "deploy-prepare",
    question: "部署服务器前需要准备什么？",
    answer:
      "推荐 Ubuntu 22.04+ 或 Debian 12+ 的云服务器，root 或带 sudo 的 SSH 账号即可；已经有网站的服务器也能安装。域名可选，启用 HTTPS 需要域名 A 记录指向服务器 IP，并且 443 端口空闲。",
    steps: [
      "确认可以用 SSH 登录服务器，并记下端口（默认 22）。",
      "云安全组先放行 SSH 端口；部署完成后按结果页列出的实际端口继续放行。",
      "可选：把域名 A 记录指向服务器 IP，等待解析生效。443 被其他网站占用时无法自动申请证书。",
      "安装会占用约 200MB 磁盘，不会修改 SSH 配置，也不会停止 nginx、宝塔等现有服务。",
    ],
    keywords: ["部署", "准备", "服务器", "SSH", "域名", "防火墙"],
  },
  {
    id: "deploy-shared-server",
    question: "服务器上已经有网站（nginx / 宝塔）还能部署吗？",
    answer:
      "可以。安装器会先检查服务器正在监听的 TCP/UDP 端口，自动挑选空闲的入口、本机信令和 TURN 端口，并使用独立的 /etc/ruodao/Caddyfile 与 ruodao-caddy 服务；不会修改 /etc/caddy、nginx、宝塔配置，也不会停止这些服务。443 空闲时会自动启用 HTTPS；443 被占用时改用其他 HTTP 端口，并提示如何接入现有反向代理。如果服务器已有其他 TURN 配置或实例，会跳过 TURN。",
    steps: [
      "正常填写服务器信息即可，不需要先停用 nginx、宝塔或其他网站。",
      "部署完成后，按结果页列出的实际端口放行云安全组。",
      "想复用现有 HTTPS 时，可在原反向代理中把域名转发到结果页提示的本机信令端口。",
    ],
    keywords: ["已有网站", "nginx", "宝塔", "端口占用", "共存", "80", "443", "反向代理"],
  },
  {
    id: "deploy-fail",
    question: "服务器部署失败了怎么办？",
    answer:
      "先在部署窗口查看失败步骤和安装日志，最常见的原因是 SSH 密码或私钥不正确、域名未解析、443 被占用导致 HTTPS 失败、磁盘空间不足或云防火墙未放行实际端口。修改后可以重新部署。",
    steps: [
      "展开安装日志，查看最后几行报错。",
      "确认 SSH 账号、端口和密码/私钥正确。",
      "检查域名解析和服务器安全组，按日志中实际选择的端口放行；如果 443 属于其他网站，可继续使用 HTTP，或在现有反向代理中转发到本机信令端口。",
      "仍看不懂时点击“让 AI 分析”，AI 会结合失败步骤和错误信息给出建议。",
    ],
    keywords: ["部署失败", "安装失败", "日志", "报错", "AI"],
  },
  {
    id: "local-or-cloud",
    question: "本机服务端和云服务器应该选哪个？",
    answer:
      "本机服务端不需要买服务器，适合在同一局域网临时使用；云服务器有公网地址，适合给互联网上的朋友长期使用，并能自动配置 HTTPS 和 TURN 中转。",
    steps: [
      "只在自己家里/办公室用：选择「服务端」→“本机服务端”→启动。",
      "要给外地朋友用：选择“一键部署新服务器”，填公网服务器和域名。",
      "本机服务端想对公网开放，需要自己配置端口映射和 HTTPS 反向代理。",
    ],
    keywords: ["本机", "云服务器", "区别", "选择", "公网"],
  },
  {
    id: "admin-password",
    question: "管理员密码在哪里？忘记了怎么办？",
    answer:
      "部署完成时会生成管理员密码并加密保存在这台电脑；本机服务端的管理员密码也可以在服务端页点击“显示”查看。公网服务器如果丢失密码，需要在服务器上重新设置 ADMIN_PASSWORD 并重启 ruodao-remote 服务。",
    keywords: ["管理员密码", "忘记", "ADMIN_PASSWORD", "登录"],
  },
  {
    id: "security",
    question: "对外开放安全吗？",
    answer:
      "建议始终使用 HTTPS、邀请制或审核制，并定期撤销不再使用的邀请码。远控画面和输入通过 WebRTC 加密，服务器只转发信令；但不要对公网使用“开放接入”，也不要把远控码发到公开群聊。",
    steps: [
      "服务端设置中把接入方式改为“邀请制”或“审核制”。",
      "邀请码设置有效期和使用次数，用完后撤销。",
      "定期在“客户端”页检查在线设备和会话，发现异常立即禁止。",
    ],
    keywords: ["安全", "公网", "开放接入", "邀请", "审核"],
  },
  {
    id: "ai-privacy",
    question: "问 AI 时会发送哪些信息？",
    answer:
      "只会发送你输入的问题、当前对话上下文，以及一份运行状态摘要（版本、服务器地址、连接状态、最近错误等）。摘要中不包含访问密钥、远控码、邀请码、密码或 SSH 私钥，发送前还会再做一次脱敏。",
    steps: [
      "在 AI 窗口点击“查看将发送的状态”可以预览摘要。",
      "登录令牌使用系统加密存储保存在本机，账号密码不会保存。",
      "对话记录只保留在当前窗口，关闭后不会写入磁盘。",
    ],
    keywords: ["AI", "隐私", "发送", "状态", "数据", "脱敏"],
  },
  {
    id: "stop-server",
    question: "如何停止或卸载服务端？",
    answer:
      "本机服务端可以在「服务端」页点击“停止”；Linux 云服务器可通过 SSH 执行 systemctl 命令停止，不会影响客户端本身的远控功能。",
    steps: [
      "本机服务端：打开「服务端」→“本机服务端”，点击“停止”。",
      "云服务器：执行 sudo systemctl stop ruodao-remote，需要彻底停止开机启动时再执行 sudo systemctl disable ruodao-remote。",
      "停止后，使用该服务器的客户端会断开，需要改用其他服务器地址。",
    ],
    keywords: ["停止", "卸载", "服务端", "systemctl", "关闭"],
  },
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function filterHelpFaqs(query: string): HelpFaqItem[] {
  const needle = normalizeQuery(query);
  if (!needle) return HELP_FAQS;
  return HELP_FAQS.filter((item) => {
    const haystack = [
      item.question,
      item.answer,
      ...(item.steps ?? []),
      ...item.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function filterHelpScenarios(query: string): HelpScenario[] {
  const needle = normalizeQuery(query);
  if (!needle) return HELP_SCENARIOS;
  return HELP_SCENARIOS.map((scenario) => {
    const scenarioHit = [scenario.title, scenario.summary, scenario.eyebrow, scenario.note]
      .join(" ")
      .toLowerCase()
      .includes(needle);
    if (scenarioHit) return scenario;
    const steps = scenario.steps.filter((step) =>
      `${step.title} ${step.detail}`.toLowerCase().includes(needle),
    );
    return steps.length ? { ...scenario, steps } : null;
  }).filter((scenario): scenario is HelpScenario => scenario !== null);
}

export function findHelpFaq(id: string): HelpFaqItem | null {
  return HELP_FAQS.find((item) => item.id === id) ?? null;
}
