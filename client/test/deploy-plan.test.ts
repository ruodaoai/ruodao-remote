import { describe, expect, it } from "vitest";
import {
  buildCaddyfile,
  buildTurnserverConf,
  formatEntryUrl,
  needsGlibc217Node,
  nodeTarball,
  parseGlibcVersion,
  parsePortList,
  planDeployPorts,
  sslipHostname,
} from "../electron/deploy/plan";

function plan(input: Partial<Parameters<typeof planDeployPorts>[0]> = {}) {
  return planDeployPorts({
    sshPort: 22,
    installTurn: true,
    tcpUsed: [],
    udpUsed: [],
    random: () => 0,
    ...input,
  });
}

describe("deploy port planning", () => {
  it("always plans HTTPS on a nonstandard port with HTTP-01 on port 80", () => {
    expect(plan()).toEqual({
      secure: true,
      entryPort: 18000,
      redirectPort: 80,
      internalPort: 12000,
      turnPort: 10000,
      relayMin: 50000,
      relayMax: 50099,
    });
  });

  it("falls back to 443 with TLS-ALPN when port 80 is taken", () => {
    const ports = plan({ tcpUsed: [80] });
    expect(ports.secure).toBe(true);
    expect(ports.entryPort).toBe(443);
    expect(ports.redirectPort).toBe(0);
    expect(ports.internalPort).toBe(12000);
  });

  it("refuses to deploy without a way to validate a free certificate", () => {
    expect(() => plan({ tcpUsed: [80, 443] })).toThrow(/HTTPS/);
  });

  it("moves the public entry when the preferred high port is occupied", () => {
    const ports = plan({ tcpUsed: [18000, 18001] });
    expect(ports.entryPort).toBe(18002);
    expect(ports.redirectPort).toBe(80);
  });

  it("never uses the SSH port for the public entry", () => {
    const ports = plan({ sshPort: 18000 });
    expect(ports.entryPort).toBe(18001);
  });

  it("moves the internal server port when candidates are occupied", () => {
    const ports = plan({ tcpUsed: [12000, 12001] });
    expect(ports.internalPort).toBe(12002);
  });

  it("moves TURN and its relay range away from occupied TCP and UDP ports", () => {
    const ports = plan({ tcpUsed: [10000], udpUsed: [50000] });
    expect(ports.turnPort).toBe(10001);
    expect(ports.relayMin).toBe(50100);
    expect(ports.relayMax).toBe(50199);
  });

  it("skips relay blocks that contain any occupied UDP port", () => {
    const ports = plan({ udpUsed: [50050] });
    expect(ports.turnPort).toBe(10000);
    expect(ports.relayMin).toBe(50100);
  });

  it("does not reserve TURN ports when TURN is disabled", () => {
    const ports = plan({ installTurn: false, tcpUsed: [10000], udpUsed: [50000] });
    expect(ports.turnPort).toBe(0);
    expect(ports.relayMin).toBe(0);
    expect(ports.relayMax).toBe(0);
  });

  it("never reuses the public entry as the internal or TURN port", () => {
    const ports = plan({ tcpUsed: [12000], udpUsed: [10000] });
    expect(ports.entryPort).toBe(18000);
    expect(ports.internalPort).toBe(12001);
    expect(ports.turnPort).toBe(10001);
  });

  it("builds an sslip.io hostname for IP-only servers", () => {
    expect(sslipHostname("203.0.113.10")).toBe("203-0-113-10.sslip.io");
  });
});

describe("deploy URL formatting", () => {
  it("omits default ports and keeps custom ones", () => {
    expect(formatEntryUrl("203.0.113.10", false, 80)).toBe("http://203.0.113.10");
    expect(formatEntryUrl("203.0.113.10", false, 8080)).toBe("http://203.0.113.10:8080");
    expect(formatEntryUrl("remote.example.com", true, 443)).toBe("https://remote.example.com");
    expect(formatEntryUrl("remote.example.com", true, 18443)).toBe(
      "https://remote.example.com:18443",
    );
  });

  it("brackets IPv6 hosts", () => {
    expect(formatEntryUrl("2001:db8::1", false, 8080)).toBe("http://[2001:db8::1]:8080");
  });

  it("parses ss output", () => {
    expect(parsePortList("22, 80 443, 8787")).toEqual([22, 80, 443, 8787]);
    expect(parsePortList("")).toEqual([]);
  });
});

describe("generated Caddyfile", () => {
  it("serves HTTPS on a nonstandard port and keeps 80 for ACME and redirects", () => {
    const config = buildCaddyfile({
      siteHost: "remote.example.com",
      entryPort: 18443,
      redirectPort: 80,
      internalPort: 12000,
      storageDir: "/var/lib/ruodao-caddy",
    });
    expect(config).toContain("https://remote.example.com:18443 {");
    expect(config).toContain("http://remote.example.com:80 {");
    expect(config).toContain("redir https://remote.example.com:18443{uri} permanent");
    expect(config).toContain("auto_https disable_redirects");
    expect(config).not.toContain("disable_http_challenge");
    expect(config).toContain("protocols h1 h2");
    expect(config).toContain("Strict-Transport-Security");
    expect(config).toContain("reverse_proxy 127.0.0.1:12000");
    expect(config).toContain("storage file_system /var/lib/ruodao-caddy");
  });

  it("keeps HTTPS on 443 and validates via TLS-ALPN when port 80 is occupied", () => {
    const config = buildCaddyfile({
      siteHost: "remote.example.com",
      entryPort: 443,
      redirectPort: 0,
      internalPort: 12001,
      storageDir: "/var/lib/ruodao-caddy",
    });
    expect(config).toContain("https://remote.example.com {");
    expect(config).toContain("auto_https disable_redirects");
    expect(config).toContain("disable_http_challenge");
    expect(config).toContain("protocols h1 h2");
    expect(config).not.toContain("http://");
  });
});

describe("generated coturn config", () => {
  it("uses the planned port, relay range and quotas without opening TLS/CLI ports", () => {
    const config = buildTurnserverConf({
      listenPort: 10001,
      relayMin: 50100,
      relayMax: 50199,
      secret: "turn-secret",
      realm: "remote.example.com",
      serverName: "remote.example.com",
      externalIp: "203.0.113.10/10.0.0.5",
      denyPrivatePeers: true,
    });
    expect(config).toContain("listening-port=10001");
    expect(config).toContain("min-port=50100");
    expect(config).toContain("max-port=50199");
    expect(config).toContain("static-auth-secret=turn-secret");
    expect(config).toContain("external-ip=203.0.113.10/10.0.0.5");
    expect(config).toContain("user-quota=12");
    expect(config).toContain("total-quota=100");
    expect(config).toContain("max-bps=1500000");
    expect(config).toContain("no-software-attribute");
    expect(config).toContain("no-tls");
    expect(config).toContain("no-dtls");
    expect(config).toContain("no-cli");
    expect(config).toContain("denied-peer-ip=10.0.0.0-10.255.255.255");
  });
});

describe("node runtime selection", () => {
  it("parses glibc versions from getconf and ldd output", () => {
    expect(parseGlibcVersion("2.17")).toEqual([2, 17]);
    expect(parseGlibcVersion("glibc 2.28")).toEqual([2, 28]);
    expect(parseGlibcVersion("ldd (GNU libc) 2.36")).toEqual([2, 36]);
    expect(parseGlibcVersion("")).toBeNull();
    expect(parseGlibcVersion("unknown")).toBeNull();
  });

  it("picks the glibc-217 build only for old x64 systems", () => {
    expect(needsGlibc217Node("2.17", "x64")).toBe(true);
    expect(needsGlibc217Node("2.27", "x64")).toBe(true);
    expect(needsGlibc217Node("2.28", "x64")).toBe(false);
    expect(needsGlibc217Node("2.36", "x64")).toBe(false);
    expect(needsGlibc217Node("2.17", "arm64")).toBe(false);
    expect(needsGlibc217Node("", "x64")).toBe(false);
  });

  it("builds official and compatibility download URLs", () => {
    expect(nodeTarball("v26.13.0", "arm64", false)).toEqual({
      dirName: "node-v26.13.0-linux-arm64",
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-arm64.tar.gz",
    });
    expect(nodeTarball("v24.22.2", "x64", true)).toEqual({
      dirName: "node-v24.22.2-linux-x64-glibc-217",
      url: "https://unofficial-builds.nodejs.org/download/release/v24.22.2/node-v24.22.2-linux-x64-glibc-217.tar.gz",
    });
  });
});
