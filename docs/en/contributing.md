# Contributing

[简体中文](../../CONTRIBUTING.md) · [**English**](contributing.md)

Thanks for improving Ruodao Remote. The project ships both an Electron client and a Node.js server, so most changes touch both sides — please run the checks below before opening a pull request.

## Before you start

- **Do not open a public issue for security problems** — follow [SECURITY.md](../../SECURITY.md);
- usage questions: check the [FAQ](faq.md) and the in-app guide first;
- for code changes, open an issue describing the motivation and approach so nobody builds the wrong thing.

## Setup

Node.js 20+ is required (CI runs Node 22, development uses Node 24).

```bash
git clone https://github.com/<your-account>/ruodao-remote.git
cd ruodao-remote

cd server && npm ci
cd ../client && npm ci
```

Client development:

```bash
cd server && npm run build && npm start     # terminal 1: signaling
cd client && npm run dev                    # terminal 2: Vite + Electron
```

Renderer changes hot-reload; main-process changes need a restart.

## Layout

| Path | Responsibility |
| --- | --- |
| `client/electron/` | main process: signaling, sessions, sharing, deploy, updates, community, settings |
| `client/src/` | renderer: pages, components, hooks, styles (`styles.css`) |
| `client/scripts/` | build, screenshots, manifest and smoke scripts |
| `server/src/` | signaling server, registry, admin console, update implementation |
| `docs/` | Chinese docs; `docs/en/` English docs; `docs/images/` README screenshots |
| `packaging/server/` | deployment scripts and systemd template |

- A new environment variable must be added to `server/.env.example`, `docs/技术文档.md` and `docs/en/technical-reference.md`;
- user-visible strings must exist in Chinese and English: write `t("中文原文")` in components (use `tf("… {0}", value)` for interpolation) and add the entry to `client/src/i18n/en.ts`;
- after changing copy, run `node client/scripts/i18n-audit.mjs` and make sure it reports 0 missing and 0 unwrapped strings;
- screenshots are produced by `client/scripts/capture-docs-shots.mjs` — do not replace them with hand-made captures.

## Branches and commits

- Branch from `main` as `feat/<topic>`, `fix/<topic>` or `docs/<topic>`;
- one concern per pull request; avoid unrelated formatting noise;
- commit subjects follow `type: summary` with `type` in `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`;
- UI changes should include before/after screenshots.

Examples:

```
feat: sort shared servers by latency
fix: reset clipboard button state when a session ends
docs: add coturn example to the English deployment guide
```

## Checks before pushing

```bash
cd server
npm run typecheck
npm test
npm run build

cd ../client
npm run typecheck
npm test
npm run build
```

- changes to the session path: also run `cd client && npm run smoke` (two Electron windows, takes over the mouse for about a minute, needs an interactive desktop);
- changes to the shared-server UI: run `cd client && node scripts/verify-shared-ui.mjs`;
- the version lives in `version.json`; bump it with `node scripts/set-version.mjs <version>` instead of editing `package.json` files by hand.

## Pull request checklist

- [ ] Motivation and scope explained (client / server / docs);
- [ ] new or changed logic is covered by tests, or the reason it cannot be automated is stated;
- [ ] `typecheck`, `test` and `build` pass on both packages;
- [ ] screenshots for UI changes, docs and env examples updated for configuration changes;
- [ ] no `.env`, keys, private keys, real server addresses or log files committed;
- [ ] no new GPL/AGPL-style copyleft dependency (this project is MIT).

## Reporting bugs

Open an [issue](https://github.com/ruodaoai/ruodao-remote/issues) with:

1. client and server versions (version badge / `GET /api/version`);
2. OS version and network setup (same machine, LAN, internet, TURN or not);
3. reproduction steps and expected behaviour;
4. screenshots of the error, or the relevant `journalctl -u ruodao-remote -n 100` lines (redacted).

**Never paste remote codes, access keys, admin passwords, invite codes, SSH private keys or full public addresses.**
