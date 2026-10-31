import { readFileSync } from "node:fs";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

export interface NetworkCounters {
  rxBytes: number;
  txBytes: number;
}

export interface TelemetrySnapshot {
  at: number;
  bandwidthInKbps: number;
  bandwidthOutKbps: number;
  wsInKbps: number;
  wsOutKbps: number;
  load1: number;
  cpuPct: number;
  lagMs: number;
  memoryPct: number;
  memoryMb: number;
  uptimeSeconds: number;
  nicSupported: boolean;
}

export interface TelemetryOptions {
  sampleIntervalMs?: number;
  now?: () => number;
  onSample?: (snapshot: TelemetrySnapshot) => void;
  log?: (event: string, meta?: Record<string, unknown>) => void;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Sums non-loopback interface counters from /proc/net/dev (Linux deployments). */
export function readNetworkCounters(): NetworkCounters | null {
  try {
    const raw = readFileSync("/proc/net/dev", "utf8");
    let rxBytes = 0;
    let txBytes = 0;
    let counted = 0;
    for (const line of raw.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim();
      if (!name || name === "lo") continue;
      const fields = line.slice(colon + 1).trim().split(/\s+/);
      const rx = Number(fields[0]);
      const tx = Number(fields[8]);
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
      rxBytes += rx;
      txBytes += tx;
      counted += 1;
    }
    if (counted === 0) return null;
    return { rxBytes, txBytes };
  } catch {
    return null;
  }
}

export class TelemetryService {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly onSample?: (snapshot: TelemetrySnapshot) => void;
  private readonly log: (event: string, meta?: Record<string, unknown>) => void;
  private readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
  private timer: NodeJS.Timeout | null = null;
  private lastNet: NetworkCounters | null = null;
  private lastWsIn = 0;
  private lastWsOut = 0;
  private wsInBytes = 0;
  private wsOutBytes = 0;
  private lastCpu = process.cpuUsage();
  private lastSampleAt = Date.now();
  private value: TelemetrySnapshot;

  constructor(options: TelemetryOptions = {}) {
    this.intervalMs = Math.max(1000, options.sampleIntervalMs ?? 5000);
    this.now = options.now ?? Date.now;
    this.onSample = options.onSample;
    this.log = options.log ?? (() => {});
    this.histogram = monitorEventLoopDelay({ resolution: 500 });
    this.value = {
      at: this.now(),
      bandwidthInKbps: 0,
      bandwidthOutKbps: 0,
      wsInKbps: 0,
      wsOutKbps: 0,
      load1: round(os.loadavg()[0] ?? 0, 2),
      cpuPct: 0,
      lagMs: 0,
      memoryPct: round((process.memoryUsage().rss / os.totalmem()) * 100, 1),
      memoryMb: round(process.memoryUsage().rss / 1024 / 1024, 0),
      uptimeSeconds: Math.floor(process.uptime()),
      nicSupported: readNetworkCounters() !== null,
    };
  }

  start(): void {
    if (this.timer) return;
    this.histogram.enable();
    this.lastNet = readNetworkCounters();
    this.lastCpu = process.cpuUsage();
    this.lastSampleAt = this.now();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram.disable();
  }

  addWsIn(bytes: number): void {
    if (bytes > 0) this.wsInBytes += bytes;
  }

  addWsOut(bytes: number): void {
    if (bytes > 0) this.wsOutBytes += bytes;
  }

  snapshot(): TelemetrySnapshot {
    return { ...this.value };
  }

  private sample(): void {
    const now = this.now();
    const elapsed = Math.max(1, now - this.lastSampleAt);
    const net = readNetworkCounters();
    let bandwidthInKbps = 0;
    let bandwidthOutKbps = 0;
    if (net && this.lastNet) {
      const rx = Math.max(0, net.rxBytes - this.lastNet.rxBytes);
      const tx = Math.max(0, net.txBytes - this.lastNet.txBytes);
      bandwidthInKbps = Math.round((rx * 8) / elapsed);
      bandwidthOutKbps = Math.round((tx * 8) / elapsed);
    }
    this.lastNet = net;

    const wsInDelta = Math.max(0, this.wsInBytes - this.lastWsIn);
    const wsOutDelta = Math.max(0, this.wsOutBytes - this.lastWsOut);
    this.lastWsIn = this.wsInBytes;
    this.lastWsOut = this.wsOutBytes;

    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    const cpuCount = Math.max(1, os.cpus().length);
    const cpuPct = ((cpu.user + cpu.system) / (elapsed * 1000) / cpuCount) * 100;

    const lagNs = this.histogram.mean;
    const memory = process.memoryUsage();
    this.value = {
      at: now,
      bandwidthInKbps,
      bandwidthOutKbps,
      wsInKbps: Math.round((wsInDelta * 8) / elapsed),
      wsOutKbps: Math.round((wsOutDelta * 8) / elapsed),
      load1: round(os.loadavg()[0] ?? 0, 2),
      cpuPct: round(Math.min(100, Math.max(0, cpuPct)), 1),
      lagMs: Number.isFinite(lagNs) ? round(lagNs / 1e6, 1) : 0,
      memoryPct: round((memory.rss / os.totalmem()) * 100, 1),
      memoryMb: round(memory.rss / 1024 / 1024, 0),
      uptimeSeconds: Math.floor(process.uptime()),
      nicSupported: net !== null,
    };
    this.lastSampleAt = now;
    try {
      this.onSample?.(this.snapshot());
    } catch (error) {
      this.log("telemetry.sample-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createTelemetryService(options: TelemetryOptions = {}): TelemetryService {
  return new TelemetryService(options);
}
