# FAQ

[简体中文](../常见问题.md) · [**English**](faq.md)

## Account and cost

**Do I need a Ruodao account?**

No. Remote control itself is fully anonymous: the host generates a remote code and access key, the controller types them. Only *Ask AI* and posting in the *Community* tab require a Ruodao account, and both are optional.

**Is it free?**

The client and server sources are published in this repository and you can deploy them yourself. If you use Ruodao-hosted services or plugin-market features, their own pages apply.

**Does it upload my device information to Ruodao?**

The session only traverses the signaling server you configured; the client never sends codes, keys or pixels to Ruodao. The AI assistant sends a state summary and your question only when you ask. Community posts are public only when you publish them.

## Install and compatibility

**Windows says "Unknown publisher" / SmartScreen blocks the installer.**

The installer is not code-signed yet. Click *More info* → *Run anyway*. If that matters to you, build and sign it yourself from source.

**360 or other security software flags the installer.**

Unsigned installers can trigger heuristics. Download only from this repository's Releases, verify against `SHA256SUMS.txt`, and add an exclusion. If the portable build is blocked, use the installer.

**Is there a macOS / Linux client?**

The client is Windows x64 only. Host-side input injection depends on Win32 `SendInput`, and the controller uses the same client. The server runs on Linux.

**Multiple monitors?**

Only the primary display is captured; switching is not supported.

**File transfer, audio, drag and drop?**

Not yet. Clipboard sync is plain text only (64 KB per item) and session chat is text.

**Unattended access?**

Yes. Enable *Auto-host on launch* and *Launch at login* on the host; it comes online after sign-in with a fresh code. For a stable entry point, share the device with server members and approve each request.

## Connecting

**Two computers cannot connect — what do I check first?**

1. *Settings → Server URL* is identical on both sides (scheme, host and port);
2. the host shows *Online* and has no other session (one controller per host at a time);
3. the host clicked *Start hosting*, or auto-hosting is on;
4. `/health` on the server is reachable and the reverse proxy forwards WebSocket upgrades;
5. the code and key were typed correctly (the key never contains `I`, `O`, `0` or `1`).

**Do I need a server on a LAN?**

Yes, something must run signaling. Start the built-in server in the client on one Windows machine and point the other at its LAN address (e.g. `http://192.168.1.20:8787`).

**Is TURN always required over the internet?**

No. Direct paths use STUN only; symmetric NAT or strict corporate networks need TURN. The one-click deploy can install coturn.

**Why does it say "busy"?**

A host accepts one controller at a time. End the existing session, or rotate the key on the host to invalidate it.

**Does the remote code stay valid forever?**

No. The code and key are valid only for the current hosting period; restarting the client, stopping hosting or rotating the key issues new ones. Restarting the server also invalidates active sessions.

## Security

**What can the server see?**

Device names, platforms, IPs, connection metadata and audit events. It cannot see screen content, input events or plaintext keys — media and data channels are DTLS-SRTP encrypted end to end.

**Is the key stored on the server?**

Only a 16-byte random salt plus a PBKDF2-SHA256 hash (210,000 iterations). Comparison uses `timingSafeEqual`.

**How strong is the key?**

Roughly 50 bits of entropy. Send it over a trusted channel, and rotate it after use.

**Can someone brute-force the code?**

Pairing attempts are rate limited (10 per minute by default) and the server locks repeated failures. Even so, do not publish codes publicly.

**Does clipboard sync leak secrets?**

It is off by default and must be enabled on both sides. When on, every clipboard change is transmitted — keep it off during sensitive work.

## In-session issues

**Black screen.**

Check that the host allows screen capture (Windows graphics settings / privacy), that it is not locked, and whether TURN is configured for public-internet sessions.

**Input does not reach the host.**

The host may have paused input, or the focused window is protected (UAC secure desktop, lock screen, Ctrl+Alt+Del).

**Picture stutters.**

Lower the quality preset, prefer a wired connection, and make sure TURN is close to both peers.

**Chat history disappeared.**

Session chat lives in memory only and is cleared when the session ends.

## Updates

**The client says the update check failed.**

The official feed must be reachable (`https://ruodao.com`). Behind a corporate proxy, allow that host or point `RUODAO_UPDATE_BASE_URL` at an internal mirror.

**Can updates be disabled?**

Yes. Turn off *Automatic updates* in the update dialog, or set `RUODAO_UPDATE_ENABLED=0` for a managed rollout.

**The server did not update itself.**

Manual installs have no update timer. Re-run the client's one-click deploy against the same host to install `ruodao-remote-update.timer`, or replace `/opt/ruodao/server.cjs` and restart the unit.

## Server

**Deployment fails at the certificate stage.**

At least one of TCP 80 / 443 must be free and the security group must allow it. Check DNS if you supplied a domain.

**Invite code lost.**

Open the admin console → *Invite codes* and create a new one, or switch to approval mode temporarily.

**Admin password forgotten.**

Edit `ADMIN_PASSWORD` in `/etc/ruodao-remote.env` (or remove `ADMIN_PASSWORD_HASH`) and restart the service.

**Can I host several servers from one client?**

Yes, the client keeps a list of servers with their admin credentials encrypted locally.
