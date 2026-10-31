import path from "node:path";
import { createRemoteServer } from "./server";
import { runSelfUpdate } from "./self-update";
import { parseIceEnv } from "./ice";
import type { RegistrationMode } from "./store";
import { SERVER_VERSION } from "./version";
import { normalizeUpdateBaseUrl } from "./update-manifest";

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function log(event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...meta }));
}

function readRegistrationMode(value: string | undefined): RegistrationMode {
  return value === "approval" || value === "open" || value === "invite" ? value : "invite";
}

const port = readNumber(process.env.PORT, 8787);
const host = process.env.HOST?.trim() || "0.0.0.0";
const trustProxy = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ice = parseIceEnv(process.env);
const dataDir = path.resolve(process.env.DATA_DIR?.trim() || "./data");
const dataFile = path.join(dataDir, "state.json");
const publicUrl = (process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
const serverName = (process.env.SERVER_NAME ?? "").trim() || "若道远程服务";
const registrationMode = readRegistrationMode(process.env.REGISTRATION_MODE);
const adminSessionHours = readNumber(process.env.ADMIN_SESSION_HOURS, 12);
const adminPassword = (process.env.ADMIN_PASSWORD ?? "").trim();
const adminPasswordHash = (process.env.ADMIN_PASSWORD_HASH ?? "").trim();
const adminPath = (process.env.ADMIN_PATH ?? "").trim() || null;
const healthToken = (process.env.HEALTH_TOKEN ?? "").trim() || null;
const securityLogFile =
  (process.env.SECURITY_LOG_FILE ?? "").trim() || path.join(dataDir, "security.log");

const updateEnabled =
  process.env.UPDATE_ENABLED !== "0" && process.env.UPDATE_ENABLED !== "false";
const updateBaseUrl = normalizeUpdateBaseUrl(
  process.env.UPDATE_BASE_URL?.trim() ||
    process.env.RUODAO_API_BASE_URL?.trim() ||
    "https://ruodao.com",
);
const updateChannel = process.env.UPDATE_CHANNEL?.trim() || "stable";
const updateManifestPath =
  process.env.UPDATE_MANIFEST_PATH?.trim() || "/api/desktop/releases";
const updateEntryFile = process.env.UPDATE_ENTRY_FILE?.trim() || "/opt/ruodao/server.cjs";
const updateServiceName = process.env.UPDATE_SERVICE_NAME?.trim() || "ruodao-remote";
const updateStageDir = process.env.UPDATE_STAGE_DIR?.trim() || path.join(dataDir, "updates");
const updateApplyCommand = process.env.UPDATE_APPLY_COMMAND?.trim() || null;
const updateAutoApply = process.env.UPDATE_AUTO_APPLY === "1";
const updateSystemUpdater = process.env.UPDATE_SYSTEM_UPDATER === "1";
const updateCheckHours = readNumber(process.env.UPDATE_CHECK_HOURS, 6);
const updateAllowedHosts = (process.env.UPDATE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (process.argv.includes("--self-update")) {
  void runSelfUpdate({
    currentVersion: SERVER_VERSION,
    enabled: updateEnabled,
    baseUrl: updateBaseUrl,
    manifestPath: updateManifestPath,
    channel: updateChannel,
    platform: process.platform,
    arch: process.arch,
    entryFile: updateEntryFile,
    serviceName: updateServiceName,
    stageDir: updateStageDir,
    allowedHosts: updateAllowedHosts,
    requireIdle: process.env.UPDATE_REQUIRE_IDLE !== "0",
    healthUrl: `http://127.0.0.1:${port}/health`,
    healthToken,
    log,
  })
    .then((result) => {
      log("self-update.finished", {
        status: result.status,
        currentVersion: result.currentVersion,
        targetVersion: result.targetVersion,
        message: result.message,
      });
      process.exitCode = result.status === "failed" ? 1 : 0;
    })
    .catch((error: unknown) => {
      log("self-update.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
} else {
  startServer();
}

function startServer(): void {
  const server = createRemoteServer({
    host,
    port,
    trustProxy,
    ice,
    allowedOrigins,
    dataFile,
    publicUrl,
    serverName,
    registrationMode,
    adminPassword: adminPassword || null,
    adminPasswordHash: adminPasswordHash || null,
    adminSessionMs: adminSessionHours * 60 * 60 * 1000,
    adminPath,
    healthToken,
    securityLogFile,
    maxAttemptsPerMinute: readNumber(process.env.MAX_ATTEMPTS_PER_MINUTE, 10),
    heartbeatMs: readNumber(process.env.HEARTBEAT_SECONDS, 30) * 1000,
    maxConnectionsPerIp: readNumber(process.env.MAX_CONNECTIONS_PER_IP, 8),
    maxTotalConnections: readNumber(process.env.MAX_TOTAL_CONNECTIONS, 400),
    messageLimitPer10s: readNumber(process.env.MESSAGE_LIMIT_PER_10S, 120),
    httpRequestsPerMinute: readNumber(process.env.HTTP_REQUESTS_PER_MINUTE, 600),
    serverStatsIntervalMs: readNumber(process.env.SERVER_STATS_SECONDS, 5) * 1000,
    update: {
      currentVersion: SERVER_VERSION,
      enabled: updateEnabled,
      baseUrl: updateBaseUrl,
      manifestPath: updateManifestPath,
      channel: updateChannel,
      platform: process.platform,
      arch: process.arch,
      entryFile: updateEntryFile,
      serviceName: updateServiceName,
      stageDir: updateStageDir,
      applyCommand: updateApplyCommand,
      autoApply: updateAutoApply,
      systemUpdater: updateSystemUpdater,
      checkIntervalMs: updateCheckHours * 60 * 60 * 1000,
      allowedHosts: updateAllowedHosts,
    },
    log,
  });

  server
    .listen()
    .then(({ port: actualPort }) => {
      log("server.started", {
        host,
        port: actualPort,
        version: SERVER_VERSION,
        turn: ice.turnUrls.length > 0 && Boolean(ice.turnSecret),
        stun: ice.stunUrls.length,
        allowedOrigins: allowedOrigins.length,
        dataFile,
        publicUrl: publicUrl || null,
        registrationMode,
        admin: Boolean(adminPassword || adminPasswordHash),
        adminPath: adminPath ?? "/admin",
        healthProtected: Boolean(healthToken),
        securityLogFile,
        update: updateEnabled
          ? {
              source: updateBaseUrl,
              channel: updateChannel,
              autoApply: updateAutoApply,
              applyMode: updateApplyCommand
                ? "command"
                : updateSystemUpdater
                  ? "system"
                  : "manual",
            }
          : false,
      });
      if (!adminPassword && !adminPasswordHash) {
        log("server.admin-disabled", {
          hint: "设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_HASH 后重启以启用 /admin 管理后台",
        });
      }
    })
    .catch((error: unknown) => {
      log("server.failed", { message: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log("server.stopping", { signal });
    const timer = setTimeout(() => process.exit(1), 5000);
    timer.unref();
    try {
      await server.close();
    } finally {
      clearTimeout(timer);
      log("server.stopped");
      process.exit(0);
    }
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
