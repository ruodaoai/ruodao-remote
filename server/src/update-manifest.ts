/** 服务端更新清单解析：与客户端共用同一份 ruodao.com 发布协议。 */

export const DEFAULT_UPDATE_BASE_URL = "https://ruodao.com";
export const UPDATE_MANIFEST_PATH = "/api/desktop/releases";
export const SERVER_PRODUCT = "ruodao-remote-server";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number | null;
  sha256: string | null;
  kind: string;
  platform: string;
  arch: string;
  channel: string;
}

export interface UpdateRelease {
  version: string;
  channel: string;
  notes: string;
  publishedAt: string | null;
  mandatory: boolean;
  assets: UpdateAsset[];
}

const VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const NOTE_LIMIT = 8000;

const PLATFORM_ALIASES: Record<string, string> = {
  windows: "win32",
  win: "win32",
  win32: "win32",
  win64: "win32",
  mac: "darwin",
  macos: "darwin",
  darwin: "darwin",
  linux: "linux",
};

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function positiveInt(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : null;
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

export function compareVersions(left: string, right: string): number {
  const a = VERSION_PATTERN.exec(normalizeVersion(left));
  const b = VERSION_PATTERN.exec(normalizeVersion(right));
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const segmentA = Number(a[index] ?? 0);
    const segmentB = Number(b[index] ?? 0);
    if (segmentA !== segmentB) return segmentA > segmentB ? 1 : -1;
  }
  const preA = a[4] ?? "";
  const preB = b[4] ?? "";
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const partA = partsA[index];
    const partB = partsB[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    if (partA === partB) continue;
    const numericA = /^\d+$/.test(partA);
    const numericB = /^\d+$/.test(partB);
    if (numericA && numericB) return Number(partA) > Number(partB) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return partA > partB ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  if (!normalizeVersion(candidate)) return false;
  return compareVersions(candidate, current) > 0;
}

export function normalizeUpdateBaseUrl(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  if (!raw) return DEFAULT_UPDATE_BASE_URL;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return DEFAULT_UPDATE_BASE_URL;
    if (url.username || url.password || url.search || url.hash) return DEFAULT_UPDATE_BASE_URL;
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "http:" && !loopback) return DEFAULT_UPDATE_BASE_URL;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return DEFAULT_UPDATE_BASE_URL;
  }
}

export function normalizeManifestPath(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return UPDATE_MANIFEST_PATH;
  return raw;
}

export function buildManifestUrl(
  baseUrl: string,
  query: { product: string; channel: string; platform: string; arch: string; currentVersion: string },
  manifestPath: string = UPDATE_MANIFEST_PATH,
): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${normalizeManifestPath(manifestPath)}`);
  url.searchParams.set("product", query.product);
  url.searchParams.set("channel", query.channel);
  url.searchParams.set("platform", query.platform);
  url.searchParams.set("arch", query.arch);
  if (query.currentVersion) url.searchParams.set("current", query.currentVersion);
  return url.toString();
}

function platformFromName(name: string): string {
  const lower = name.toLowerCase();
  if (/(win|windows|setup|portable)/.test(lower)) return "win32";
  if (/(mac|darwin|dmg)/.test(lower)) return "darwin";
  if (/(linux|server|\.cjs|\.tar\.gz)/.test(lower)) return "linux";
  return "";
}

function archFromName(name: string): string {
  const lower = name.toLowerCase();
  if (/(arm64|aarch64)/.test(lower)) return "arm64";
  if (/(x64|amd64|x86_64)/.test(lower)) return "x64";
  if (/(ia32|x86|i386)/.test(lower)) return "ia32";
  return "";
}

function kindFromName(name: string): string {
  const lower = name.toLowerCase();
  if (/\.tar\.gz$|\.tgz$/.test(lower)) return "server-tar";
  if (/\.cjs$|\.js$/.test(lower)) return "server-cjs";
  if (/\.exe$/.test(lower)) return "nsis";
  if (/\.zip$/.test(lower)) return "zip";
  return "file";
}

function readAssets(payload: Record<string, unknown>): unknown[] {
  for (const key of ["assets", "downloads", "files", "packages", "artifacts"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (typeof value === "object" && value !== null) {
      return Object.entries(value as Record<string, unknown>).map(([name, item]) => {
        const record = recordOf(item);
        return Object.keys(record).length > 0 ? { name, ...record } : { name, url: item };
      });
    }
  }
  const platforms = payload.platforms ?? payload.targets;
  if (typeof platforms === "object" && platforms !== null && !Array.isArray(platforms)) {
    return Object.entries(platforms as Record<string, unknown>).map(([platform, item]) => ({
      platform,
      ...recordOf(item),
    }));
  }
  const single = payload.downloadUrl ?? payload.download_url ?? payload.url;
  return typeof single === "string" && single.trim() ? [payload] : [];
}

function normalizeAsset(input: unknown, baseUrl: string, channel: string): UpdateAsset | null {
  const record = recordOf(input);
  const rawUrl = textOf(
    record.url ??
      record.downloadUrl ??
      record.download_url ??
      record.browser_download_url ??
      record.href,
  );
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl, `${baseUrl.replace(/\/+$/, "")}/`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const name = textOf(record.name ?? record.fileName ?? record.filename) || url.pathname.split("/").pop() || "update";
  const shaRaw = textOf(record.sha256 ?? record.checksum ?? record.digest ?? record.hash)
    .replace(/^sha256:/i, "")
    .trim()
    .toLowerCase();
  return {
    name: name.slice(0, 200),
    url: url.toString(),
    size: positiveInt(record.size ?? record.bytes ?? record.length),
    sha256: SHA256_PATTERN.test(shaRaw) ? shaRaw : null,
    kind: textOf(record.kind ?? record.type ?? record.format) || kindFromName(name),
    platform: normalizePlatform(textOf(record.platform ?? record.os ?? record.target) || platformFromName(name)),
    arch: normalizeArch(textOf(record.arch ?? record.architecture) || archFromName(name)),
    channel: textOf(record.channel) || channel,
  };
}

export function normalizePlatform(value: string): string {
  const key = value.trim().toLowerCase();
  return PLATFORM_ALIASES[key] ?? key;
}

export function normalizeArch(value: string): string {
  const key = value.trim().toLowerCase();
  if (key === "amd64" || key === "x86_64" || key === "x64") return "x64";
  if (key === "aarch64" || key === "arm64") return "arm64";
  if (key === "ia32" || key === "x86" || key === "i386") return "ia32";
  return key;
}

export function parseReleasePayload(
  payload: unknown,
  options: { channel: string; baseUrl: string },
): UpdateRelease | null {
  let record = recordOf(payload);
  if (record.success === false) {
    throw new Error(textOf(record.message) || "更新接口返回失败");
  }
  const data = recordOf(record.data ?? record.result);
  if (Object.keys(data).length > 0) record = data;

  const products = recordOf(record.products ?? record.releases);
  if (Object.keys(products).length > 0) {
    for (const key of [SERVER_PRODUCT, "server", "signaling"]) {
      const node = recordOf(products[key]);
      if (Object.keys(node).length > 0) {
        record = node;
        break;
      }
    }
  }

  const latest = recordOf(record.latest);
  const version = normalizeVersion(
    textOf(
      record.version ??
        record.latestVersion ??
        latest.version ??
        record.tag_name ??
        record.tagName,
    ),
  );
  if (!version) return null;

  const channel = textOf(record.channel ?? latest.channel) || options.channel;
  return {
    version,
    channel,
    notes: textOf(record.notes ?? record.releaseNotes ?? record.body ?? record.changelog ?? latest.notes).slice(
      0,
      NOTE_LIMIT,
    ),
    publishedAt:
      textOf(
        record.publishedAt ??
          record.published_at ??
          record.releasedAt ??
          record.date ??
          record.created_at,
      ) || null,
    mandatory: record.mandatory === true || record.force === true || record.required === true,
    assets: readAssets(record)
      .map((item) => normalizeAsset(item, options.baseUrl, channel))
      .filter((item): item is UpdateAsset => item !== null),
  };
}

export function selectUpdateAsset(
  release: UpdateRelease,
  target: { platform: string; arch: string; kinds: string[] },
): UpdateAsset | null {
  const platform = normalizePlatform(target.platform);
  const arch = normalizeArch(target.arch);
  const candidates = release.assets.filter(
    (asset) => !asset.platform || asset.platform === platform,
  );
  if (candidates.length === 0) return null;
  let best: UpdateAsset | null = null;
  let bestScore = -Infinity;
  for (const asset of candidates) {
    let score = 0;
    if (asset.platform === platform) score += 100;
    else if (asset.platform) score -= 60;
    if (asset.arch === arch) score += 30;
    else if (asset.arch) score -= 20;
    const kindIndex = target.kinds.indexOf(asset.kind);
    if (kindIndex >= 0) score += 50 - kindIndex * 5;
    else score -= 10;
    if (asset.sha256) score += 5;
    if (score > bestScore) {
      best = asset;
      bestScore = score;
    }
  }
  return best;
}

export function allowedDownloadHosts(baseUrl: string, extra: string[] = []): string[] {
  const hosts = new Set<string>(["ruodao.com", "www.ruodao.com"]);
  try {
    hosts.add(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    // ignore malformed base url
  }
  for (const host of extra) {
    const trimmed = host.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return [...hosts];
}

export function isAllowedDownloadUrl(url: string, hosts: string[], allowHttp = false): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) return false;
  const host = parsed.hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
