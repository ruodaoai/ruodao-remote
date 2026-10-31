export interface DeployPortInput {
  sshPort: number;
  installTurn: boolean;
  tcpUsed: readonly number[];
  udpUsed: readonly number[];
  random?: () => number;
}

export interface DeployPortPlan {
  secure: boolean;
  entryPort: number;
  /** Port 80 when Caddy can serve the ACME HTTP challenge and redirect; 0 when TLS-ALPN on 443 is required. */
  redirectPort: number;
  internalPort: number;
  turnPort: number;
  relayMin: number;
  relayMax: number;
}

const ENTRY_MIN = 18000;
const ENTRY_MAX = 31999;
const INTERNAL_MIN = 12000;
const INTERNAL_MAX = 15999;
const TURN_MIN = 10000;
const TURN_MAX = 11999;
const RELAY_MIN = 50000;
const RELAY_MAX = 59900;
const RELAY_BLOCK = 100;
const RELAY_ATTEMPTS = 40;

// Ports used by common services even in the high range; never hand these to the deploy.
const RESERVED_PORTS = new Set([
  11211, 1521, 1433, 2375, 2376, 2377, 3000, 3306, 3389, 5000, 5432, 5672, 6379, 7000, 7001,
  8000, 8080, 8081, 8443, 8888, 9000, 9090, 9200, 9300, 15672, 27017,
]);

function randomInt(random: () => number, min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.min(span - 1, Math.max(0, Math.floor(random() * span)));
}

function isFree(port: number, used: ReadonlySet<number>): boolean {
  return !used.has(port) && !RESERVED_PORTS.has(port);
}

function pickRandomPort(
  random: () => number,
  min: number,
  max: number,
  used: ReadonlySet<number>,
): number {
  const start = randomInt(random, min, max);
  const span = max - min + 1;
  for (let offset = 0; offset < span; offset += 1) {
    const port = min + ((start - min + offset) % span);
    if (isFree(port, used)) return port;
  }
  return 0;
}

function relayBlockFree(start: number, udpUsed: ReadonlySet<number>): boolean {
  for (let port = start; port < start + RELAY_BLOCK; port += 1) {
    if (udpUsed.has(port)) return false;
  }
  return true;
}

function pickRelayRange(
  random: () => number,
  udpUsed: ReadonlySet<number>,
): readonly [number, number] | null {
  const last = RELAY_MAX - RELAY_BLOCK;
  const blocks = Math.floor((last - RELAY_MIN) / RELAY_BLOCK) + 1;
  const startIndex = randomInt(random, 0, blocks - 1);
  for (let attempt = 0; attempt < RELAY_ATTEMPTS; attempt += 1) {
    const index = (startIndex + attempt) % blocks;
    const start = RELAY_MIN + index * RELAY_BLOCK;
    if (relayBlockFree(start, udpUsed)) return [start, start + RELAY_BLOCK - 1];
  }
  return null;
}

export function parsePortList(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((item) => Number(item))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
}

export function sslipHostname(ip: string): string {
  return `${ip.split(".").join("-")}.sslip.io`;
}

export function planDeployPorts(input: DeployPortInput): DeployPortPlan {
  const random = input.random ?? Math.random;
  const tcpUsed = new Set<number>(input.tcpUsed);
  const udpUsed = new Set<number>(input.udpUsed);
  tcpUsed.add(input.sshPort);

  // Let's Encrypt validates on 80 (HTTP-01) or 443 (TLS-ALPN). Without one of
  // them a free certificate cannot be issued, so refuse to fall back to HTTP.
  let entryPort: number;
  let redirectPort = 0;
  if (!tcpUsed.has(80)) {
    redirectPort = 80;
    tcpUsed.add(80);
    entryPort = pickRandomPort(random, ENTRY_MIN, ENTRY_MAX, tcpUsed);
    if (!entryPort) throw new Error("没有可用于 HTTPS 的非标准入口端口，请释放 18000-31999 之间的端口后重试。");
    tcpUsed.add(entryPort);
  } else if (!tcpUsed.has(443)) {
    entryPort = 443;
    tcpUsed.add(443);
  } else {
    throw new Error(
      "80 和 443 都已被其他服务占用，无法通过 Let's Encrypt 验证域名，不能自动启用 HTTPS。请先释放 TCP 80 或 TCP 443 后重新部署。",
    );
  }

  const internalPort = pickRandomPort(random, INTERNAL_MIN, INTERNAL_MAX, tcpUsed);
  if (!internalPort) throw new Error("没有可用的本机信令端口，请释放 12000-15999 之间的端口后重试。");
  tcpUsed.add(internalPort);

  let turnPort = 0;
  let relayMin = 0;
  let relayMax = 0;
  if (input.installTurn) {
    // TURN listens on both TCP and UDP for the same port.
    const turnUsed = new Set<number>([...tcpUsed, ...udpUsed]);
    turnPort = pickRandomPort(random, TURN_MIN, TURN_MAX, turnUsed);
    if (turnPort) {
      const range = pickRelayRange(random, udpUsed);
      if (range) {
        relayMin = range[0];
        relayMax = range[1];
      } else {
        turnPort = 0;
      }
    }
  }

  return { secure: true, entryPort, redirectPort, internalPort, turnPort, relayMin, relayMax };
}

export function formatEntryUrl(name: string, secure: boolean, port: number): string {
  const scheme = secure ? "https" : "http";
  const defaultPort = secure ? 443 : 80;
  const host = name.includes(":") && !name.startsWith("[") ? `[${name}]` : name;
  return port === defaultPort ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

export interface CaddyfileInput {
  siteHost: string;
  entryPort: number;
  redirectPort: number;
  internalPort: number;
  storageDir: string;
}

export function buildCaddyfile(input: CaddyfileInput): string {
  const httpsOrigin = formatEntryUrl(input.siteHost, true, input.entryPort);
  const httpsAddress =
    input.entryPort === 443 ? `https://${input.siteHost}` : `https://${input.siteHost}:${input.entryPort}`;
  const lines = [
    "# managed by ruodao-remote",
    "{",
    "\tadmin off",
    "\tauto_https disable_redirects",
    "\tservers {",
    "\t\tprotocols h1 h2",
    "\t}",
    `\tstorage file_system ${input.storageDir}`,
    "}",
    "",
    `${httpsAddress} {`,
    "\tencode zstd gzip",
  ];
  if (!input.redirectPort) {
    // Port 80 belongs to another service: issue the certificate via TLS-ALPN on 443.
    lines.push(
      "\ttls {",
      "\t\tissuer acme {",
      "\t\t\tdisable_http_challenge",
      "\t\t}",
      "\t}",
    );
  }
  lines.push(`\treverse_proxy 127.0.0.1:${input.internalPort}`);
  lines.push(
    "\theader {",
    '\t\tStrict-Transport-Security "max-age=31536000"',
    '\t\tX-Content-Type-Options "nosniff"',
    '\t\tReferrer-Policy "no-referrer"',
    "\t\t-Server",
    "\t}",
    "}",
    "",
  );
  if (input.redirectPort) {
    // Caddy answers the ACME HTTP challenge before this redirect route.
    lines.push(`http://${input.siteHost}:${input.redirectPort} {`);
    lines.push(`\tredir ${httpsOrigin}{uri} permanent`);
    lines.push("}", "");
  }
  return lines.join("\n");
}

export interface TurnConfigInput {
  listenPort: number;
  relayMin: number;
  relayMax: number;
  secret: string;
  realm: string;
  serverName: string;
  externalIp: string;
  denyPrivatePeers: boolean;
  userQuota?: number;
  totalQuota?: number;
  maxBps?: number;
}

const NODE_MIN_GLIBC: readonly [number, number] = [2, 28];

export function parseGlibcVersion(value: string): [number, number] | null {
  const match = /(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

// Official x64 builds need glibc >= 2.28 plus libatomic; older systems use the unofficial glibc-217 build.
export function needsGlibc217Node(glibc: string, arch: string): boolean {
  if (arch !== "x64") return false;
  const version = parseGlibcVersion(glibc);
  if (!version) return false;
  const [major, minor] = NODE_MIN_GLIBC;
  return version[0] < major || (version[0] === major && version[1] < minor);
}

export interface NodeTarball {
  dirName: string;
  url: string;
}

export function nodeTarball(version: string, arch: string, compat: boolean): NodeTarball {
  const dirName = compat
    ? `node-${version}-linux-x64-glibc-217`
    : `node-${version}-linux-${arch}`;
  const base = compat
    ? "https://unofficial-builds.nodejs.org/download/release"
    : "https://nodejs.org/dist";
  return { dirName, url: `${base}/${version}/${dirName}.tar.gz` };
}

export function buildTurnserverConf(input: TurnConfigInput): string {
  const lines = [
    "# managed by ruodao-remote",
    `listening-port=${input.listenPort}`,
    "fingerprint",
    "lt-cred-mech",
    "use-auth-secret",
    `static-auth-secret=${input.secret}`,
    `realm=${input.realm}`,
    `server-name=${input.serverName || "ruodao-remote"}`,
    `min-port=${input.relayMin}`,
    `max-port=${input.relayMax}`,
    `user-quota=${input.userQuota ?? 12}`,
    `total-quota=${input.totalQuota ?? 100}`,
    `max-bps=${input.maxBps ?? 1_500_000}`,
    "max-allocate-lifetime=600",
    "channel-lifetime=300",
    "permission-lifetime=300",
    "stale-nonce=600",
    "no-cli",
    "no-tls",
    "no-dtls",
    "no-multicast-peers",
    "no-loopback-peers",
    "no-software-attribute",
  ];
  if (input.externalIp) lines.push(`external-ip=${input.externalIp}`);
  if (input.denyPrivatePeers) {
    lines.push(
      "denied-peer-ip=10.0.0.0-10.255.255.255",
      "denied-peer-ip=172.16.0.0-172.31.255.255",
      "denied-peer-ip=192.168.0.0-192.168.255.255",
      "denied-peer-ip=169.254.0.0-169.254.255.255",
    );
  }
  lines.push("");
  return lines.join("\n");
}
