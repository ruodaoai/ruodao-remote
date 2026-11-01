# 贡献指南

[English](docs/en/contributing.md)

感谢你愿意改进若道远程。这个项目同时包含 Electron 客户端和 Node.js 服务端，改动通常会影响两端，请在提交前跑完下文的检查。

## 开始之前

- **安全问题不要开 Issue**，按 [SECURITY.md](SECURITY.md) 私下反馈；
- 只是使用上有疑问，先看 [常见问题](docs/常见问题.md) 和客户端内的「使用指南」；
- 准备改代码时，先开一个 Issue 说明动机和方案，避免大改做完才发现方向不一致。

## 环境准备

要求 Node.js 20+（CI 使用 Node 22，开发环境使用 Node 24）。

```bash
git clone https://github.com/<你的账号>/ruodao-remote.git
cd ruodao-remote

# 服务端
cd server && npm ci

# 客户端
cd ../client && npm ci
```

客户端开发：

```bash
cd server && npm run build && npm start     # 终端 1：信令服务
cd client && npm run dev                    # 终端 2：Vite + Electron
```

`npm run dev` 会启动 Vite 与 Electron；渲染层改动热更新，主进程改动需要重启。

## 目录约定

| 路径 | 职责 |
| --- | --- |
| `client/electron/` | 主进程：信令、远控会话、共享设备、部署、更新、社区、设置 |
| `client/src/` | 渲染层：页面、组件、hooks、样式（`styles.css`） |
| `client/scripts/` | 构建、截图、清单与冒烟脚本 |
| `server/src/` | 信令服务器、注册表、管理后台与更新实现 |
| `docs/` | 中文文档；`docs/en/` 为英文文档；`docs/images/` 为 README 截图 |
| `packaging/server/` | 服务端部署包脚本与 systemd 模板 |

- 新增环境变量必须同时更新 `server/.env.example`、`docs/技术文档.md` 与 `docs/en/technical-reference.md`；
- 新增用户可见文案需要同时提供中文与英文：组件里写 `t("中文原文")`（带变量用 `tf("……{0}", 值)`），再到 `client/src/i18n/en.ts` 补词条；
- 修改文案后运行 `node client/scripts/i18n-audit.mjs`，确认「缺失 0、未包裹 0」；
- 截图统一由 `client/scripts/capture-docs-shots.mjs` 生成，不要手动截图后替换。

## 分支与提交

- 从 `main` 切出 `feat/<简述>`、`fix/<简述>`、`docs/<简述>`；
- 一个 PR 只做一件事，避免混入无关的格式化改动；
- 提交信息使用中文或英文均可，采用 `type: 摘要` 的形式，`type` 取 `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`；
- 涉及界面改动的提交，请附上改动前后的截图。

示例：

```
feat: 共享服务器列表支持按延迟排序
fix: 修复会话结束后剪贴板按钮状态未复位
docs: 补充英文部署文档中的 coturn 配置
```

## 提交前检查

```bash
# 服务端
cd server
npm run typecheck
npm test
npm run build

# 客户端
cd client
npm run typecheck
npm test
npm run build
```

- 涉及远控链路的改动请额外跑 `cd client && npm run smoke`（会启动两个 Electron 窗口，占用鼠标约 1 分钟，需要真实桌面）；
- 涉及共享服务器界面的改动请跑 `cd client && node scripts/verify-shared-ui.mjs`；
- 两端版本号由根目录 `version.json` 统一管理，改版本用 `node scripts/set-version.mjs <版本>`，不要手改 `package.json`。

## PR 检查项

提交 PR 时请确认：

- [ ] 说明改动动机与影响范围（客户端 / 服务端 / 文档）；
- [ ] 新增或修改的逻辑有对应测试，或说明为何无法自动化；
- [ ] 两端 `typecheck`、`test`、`build` 通过；
- [ ] 涉及界面时附截图，涉及配置时更新文档与环境变量示例；
- [ ] 没有提交 `.env`、密钥、私钥、真实服务器地址或日志文件；
- [ ] 没有引入新的 GPL/AGPL 类强传染依赖（本项目使用 MIT）。

## 报告缺陷

请在 [Issues](https://github.com/ruodaoai/ruodao-remote/issues) 中提供：

1. 客户端与服务端版本（客户端顶部版本号 / `GET /api/version`）；
2. 系统版本与网络环境（同机、局域网、公网，是否配置 TURN）；
3. 复现步骤与预期结果；
4. 错误提示截图，或 `journalctl -u ruodao-remote -n 100` 的相关片段（请先脱敏）。

**不要粘贴远控码、访问密钥、管理员密码、邀请码、SSH 私钥或完整的公网地址。**
