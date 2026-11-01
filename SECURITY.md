# 安全说明 / Security Policy

## 报告问题 / Reporting a vulnerability

**请勿公开提交安全 Issue。** 请通过仓库所有者的 GitHub 主页所列联系方式私下反馈；如果只能在 Issue 中说明，请只描述影响范围并请求私下沟通，不要附带可被利用的细节、真实密钥或生产服务器信息。

我们会在确认后尽快回复，并在修复发布后致谢。

Please **do not open a public issue** for security problems. Contact the maintainers privately through the details on the repository owner's GitHub profile. If you must use an issue, describe only the impact and ask for a private channel — never include exploit details, real keys or production host information.

## 安全边界 / Security boundaries

- 远控画面与输入通过 WebRTC 的 DTLS-SRTP 加密，信令服务器只转发 SDP/ICE；
  Screen and input use WebRTC DTLS-SRTP; the signaling server only relays SDP/ICE.
- 访问密钥只在本机生成，服务器保存 PBKDF2-SHA256 加盐哈希，不保存明文；
  Access keys are generated locally; the server stores only a salted PBKDF2-SHA256 hash.
- 管理员密码使用 scrypt 校验，登录态为签名 Cookie 或短期 Bearer Token；
  Admin passwords are verified with scrypt; sessions are signed cookies or short-lived bearer tokens.
- 更新包必须来自 `ruodao.com` 或其配置的允许域名，并强制校验 SHA-256；
  Update packages must come from `ruodao.com` (or an allow-listed host) and carry a mandatory SHA-256 digest.
- 服务端默认不自行提权，更新需要管理员执行替换命令或显式配置更新助手。
  The server never escalates privileges by itself; updates require an admin command or an explicitly configured helper.

## 使用建议 / Hardening advice

- 通过可信渠道传递远控码与访问密钥，使用后及时更换；
  Share codes and keys over a trusted channel and rotate them afterwards.
- 公网部署必须启用 HTTPS / WSS；
  Public deployments must use HTTPS / WSS.
- 不要在 Issue、截图或日志中粘贴远控码、访问密钥、管理员密码、邀请码或 SSH 私钥；
  Never paste codes, keys, admin passwords, invite codes or SSH private keys into issues, screenshots or logs.
- 不要把同一台信令服务器直接开放给互不信任的公网用户；
  Do not expose one signaling server to mutually untrusted public users.
- 正式分发前为安装包配置代码签名，并向安全厂商提交白名单。
  Code-sign the installer before public distribution and submit it for allow-listing.

## 支持范围 / Supported versions

只有最新 Release 会收到安全修复。旧版本请先升级再报告。

Only the latest release receives security fixes. Upgrade before reporting.
