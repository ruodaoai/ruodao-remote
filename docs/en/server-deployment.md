# Server deployment

Ruodao Remote does not depend on a Ruodao account, but it needs a **signaling server** both sides can reach. The server handles device registration, code pairing, SDP/ICE relay, device management and auditing — it never sees pixels or plaintext keys.

There are three common approaches:

1. Deploy to a Linux cloud server over SSH from the client (recommended);
2. Download the server bundle and install it manually;
3. Use the built-in Windows server for LAN or local testing.

[简体中文](../服务端部署.md) · [**English**](server-deployment.md)

## 1. Prerequisites

### Public Linux server (recommended)

- Ubuntu 22.04+ / Debian 12+, x86_64 or arm64; CentOS 7 / RHEL 7 (glibc 2.17) use a compatible Node.js build;
- at least 1 GB free disk;
- root, or an account with `sudo`;
- the cloud security group must allow the SSH port;
- HTTPS is mandatory: at least one of TCP 80 / 443 must be free for ACME validation. A domain is optional — without one the installer uses `<public-ip>.sslip.io` for a free certificate.

An existing website on the same host is fine: the installer avoids occupied ports and uses its own Caddy config and systemd units, leaving `/etc/caddy`, Nginx and BT panel configs untouched.

### Ports

| Port | Purpose |
| --- | --- |
| TCP 18000-31999 | HTTPS / WSS entry (random high port, avoids common ports) |
| TCP 80 / 443 | ACME validation and HTTP redirect (one must be free) |
| TCP 12000-15999 | Signaling port bound to 127.0.0.1 behind Caddy |
| TCP/UDP 10000-11999 | TURN / STUN (when TURN is installed) |
| UDP 50000-59900 | TURN relay range (when TURN is installed) |

Busy ports are re-planned automatically; treat the port shown on the result page as authoritative. Manual installs can override via environment variables.

## 2. Option A — deploy from the client (recommended)

### Steps

1. Client → *Server* tab → **Deploy a new server**.
2. Enter the host, SSH port (default 22), account, and a password or private key (passphrase supported).
3. Optionally enter a domain. With correct DNS you get a certificate for it; otherwise `<public-ip>.sslip.io` is used, and HTTPS is always enabled.
4. Choose a registration mode: invite / approval / open (see section 5).
5. Choose whether to install TURN. Recommended for public internet and symmetric NAT.
6. Click **Start deployment**. The first connection shows the server's SHA-256 fingerprint; confirm and it is pinned for later deployments.
7. Watch the 11 stages finish with live logs.

The installer will:

- install or reuse Node.js and Caddy;
- create the `ruodao` service account and the `/var/lib/ruodao` data directory;
- upload the server program to `/opt/ruodao/server.cjs`;
- write `/etc/ruodao-remote.env` and `ruodao-remote.service`;
- install `ruodao-remote-update.service` + `.timer`: hourly checks, install while no session is active, roll back on failure;
- optionally install coturn, generate a TURN secret and wire it up;
- reverse-proxy through a dedicated `ruodao-caddy` service;
- open only the ports actually used in ufw / firewalld;
- verify the public health endpoint and admin login from the client afterwards.

### Result page

- server URL (HTTPS or HTTP) and the real entry port;
- admin password (encrypted and stored locally);
- invite code (auto-created on first deploy in invite mode, 7 days, 20 uses);
- local signaling port, TURN ports and relay range;
- security-group ports you still need to open.

Click **Use as my server** to point this client at it, or send the URL and invite code to whoever needs access.

### Re-deploying

Deployment is idempotent: it reuses the existing admin password, TURN secret and data directory, and never wipes devices or invite codes. If a Caddy / coturn config with the same name was not written by this tool, it is left alone.

## 3. Option B — manual install from the bundle

For teams that do not want the client wizard or manage their own reverse proxy.

```bash
# on the server, as root
curl -LO https://github.com/ruodaoai/ruodao-remote/releases/latest/download/ruodao-remote-server.zip
unzip ruodao-remote-server.zip -d ruodao-remote-server
cd ruodao-remote-server
sudo bash install.sh
```

The script will:

1. check root and Node.js (20+; it tells you to install it if missing);
2. create the `ruodao` system user and `/var/lib/ruodao`;
3. install `server.cjs` to `/opt/ruodao/server.cjs`;
4. generate an admin password into `/etc/ruodao-remote.env` on first install (kept as-is on upgrades);
5. write and start the `ruodao-remote` systemd unit;
6. wait for `/health` and print the admin password, URL and next steps.

Override defaults with environment variables:

```bash
sudo PORT=8787 \
     PUBLIC_URL=https://remote.example.com \
     REGISTRATION_MODE=invite \
     SERVER_NAME="Engineering remote" \
     ADMIN_PASSWORD='a-strong-password' \
     bash install.sh
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Local listen port |
| `PUBLIC_URL` | empty | Public URL used for display and TURN hints |
| `REGISTRATION_MODE` | `invite` | `invite` / `approval` / `open` |
| `SERVER_NAME` | `若道远程服务` | Name shown in the admin console and clients |
| `ADMIN_PASSWORD` | generated | At least 8 characters; random when empty |
| `NODE_BIN` | auto-detected | Explicit Node.js binary path |

Session guards (optional; write them to `/etc/ruodao-remote.env` then `systemctl restart ruodao-remote`, or change them in the console's *Risk control* page):

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_SESSIONS` | `0` | Maximum concurrent remote sessions; new requests are told the server is full. `0` = unlimited |
| `SESSION_LIMIT_MINUTES` | `0` | Maximum length of one session in minutes; ends automatically. `0` = unlimited |
| `COOLDOWN_MINUTES` | `5` | Cooldown for the same device/IP after hitting the session limit |
| `FREEZE_MINUTES` | `10` | Default duration of the console's *Freeze* action |

Policies saved in the console are persisted in the data directory and take precedence over environment variables, which only act as defaults.

Re-run `sudo bash install.sh` to upgrade; environment and data are preserved. Manual installs do not create the update timer — run the client's one-click deploy against the same host to add it (idempotent, no data or password reset).

### Useful commands

```bash
systemctl status ruodao-remote
journalctl -u ruodao-remote -f
curl http://127.0.0.1:8787/health
```

## 4. HTTPS and TURN

Production deployments must use HTTPS / WSS, otherwise codes, key hashes and SDP travel in plaintext.

### Caddy (recommended)

```caddyfile
remote.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
    }
}
```

Server settings:

```bash
TRUST_PROXY=1
PUBLIC_URL=https://remote.example.com
```

### Nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name remote.example.com;

    ssl_certificate     /etc/letsencrypt/live/remote.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/remote.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Enter `https://remote.example.com` in the client; it uses `wss://remote.example.com/ws` automatically. Behind a sub-path (e.g. `https://example.com/remote`) the WebSocket path becomes `/remote/ws` and the proxy `location` must match.

### coturn (required across NAT)

```ini
# /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=<same random string as TURN_SECRET>
realm=remote.example.com
external-ip=<public IP>
min-port=49160
max-port=49200
no-multicast-peers
no-loopback-peers
no-cli
```

```bash
systemctl restart coturn
```

Server environment:

```bash
TURN_URLS=turn:remote.example.com:3478?transport=udp,turn:remote.example.com:3478?transport=tcp
TURN_SECRET=<same as static-auth-secret>
TURN_TTL_SECONDS=3600
```

TURN credentials are issued through `/api/ice` and pairing messages over the WebSocket, so anyone who can reach the signaling server can request short-lived credentials. Keep the TTL short and enforce quotas on the coturn side.

## 5. Registration modes

| Mode | How new clients join | When to use |
| --- | --- | --- |
| `invite` | Must present a valid invite code; device approved automatically | Default; sharing with friends or a small team |
| `approval` | No invite code; new devices wait in *pending* until an admin approves | Semi-public servers |
| `open` | Anyone with the URL joins automatically | LAN or temporary use only |

The built-in Windows server always uses open mode; for anything public, deploy on Linux and pick invite or approval.

## 6. Admin console

- Web: `https://your-server/admin`
- Client: *Server* tab → my servers, with the URL and admin password — same features as the web console.

The console can:

- list online / offline clients with platform, version, last IP and last-seen time;
- allow, block or remove clients and drop their current connections;
- list active sessions and force-end them;
- create, revoke and delete invite codes, and inspect usage;
- list shared devices, their notes and pending control requests;
- inspect audit entries (device registration, control approvals, session endings);
- change the registration mode and server name;
- show client and server versions plus update status, check or download updates manually (automatic installs are done by the system timer while idle).

Admin login is verified with scrypt; the session is an HMAC-signed HttpOnly cookie (web) or a short-lived bearer token (client proxy), expiring after 12 hours. Repeated failures lock by IP and globally.

## 7. Data, backup and reset

- Devices, invite codes and audit logs live in `DATA_DIR/state.json`, written atomically via a temp file;
- active sessions, codes and key hashes are memory-only and vanish on restart;
- backup: copy `/var/lib/ruodao/state.json` and `/etc/ruodao-remote.env`;
- forgot the admin password: edit `ADMIN_PASSWORD` in `/etc/ruodao-remote.env` (or delete `ADMIN_PASSWORD_HASH`) and `systemctl restart ruodao-remote`;
- wipe devices and invite codes: stop the service, delete `state.json`, start again (irreversible — back up first).

## 8. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Client says the server URL is unreachable | Does `curl https://your-domain/health` return `"ok": true`? Does the proxy forward WebSocket upgrades? |
| Console works but clients cannot connect | Check `ALLOWED_ORIGINS` — desktop clients send `Origin: null`, so it is usually left empty. |
| Connected but the screen is black | Is screen capture allowed on the host? Is it locked? Cross-network: check TURN. |
| Admin password forgotten | See section 7. |
| Deployment stuck at a stage | Read the result log, or `journalctl -u ruodao-remote -n 100` and `journalctl -u ruodao-caddy -n 100`. |

More environment variables and protocol details: [Technical reference](technical-reference.md).
