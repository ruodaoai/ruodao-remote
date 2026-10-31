import type { IceServer } from "./signaling";
import type { QualityPreset, SessionStats } from "../types";

export interface SignalData {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export function isSignalData(value: unknown): value is SignalData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (data.description !== undefined) {
    const description = data.description as Record<string, unknown> | null;
    if (
      typeof description !== "object" ||
      description === null ||
      typeof description.type !== "string" ||
      typeof description.sdp !== "string"
    ) {
      return false;
    }
    return true;
  }
  if (data.candidate !== undefined) {
    const candidate = data.candidate as Record<string, unknown> | null;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.candidate === "string" &&
      typeof candidate.sdpMid === "string" &&
      typeof candidate.sdpMLineIndex === "number"
    );
  }
  return false;
}

export function toIceServers(servers: IceServer[]): RTCIceServer[] {
  return servers
    .filter((server) => server && server.urls)
    .map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }));
}

export interface QualityProfile {
  id: QualityPreset;
  label: string;
  hint: string;
  maxBitrate: number;
  maxFramerate: number;
  degradation: "balanced" | "maintain-resolution";
}

export const QUALITY_ORDER: QualityPreset[] = ["smooth", "balanced", "sharp"];

export const QUALITY_PROFILES: Record<QualityPreset, QualityProfile> = {
  smooth: {
    id: "smooth",
    label: "流畅",
    hint: "优先流畅度，适合弱网或移动网络",
    maxBitrate: 2_500_000,
    maxFramerate: 30,
    degradation: "balanced",
  },
  balanced: {
    id: "balanced",
    label: "均衡",
    hint: "画质与带宽自动平衡",
    maxBitrate: 6_000_000,
    maxFramerate: 30,
    degradation: "balanced",
  },
  sharp: {
    id: "sharp",
    label: "高清",
    hint: "优先清晰度，需要较好的网络带宽",
    maxBitrate: 12_000_000,
    maxFramerate: 30,
    degradation: "maintain-resolution",
  },
};

export async function tuneVideoSender(
  pc: RTCPeerConnection,
  preset: QualityPreset = "balanced",
): Promise<void> {
  const sender = pc.getSenders().find((item) => item.track?.kind === "video");
  if (!sender) return;
  const profile = QUALITY_PROFILES[preset] ?? QUALITY_PROFILES.balanced;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    for (const encoding of params.encodings) {
      encoding.maxBitrate = profile.maxBitrate;
      encoding.maxFramerate = profile.maxFramerate;
    }
    params.degradationPreference = profile.degradation;
    await sender.setParameters(params);
  } catch {
    // Older encoders may reject parameter tuning; the default profile still works.
  }
}

export interface StatsSample {
  stats: SessionStats;
  bytes: number;
  at: number;
}

export async function collectStats(
  pc: RTCPeerConnection,
  previous: StatsSample | null,
): Promise<StatsSample | null> {
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    return null;
  }
  let inbound: Record<string, unknown> | null = null;
  let pair: Record<string, unknown> | null = null;
  for (const value of report.values()) {
    const stat = value as unknown as Record<string, unknown>;
    if (
      stat.type === "inbound-rtp" &&
      (stat.kind === "video" || stat.mediaType === "video")
    ) {
      inbound = stat;
    }
    if (
      stat.type === "candidate-pair" &&
      stat.state === "succeeded" &&
      (stat.selected === true || stat.nominated === true)
    ) {
      pair = stat;
    }
  }
  if (!inbound) return null;

  const bytes = Number(inbound.bytesReceived ?? 0);
  const now = Date.now();
  const elapsed = previous ? (now - previous.at) / 1000 : 0;
  const kbps =
    previous && elapsed > 0
      ? Math.max(0, Math.round(((bytes - previous.bytes) * 8) / 1000 / elapsed))
      : 0;
  const lost = Math.max(0, Number(inbound.packetsLost ?? 0));
  const received = Math.max(0, Number(inbound.packetsReceived ?? 0));
  const lossPct =
    lost + received > 0 ? Math.round((lost / (lost + received)) * 1000) / 10 : 0;
  const stats: SessionStats = {
    kbps,
    fps: Math.round(Number(inbound.framesPerSecond ?? 0)),
    width: Number(inbound.frameWidth ?? 0),
    height: Number(inbound.frameHeight ?? 0),
    rttMs: Math.round(Number(pair?.currentRoundTripTime ?? 0) * 1000),
    jitterMs: Math.round(Number(inbound.jitter ?? 0) * 1000),
    lossPct,
  };
  return { stats, bytes, at: now };
}

export type NetworkLevel = "good" | "fair" | "poor" | "unknown";

export interface NetworkVerdict {
  level: NetworkLevel;
  label: string;
  detail: string;
}

export function assessNetwork(stats: SessionStats | null): NetworkVerdict {
  if (!stats || (stats.rttMs === 0 && stats.lossPct === 0 && stats.fps === 0)) {
    return { level: "unknown", label: "评估中", detail: "正在收集网络质量指标" };
  }
  const poorReasons: string[] = [];
  const fairReasons: string[] = [];
  if (stats.rttMs >= 320) poorReasons.push("延迟很高");
  else if (stats.rttMs >= 160) fairReasons.push("延迟偏高");
  if (stats.lossPct >= 6) poorReasons.push("丢包严重");
  else if (stats.lossPct >= 2) fairReasons.push("有丢包");
  if (stats.jitterMs >= 90) poorReasons.push("抖动很大");
  else if (stats.jitterMs >= 35) fairReasons.push("抖动偏大");
  if (stats.fps > 0 && stats.fps < 10) fairReasons.push("帧率偏低");
  if (poorReasons.length > 0) {
    return { level: "poor", label: "容易卡顿", detail: poorReasons.join("、") };
  }
  if (fairReasons.length > 0) {
    return { level: "fair", label: "轻微卡顿", detail: fairReasons.join("、") };
  }
  return { level: "good", label: "流畅", detail: "延迟、抖动和丢包均在正常范围" };
}
