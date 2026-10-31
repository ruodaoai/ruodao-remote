import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.resolve(clientDir, "..", "server");
const serverEntry = path.join(serverDir, "dist", "index.js");
const smokeDir = path.join(clientDir, ".smoke");
const require = createRequire(import.meta.url);
const electron = require("electron");
const packagedExe = process.env.REMOTE_SMOKE_EXE?.trim();

if (!existsSync(serverEntry)) {
  console.error(`[smoke] missing ${serverEntry}; run "npm run build" in server first`);
  process.exit(1);
}
if (!existsSync(path.join(clientDir, "dist", "index.html"))) {
  console.error('[smoke] missing dist/index.html; run "npm run build" in client first');
  process.exit(1);
}

rmSync(smokeDir, { recursive: true, force: true });
mkdirSync(path.join(smokeDir, "userdata"), { recursive: true });

const port = 18000 + Math.floor(Math.random() * 900);
const serverLog = [];

const server = spawn(process.execPath, [serverEntry], {
  cwd: serverDir,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    REGISTRATION_MODE: "open",
    DATA_DIR: path.join(smokeDir, "server-data"),
    ADMIN_PASSWORD: "smoke-admin-password",
    UPDATE_SYSTEM_UPDATER: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));

function stopServer() {
  if (!server.killed) {
    try {
      server.kill("SIGTERM");
    } catch {
      // The server has already exited.
    }
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 1200 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited with code ${server.exitCode}\n${serverLog.join("")}`);
    }
    if (await checkHealth()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not become healthy\n${serverLog.join("")}`);
}

function runElectron() {
  return new Promise((resolve) => {
    const child = spawn(packagedExe || electron, packagedExe ? [] : ["."], {
      cwd: clientDir,
      env: {
        ...process.env,
        REMOTE_SMOKE_DIR: smokeDir,
        REMOTE_SERVER_URL: `http://127.0.0.1:${port}`,
        REMOTE_DEVTOOLS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      process.stderr.write(text);
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

let exitCode = 1;
try {
  await waitForServer();
  const { code, output } = await runElectron();
  const resultPath = path.join(smokeDir, "result.json");
  if (existsSync(resultPath)) {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    console.log(`[smoke] result: ${JSON.stringify(result, null, 2)}`);
    exitCode = result.ok ? 0 : 1;
  } else {
    console.error(`[smoke] no result.json produced`);
    console.error(output.join(""));
    exitCode = 1;
  }
  exitCode = code === 0 && exitCode === 0 ? 0 : 1;
} catch (error) {
  console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  stopServer();
}

process.exit(exitCode);
