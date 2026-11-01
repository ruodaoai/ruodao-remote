## 改动内容 / What changed

<!-- 一句话说明这个 PR 做了什么 / One sentence summary -->

## 动机 / Why

<!-- 关联 Issue：#123；解决什么问题 / Link the issue, explain the problem -->

## 影响范围 / Scope

- [ ] 客户端主进程（`client/electron`）
- [ ] 客户端渲染层（`client/src`）
- [ ] 服务端（`server`）
- [ ] 部署包与脚本（`packaging`、`client/scripts`）
- [ ] 文档（`docs`、`README`）

## 验证 / Verification

```bash
cd server && npm run typecheck && npm test && npm run build
cd client && npm run typecheck && npm test && npm run build
```

- [ ] 上述命令全部通过
- [ ] 涉及远控链路时跑过 `cd client && npm run smoke`
- [ ] 涉及共享服务器界面时跑过 `node scripts/verify-shared-ui.mjs`

## 界面改动 / UI changes

<!-- 有界面改动请附改动前后截图 / Attach before & after screenshots for UI changes -->

## 检查项 / Checklist

- [ ] 没有提交 `.env`、密钥、私钥、真实服务器地址或日志文件
- [ ] 新增配置已同步 `server/.env.example` 与中英文文档
- [ ] 版本号仍由 `version.json` 统一管理（未手改 `package.json`）
- [ ] 新增依赖的许可证与本项目 MIT 兼容
