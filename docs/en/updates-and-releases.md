# Updates and releases

The client and the Linux server share one update manifest, fetched from the Ruodao release API by default:

```http
GET https://ruodao.com/api/desktop/releases
    ?product=ruodao-remote
    &channel=stable
    &platform=win32
    &arch=x64
    &current=0.1.0
```

`product` is `ruodao-remote` (client) or `ruodao-remote-server` (server).

> This repository ships the client and server programs only — the `ruodao.com` backend is not included. A distributor must implement the manifest endpoint described below, or point the updaters at an existing one with environment variables.

[简体中文](../更新与发布.md) · [**English**](updates-and-releases.md)

## 0. Version source

- `version.json` at the repository root is the single source of truth; `client/package.json` and `server/package.json` must match it;
- bump with `node scripts/set-version.mjs 0.2.0` (also accepts `patch` / `minor` / `major`), which syncs both packages and lockfiles;
- `scripts/check-version.mjs` runs before every build and aborts on a mismatch;
- the server build injects the version into `server.cjs` via esbuild, so a single-file deployment reports correctly; the client uses the Electron app version;
- the manifest script reads `version.json` by default, no `--version` needed.

## 1. Manifest format

The grouped form is recommended:

```json
{
  "success": true,
  "data": {
    "products": {
      "ruodao-remote": {
        "version": "0.2.0",
        "channel": "stable",
        "notes": "Fix reconnect after a dropped session",
        "publishedAt": "2026-10-31T02:00:00Z",
        "mandatory": false,
        "assets": [
          {
            "name": "RuodaoRemote-Setup-0.2.0.exe",
            "kind": "nsis",
            "platform": "win32",
            "arch": "x64",
            "url": "https://cdn.ruodao.com/ruodao-remote/0.2.0/RuodaoRemote-Setup-0.2.0.exe",
            "size": 12345678,
            "sha256": "<64 hex chars>"
          }
        ]
      },
      "ruodao-remote-server": {
        "version": "0.2.0",
        "channel": "stable",
        "notes": "Fix signaling session cleanup",
        "assets": [
          {
            "name": "server-0.2.0.cjs",
            "kind": "server-cjs",
            "platform": "linux",
            "arch": "x64",
            "url": "https://cdn.ruodao.com/ruodao-remote/0.2.0/server-0.2.0.cjs",
            "size": 293000,
            "sha256": "<64 hex chars>"
          }
        ]
      }
    }
  }
}
```

Two simplified shapes are also accepted:

- flat: `{ version, downloadUrl, sha256, notes }`;
- GitHub-Release style: `{ tag_name, body, assets: [{ browser_download_url, size }] }`.

Field rules:

| Field | Meaning |
| --- | --- |
| `version` | Semver, `v` prefix allowed |
| `notes` | Release notes shown in the update dialog, up to 8000 characters |
| `mandatory` | Shows a warning only; the app never force-quits |
| `assets[].kind` | Client: `nsis` > `exe` > `msi` > `zip`; server accepts `server-cjs` only |
| `assets[].platform` / `arch` | `win32` / `linux`, `x64` / `arm64`; empty matches anything |
| `assets[].sha256` | **Required** — a missing digest makes both updaters refuse the download |

## 2. Security constraints

- download URLs must be HTTPS on `ruodao.com` or a subdomain;
- extra hosts: `RUODAO_UPDATE_HOSTS` (client) and `UPDATE_ALLOWED_HOSTS` (server), comma-separated;
- client installers are capped at 400 MB, server bundles at 50 MB;
- downloads go to a `.part` file and are atomically renamed only after size and SHA-256 match;
- the server staging directory is `0700`, files `0600`;
- the server process runs as `ruodao` without privileges. One-click deployments install a separate root timer that runs `--self-update` inside systemd sandboxing; manual installs (or a disabled timer) only produce a copy-paste command for the administrator.

If the manifest lives on GitHub Releases, add `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com` to the allow-list.

## 3. Client update behaviour

| Behaviour | Detail |
| --- | --- |
| Automatic check | 12 seconds after launch for packaged builds, then every 6 hours |
| Automatic download | On by default; downloads in the background and verifies SHA-256 |
| Install | Silently on app exit after download; or click *Restart and install* |
| Manual check | Click the version badge → *Check for updates*, or the client card under *Server → Overview → Versions & updates* |
| Version display | The card shows client and server versions plus update phase; the server card links to *Server settings → Server update* |
| Portable build | Cannot overwrite itself — the download opens its folder for a manual swap |
| Development mode | No checks; set `RUODAO_UPDATE_FORCE=1` to test |

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RUODAO_UPDATE_BASE_URL` | `https://ruodao.com` | Update source (or `RUODAO_API_BASE_URL`) |
| `RUODAO_UPDATE_PATH` | `/api/desktop/releases` | Manifest path |
| `RUODAO_UPDATE_CHANNEL` | `stable` | Channel |
| `RUODAO_UPDATE_INTERVAL_HOURS` | `6` | Check interval (minimum 1 hour) |
| `RUODAO_UPDATE_HOSTS` | empty | Extra download hosts |
| `RUODAO_UPDATE_FORCE` | empty | `1` allows checks in development mode |

## 4. Server update behaviour

Client: *Server → Overview → Versions & updates* shows the status; *Server settings → Server update* performs the actions. The web console exposes the same card under *Activity & settings → Server update*.

1. **Check** — read the manifest and compare versions (read-only);
2. **Download and verify** — fetch the `server-cjs` asset into `DATA_DIR/updates` and verify size and SHA-256;
3. **Apply**:
   - one-click deployments install `ruodao-remote-update.service` + `.timer`: root, first check 10 minutes after boot, then hourly; it reads `sessions` from the local `/health`, defers while a session is active, then downloads, atomically replaces `/opt/ruodao/server.cjs` (keeping `.bak`), restarts and waits for the new version's health check — rolling back on failure;
   - without the timer, the page prints a one-line command for the administrator:
     ```bash
     sudo install -o root -g root -m 0644 <staged file> /opt/ruodao/server.cjs && sudo systemctl restart 'ruodao-remote'
     ```
   - with `UPDATE_APPLY_COMMAND`, a helper process runs with `RUDAO_UPDATE_FILE`, `RUDAO_UPDATE_SHA256`, `RUDAO_UPDATE_VERSION`, `RUDAO_UPDATE_ENTRY` and `RUDAO_UPDATE_SERVICE` in the environment; automatic application additionally needs `UPDATE_AUTO_APPLY=1` and no active session;
   - re-running the one-click deploy installs the timer on an existing server without touching data or configuration.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `UPDATE_ENABLED` | `1` | `0` disables updates entirely; the built-in Windows server is always off |
| `UPDATE_BASE_URL` | `https://ruodao.com` | Update source |
| `UPDATE_MANIFEST_PATH` | `/api/desktop/releases` | Manifest path |
| `UPDATE_CHANNEL` | `stable` | Channel |
| `UPDATE_ENTRY_FILE` | `/opt/ruodao/server.cjs` | File to replace |
| `UPDATE_SERVICE_NAME` | `ruodao-remote` | Service to restart |
| `UPDATE_STAGE_DIR` | `DATA_DIR/updates` | Staging directory |
| `UPDATE_CHECK_HOURS` | `6` | In-process check interval |
| `UPDATE_AUTO_APPLY` | `0` | Let the helper apply automatically |
| `UPDATE_SYSTEM_UPDATER` | on for one-click deploys | Marks the root system timer as the updater |
| `UPDATE_REQUIRE_IDLE` | `1` | Defer while sessions are active |
| `UPDATE_APPLY_COMMAND` | empty | Helper command |
| `UPDATE_ALLOWED_HOSTS` | empty | Extra allowed hosts |

`GET /api/version` returns the current version and whether an update is available — useful for external monitoring.

## 5. Release steps

### 5.1 Build the client

```bash
cd client
npm ci
npm run build
npx electron-builder --win nsis --publish never
```

The artifact lands in `client/release/RuodaoRemote-Setup-<version>.exe`. It is unsigned; configure code signing before public distribution.

### 5.2 Build the server bundle

```bash
cd server
npm ci
npm run build
cd ../client
npm run build:server          # emits resources/server/server.cjs
```

Zip `resources/server/server.cjs`, `packaging/server/install.sh`, `packaging/server/ruodao-remote.service` and `server/.env.example`:

```bash
cd packaging/server
zip -j ../../release/ruodao-remote-server.zip \
  ../../client/resources/server/server.cjs \
  install.sh ruodao-remote.service ../../server/.env.example
```

The GitHub Release in this repository already ships `ruodao-remote-server.zip`.

### 5.3 Generate the manifest

```bash
# at the repository root (syncs version.json and both package.json files)
node scripts/set-version.mjs 0.2.0

cd client
node scripts/make-update-manifest.mjs \
  --notes "Fix reconnect after a dropped session" \
  --base https://cdn.ruodao.com/ruodao-remote/0.2.0/ \
  --asset release/RuodaoRemote-Setup-0.2.0.exe \
  --server ../client/resources/server/server.cjs \
  --out release/update-manifest.json
```

The script computes size and SHA-256 for both products. Serve the result from the release endpoint.

### 5.4 Upload and publish

1. Upload the installer, server bundle and manifest to the CDN; make sure `--base` matches the real download URLs;
2. update the manifest, then verify check → download → verify → install on a test client;
3. create the tag and GitHub Release with the installer, server bundle and `SHA256SUMS.txt`;
4. watch `update.*` events in the server log for spikes of `check-failed` or `download-failed`.

### 5.5 Rolling back

- Client: point the manifest `version` back, or serve the previous version with `mandatory: false`. Upgraded clients do not downgrade automatically — users must install the old package manually.
- Server: a failed automatic update rolls back to `/opt/ruodao/server.cjs.bak` and restarts. Manual rollback:
  `sudo install -o root -g root -m 0644 /opt/ruodao/server.cjs.bak /opt/ruodao/server.cjs && sudo systemctl restart ruodao-remote`.
- If the manifest endpoint is down, both updaters only report a failed check; remote control keeps working.

## 6. Verifying release artifacts

```bash
sha256sum RuodaoRemote-Setup-0.2.0.exe ruodao-remote-server.zip
```

Write the result into `SHA256SUMS.txt` and publish it with the release. Users can then run:

```bash
sha256sum -c SHA256SUMS.txt
```
