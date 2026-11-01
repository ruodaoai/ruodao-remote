# Technical reference

Everything needed to run, configure and audit Ruodao Remote yourself. The Chinese version ([技术文档](../技术文档.md)) is the most detailed and also covers the deployment wizard internals.

[简体中文](../技术文档.md) · [**English**](technical-reference.md)

## 1. Architecture

```
┌──────────────┐        WSS (signaling)        ┌──────────────┐
│  Host client │ ────────────────────────────► │ Signaling    │
│  (Electron)  │                               │ server       │
│              │ ◄──── pairing / ICE ───────── │ (Node + TS)  │
└──────┬───────┘                               └──────┬───────┘
       │                                              │ /admin
       │        WebRTC (DTLS-SRTP, P2P)               │
       │◄────────────────────────────────►            │
┌──────┴───────┐                               ┌──────┴───────┐
│  Controller  │                               │   Browser    │
│  (Electron)  │                               │   console    │
└──────────────┘                               └──────────────┘
```

- The signaling server never touches media. It pairs devices by remote code, relays SDP/ICE, stores device/invite/audit state and issues short-lived TURN credentials.
- Media and the data channel (chat, clipboard) are peer-to-peer. TURN relays encrypted packets when a direct path is impossible.
- The client embeds the same server build for LAN use (`client/resources/server/server.cjs`).

## 2. Local development

```bash
# terminal 1 — signaling server
cd server && npm install && npm run build && npm start   # 0.0.0.0:8787

# terminal 2 — client in dev mode
cd client && npm install && npm run dev
```

Set `REMOTE_SERVER_URL=http://127.0.0.1:8787` if you want the dev client to point at a specific server.

## 3. Server environment variables

The server does **not** read `.env` files. Inject variables through systemd `EnvironmentFile`, Docker `--env-file` or the shell. Reference: `server/.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `8787` | Listen port |
| `TRUST_PROXY` | `0` | Set to `1` behind Nginx/Caddy to trust `X-Forwarded-For` and HTTPS |
| `ALLOWED_ORIGINS` | empty | Comma-separated WebSocket Origin allow-list; desktop clients send `null` / `file://`, so it is usually empty |
| `STUN_URLS` | Google STUN | Comma-separated STUN URLs |
| `TURN_URLS` | empty | Comma-separated TURN URLs |
| `TURN_SECRET` | empty | coturn `static-auth-secret` used to mint short-lived credentials |
| `TURN_TTL_SECONDS` | `3600` | TURN credential lifetime |
| `MAX_ATTEMPTS_PER_MINUTE` | `10` | Pairing attempts per IP and per code per minute (floor 3) |
| `MAX_CONNECTIONS_PER_IP` | `8` | Concurrent WebSocket connections per IP |
| `MAX_TOTAL_CONNECTIONS` | `400` | Total concurrent WebSocket connections |
| `MESSAGE_LIMIT_PER_10S` | `120` | Messages per IP per 10 seconds |
| `HTTP_REQUESTS_PER_MINUTE` | `600` | HTTP requests per IP per minute |
| `HEARTBEAT_SECONDS` | `30` | WebSocket heartbeat interval |
| `SERVER_STATS_SECONDS` | `5` | Bandwidth / CPU / latency sampling interval |
| `DATA_DIR` | `./data` | Persistence for devices, invites, sessions and audit logs |
| `SECURITY_LOG_FILE` | `DATA_DIR/security.log` | JSONL security events, suitable for fail2ban |
| `PUBLIC_URL` | empty | Public URL, e.g. `https://remote.example.com:21437` |
| `SERVER_NAME` | `若道远程服务` | Name shown in the console and clients |
| `REGISTRATION_MODE` | `invite` | `invite` / `approval` / `open`, changeable in the console |
| `MAX_SESSIONS` | `0` | Max concurrent sessions; `0` = unlimited |
| `SESSION_LIMIT_MINUTES` | `0` | Max session length in minutes; `0` = unlimited |
| `COOLDOWN_MINUTES` | `5` | Cooldown after hitting the session limit |
| `FREEZE_MINUTES` | `10` | Default freeze duration for devices / IPs |
| `ADMIN_SESSION_HOURS` | `12` | Admin session lifetime |
| `ADMIN_PATH` | `/admin` | Console path; a random secret path is recommended |
| `HEALTH_TOKEN` | empty | When set, `/health` and `/api/version` require the token |
| `ADMIN_PASSWORD` | empty | Admin password (8+ characters); alternative to the hash |
| `ADMIN_PASSWORD_HASH` | empty | scrypt hash (see below) |
| `UPDATE_*` | see [Updates & releases](updates-and-releases.md) | Self-update settings |

Without an admin password the server still runs, but `/admin` and the client's management features are disabled.

Generate a password hash:

```bash
cd server
node -e "const {hashAdminPassword}=require('./dist/admin-auth.js'); console.log(hashAdminPassword(process.argv[1]))" 'your-strong-password'
```

Quote the hash: `$` must not be expanded by the shell or systemd. Prefer plain `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH='scrypt$...'`.

## 4. HTTP and WebSocket surface

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | public (or `HEALTH_TOKEN`) | Health, online counts, registration mode, session count |
| `GET /api/version` | public (or `HEALTH_TOKEN`) | Server version and update availability |
| `GET /api/ice` | public | STUN/TURN configuration with short-lived credentials |
| `/admin` | admin session | Web console |
| `/api/admin/*` | admin token or cookie | Devices, sessions, invites, audit, settings, updates |
| `/ws` | device handshake | Device registration, pairing, SDP/ICE relay, presence |

Pairing flow (simplified):

1. Host connects to `/ws` with its device id and receives a remote code; the access key stays local.
2. Controller sends `hello` with the code and key; the server verifies the PBKDF2 hash with `timingSafeEqual`.
3. On success both peers get each other's SDP offer/answer routing over the WebSocket; ICE candidates are relayed the same way.
4. Media flows peer-to-peer; the server only records session start/end for the audit log.

## 5. Security boundaries

- Keys are generated locally; the server stores `salt` + `pbkdf2-sha256(key, salt, 210000)`.
- Media and the data channel use DTLS-SRTP; TURN only forwards encrypted packets.
- Rate limits: pairing attempts, connections per IP, messages per 10 s, HTTP per minute; repeated failures lock by IP and globally.
- Admin auth: scrypt password, HMAC-signed HttpOnly cookie or short-lived bearer token.
- Update packages must be HTTPS on `ruodao.com` (or allow-listed hosts) and must carry SHA-256.
- Known gaps: no code signing, ~50-bit key entropy, primary display only, no UAC secure desktop / lock screen / `Ctrl+Alt+Del`, plain-text clipboard capped at 64 KB.

## 6. Verification

```bash
cd server && npm test && npm run typecheck && npm run build
cd client && npm test && npm run typecheck && npm run build
```

- `server`: unit tests for auth, registry, rate limiting and updates, plus integration tests that boot a real HTTP/WebSocket server.
- `client`: unit tests for protocol, settings, diagnostics and update parsing; `npm run smoke` drives two real Electron windows through a session (needs an interactive desktop).
- `client/scripts/verify-shared-ui.mjs` runs the shared-server flows against a local mock API.

## 7. Persistence and operations

- `DATA_DIR/state.json` holds devices, invite codes and audit entries, written atomically.
- Sessions, codes and key hashes are memory-only.
- Back up `state.json` plus `/etc/ruodao-remote.env`; delete `state.json` to reset devices and invites (irreversible).
- Security events are appended to `SECURITY_LOG_FILE` as JSONL — point fail2ban at it if you expose the server publicly.
