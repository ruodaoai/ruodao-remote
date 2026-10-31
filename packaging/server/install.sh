#!/usr/bin/env bash
#
# 若道远程信令服务端安装脚本（Linux + systemd）
#
# 用法：
#   sudo ./install.sh
#   sudo PORT=8787 PUBLIC_URL=https://remote.example.com ./install.sh
#
# 重复执行会更新服务端程序并重启服务，保留已有配置与数据。

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/ruodao}"
DATA_DIR="${DATA_DIR:-/var/lib/ruodao}"
ENV_FILE="${ENV_FILE:-/etc/ruodao-remote.env}"
SERVICE_NAME="ruodao-remote"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
PUBLIC_URL="${PUBLIC_URL:-}"
SERVER_NAME="${SERVER_NAME:-若道远程服务}"
REGISTRATION_MODE="${REGISTRATION_MODE:-invite}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BUNDLE="${SCRIPT_DIR}/server.cjs"

info() { printf '[ruodao] %s\n' "$*"; }
fail() { printf '[ruodao] 错误：%s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail "请使用 root 或 sudo 运行本脚本。"
[[ -f "${SOURCE_BUNDLE}" ]] || fail "缺少 server.cjs，请从发布的 zip 包中运行本脚本。"
command -v systemctl >/dev/null 2>&1 || fail "当前系统没有 systemd，无法安装为服务。"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "${NODE_BIN}" ]] || fail "未找到 Node.js。请先安装 Node.js 20 或更高版本后重试。"
NODE_MAJOR="$("${NODE_BIN}" -p "process.versions.node.split('.')[0]")"
[[ "${NODE_MAJOR}" -ge 20 ]] || fail "需要 Node.js 20+，当前为 $("${NODE_BIN}" -v)。"

if [[ -n "${ADMIN_PASSWORD}" ]]; then
  [[ ${#ADMIN_PASSWORD} -ge 8 ]] || fail "ADMIN_PASSWORD 至少需要 8 位。"
  [[ "${ADMIN_PASSWORD}" =~ ^[A-Za-z0-9._@%+=:/-]+$ ]] || \
    fail "ADMIN_PASSWORD 只能包含字母、数字和 ._@%+=:/-，避免引号或空格导致配置损坏。"
fi

[[ "${PORT}" =~ ^[0-9]+$ ]] && [[ "${PORT}" -ge 1 && "${PORT}" -le 65535 ]] || fail "PORT 不是有效端口。"
[[ "${HOST}" =~ ^[A-Za-z0-9.:%_-]+$ ]] || fail "HOST 格式不正确。"
[[ "${PUBLIC_URL}" != *" "* ]] || fail "PUBLIC_URL 不能包含空格。"
SERVER_NAME="${SERVER_NAME//\"/}"
[[ "${SERVER_NAME}" != *$'\n'* ]] || fail "SERVER_NAME 不能包含换行。"

case "${REGISTRATION_MODE}" in
  invite|approval|open) ;;
  *) fail "REGISTRATION_MODE 只能是 invite、approval 或 open。" ;;
esac

info "检查服务账号与目录…"
getent group ruodao >/dev/null 2>&1 || groupadd --system ruodao
id ruodao >/dev/null 2>&1 || useradd --system --gid ruodao --home-dir "${DATA_DIR}" \
  --shell "$(command -v nologin || echo /bin/false)" ruodao
mkdir -p "${INSTALL_DIR}" "${DATA_DIR}"
chown -R ruodao:ruodao "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

info "安装服务端程序到 ${INSTALL_DIR}/server.cjs…"
install -o root -g root -m 0644 "${SOURCE_BUNDLE}" "${INSTALL_DIR}/server.cjs"

GENERATED_PASSWORD=0
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD="$("${NODE_BIN}" -e "process.stdout.write(require('node:crypto').randomBytes(18).toString('base64url'))")"
    GENERATED_PASSWORD=1
  fi
  info "写入配置 ${ENV_FILE}…"
  umask 077
  cat > "${ENV_FILE}" <<EOF
# 由 ruodao-remote install.sh 生成，重新安装不会覆盖此文件
NODE_ENV=production
HOST=${HOST}
PORT=${PORT}
DATA_DIR=${DATA_DIR}
PUBLIC_URL=${PUBLIC_URL}
SERVER_NAME="${SERVER_NAME}"
REGISTRATION_MODE=${REGISTRATION_MODE}
TRUST_PROXY=1
ADMIN_SESSION_HOURS=12
ADMIN_PASSWORD="${ADMIN_PASSWORD}"
STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
# 需要 TURN 时填写，并确保与 coturn 的 static-auth-secret 一致
TURN_URLS=
TURN_SECRET=
TURN_TTL_SECONDS=3600
EOF
  chmod 600 "${ENV_FILE}"
  chown root:root "${ENV_FILE}"
else
  info "检测到已有配置 ${ENV_FILE}，保留现有管理员密码与接入设置。"
fi

info "写入 systemd 服务…"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Ruodao Remote signaling server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ruodao
Group=ruodao
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.cjs
Restart=always
RestartSec=2
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=${DATA_DIR}
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "${SERVICE_FILE}"

info "启动服务…"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
systemctl restart "${SERVICE_NAME}"

info "等待健康检查…"
HEALTH_OK=0
for _ in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then HEALTH_OK=1; break; fi
  else
    if "${NODE_BIN}" -e "fetch('http://127.0.0.1:${PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      HEALTH_OK=1; break
    fi
  fi
  sleep 1
done

if [[ "${HEALTH_OK}" -ne 1 ]]; then
  printf '\n[ruodao] 服务启动后健康检查未通过。请执行：\n  systemctl status %s\n  journalctl -u %s -n 100 --no-pager\n' "${SERVICE_NAME}" "${SERVICE_NAME}" >&2
  exit 1
fi

printf '\n'
info "安装完成。"
printf '  本机地址   http://127.0.0.1:%s\n' "${PORT}"
[[ -n "${PUBLIC_URL}" ]] && printf '  对外地址   %s\n' "${PUBLIC_URL}"
printf '  管理后台   %s/admin\n' "${PUBLIC_URL:-http://<服务器IP>:${PORT}}"
printf '  配置文件   %s\n' "${ENV_FILE}"
printf '  数据目录   %s\n' "${DATA_DIR}"
if [[ "${GENERATED_PASSWORD}" -eq 1 ]]; then
  printf '  管理员密码 %s\n' "${ADMIN_PASSWORD}"
else
  printf '  管理员密码 见 %s\n' "${ENV_FILE}"
fi
printf '\n下一步：\n'
printf '  1. 公网使用请配置 HTTPS 反向代理（Caddy / Nginx），并把 PUBLIC_URL 改为 https 地址；\n'
printf '  2. 在云服务商安全组放行实际使用的端口；跨 NAT 需要 TURN 时安装 coturn；\n'
printf '  3. 打开管理后台创建邀请码，或把接入模式改为 approval / open；\n'
printf '  4. 在客户端「设置 → 服务器地址」填写上面的地址。\n'
printf '\n查看日志：journalctl -u %s -f\n' "${SERVICE_NAME}"
