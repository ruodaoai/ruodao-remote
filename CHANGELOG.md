# 更新日志 / Changelog

## 0.1.0 — 2026-11-01

首个公开版本。/ First public release.

### 客户端 / Client

- 免注册远控：9 位远控码 + 10 位访问密钥，WebRTC 端到端加密；
  Account-free remote control with a 9-digit code and 10-character key over encrypted WebRTC.
- 本机被控、控制远程设备、服务端管理、共享服务器、社区留言五个主页面；
  Five tabs: host, controller, server, shared servers, community.
- 会话文字聊天、剪贴板同步、画质档位、视图缩放、暂停输入；
  In-session chat, clipboard sync, quality presets, view zoom, pause input.
- 共享设备与远控申请，被控端逐次批准；
  Shared devices with per-request approval by the device owner.
- **共享服务器目录**：社区服务器列表、搜索与排序、仅看在线、登录解锁详情、一键写入设置、发布 / 更新 / 下架 / 举报；
  **Shared server directory**: community list with search, sorting, online-only filter, detail unlock after sign-in, one-click apply, publish / update / remove / report.
- 内置使用指南、故障诊断与 AI 助手；
  Built-in guide, diagnostics and AI assistant.
- 社区留言：同步若道插件市场评论区，可登录后评分、留言和标记有帮助；
  Community tab mirroring the Ruodao plugin-market comments, with sign-in for rating and posting.
- 自动更新：检查、下载、SHA-256 校验、静默安装，支持手动检查；
  Auto-update with check, download, SHA-256 verification and silent install.
- 服务端一键部署：SSH 安装 Node.js、Caddy、coturn，自动配置 HTTPS 与 systemd。
  One-click server deployment over SSH (Node.js, Caddy, coturn, HTTPS, systemd).

### 服务端 / Server

- 设备、邀请码、会话与审计管理，支持邀请制 / 审核制 / 开放接入；
  Device, invite code, session and audit management with invite / approval / open modes.
- `/admin` 网页管理后台与客户端管理代理；
  Web admin console plus a client-side management proxy.
- 短期 TURN 凭证、登录限流与锁定、结构化日志；
  Short-lived TURN credentials, login rate limiting and lockout, structured logs.
- 远控风控：最大并发会话、单次时长上限、冷却与冻结；
  Session guards: max concurrent sessions, per-session limit, cooldown and freeze.
- 服务端更新：检查、下载校验、手动替换命令、可配置自动应用。
  Server updates with check, verified download, manual command and optional auto-apply.

### 文档 / Docs

- 中英文产品介绍、界面截图、快速开始、服务端部署、常见问题、更新与发布、技术文档；
  Bilingual README, screenshots, quick start, deployment, FAQ, release guide and technical reference.
- MIT 许可证、贡献指南、行为准则、安全策略与 GitHub Actions CI。
  MIT license, contributing guide, code of conduct, security policy and CI.
