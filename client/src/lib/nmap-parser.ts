// Nmap scan result types
import { cleanANSI } from '@/lib/utils/ansi-cleaner';
import { parseNmapXmlHosts } from './parsers/nmap-xml-parser';

export type NmapPortState =
  | 'open'
  | 'closed'
  | 'filtered'
  | 'unfiltered'
  | 'open|filtered'
  | 'closed|filtered'
  | 'unknown';

export interface PortInfo {
  port: number;
  protocol: string;
  state: NmapPortState;
  service: string;
  version?: string;
}

export interface ScanResult {
  ip: string;
  hostname?: string;
  status: 'up' | 'down';
  latency?: string;
  mac?: string;
  vendor?: string;
  os?: string;
  ports: PortInfo[];
  aiInsights?: string[];
}

const MAX_INPUT_CHARS = 8 * 1024 * 1024;
const MAX_HOSTS = 10_000;

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  try {
    return String(value);
  } catch {
    return '';
  }
}

function boundInput(value: string): string {
  if (value.length <= MAX_INPUT_CHARS) return value;
  const marker = '\n...[nmap input truncated]...\n';
  const available = MAX_INPUT_CHARS - marker.length;
  const headLength = Math.floor(available * 0.75);
  return `${value.slice(0, headLength)}${marker}${value.slice(- (available - headLength))}`;
}

function isValidIPv4(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every(octet => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const numeric = Number(octet);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
}

function isValidIPv6(value: string): boolean {
  const address = value.trim().toLowerCase();
  if (!address || address.includes('%')) return false;

  let normalized = address;
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    if (lastColon < 0 || !isValidIPv4(address.slice(lastColon + 1))) return false;
    normalized = `${address.slice(0, lastColon)}:ipv4`;
  }

  const compressionCount = (normalized.match(/::/g) || []).length;
  if (compressionCount > 1) return false;
  const segments = normalized.split(':');
  const segmentCount = segments
    .filter(Boolean)
    .reduce((count, segment) => count + (segment === 'ipv4' ? 2 : 1), 0);
  if (compressionCount === 1 ? segmentCount >= 8 : segmentCount !== 8) return false;

  return segments.filter(Boolean).every(segment =>
    segment === 'ipv4' || /^[0-9a-f]{1,4}$/i.test(segment),
  );
}

function isValidHostname(value: string): boolean {
  if (!value || value.length > 253 || value.endsWith('.')) return false;
  // Do not reinterpret an invalid dotted-quad as a DNS name. Nmap reports
  // malformed numeric addresses as text too, and accepting them here would
  // bypass the IPv4 octet validation above.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  return value.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
}

function isValidHostIdentifier(value: string): boolean {
  return isValidIPv4(value) || isValidIPv6(value) || isValidHostname(value);
}

interface ParsedHostReport {
  ip: string;
  hostname?: string;
}

function parseHostReport(line: string): ParsedHostReport | undefined {
  const match = line.match(/^Nmap scan report for (.+?)(?:\s+\(([^()]+)\))?\s*$/i);
  if (!match) return undefined;

  const hostOrName = match[1].trim();
  const ipInParens = match[2]?.trim();
  const ip = ipInParens || hostOrName;
  if (!isValidHostIdentifier(ip)) return undefined;

  return {
    ip,
    hostname: ipInParens ? hostOrName : undefined,
  };
}

function normalizePortState(value: string): NmapPortState {
  switch (value.trim().toLowerCase()) {
    case 'open': return 'open';
    case 'closed': return 'closed';
    case 'filtered': return 'filtered';
    case 'unfiltered': return 'unfiltered';
    case 'open|filtered': return 'open|filtered';
    case 'closed|filtered': return 'closed|filtered';
    default: return 'unknown';
  }
}

function portStateRank(state: NmapPortState): number {
  switch (state) {
    case 'open': return 6;
    case 'open|filtered': return 5;
    case 'unknown': return 4;
    case 'unfiltered': return 3;
    case 'filtered': return 2;
    case 'closed|filtered': return 1;
    case 'closed': return 0;
  }
}

function mergePorts(existing: PortInfo, incoming: PortInfo): PortInfo {
  const preferredState = portStateRank(incoming.state) > portStateRank(existing.state)
    ? incoming.state
    : existing.state;
  return {
    ...existing,
    state: preferredState,
    service: existing.service === 'unknown' ? incoming.service : existing.service,
    version: existing.version || incoming.version,
  };
}

function mergeScanResults(results: ScanResult[]): ScanResult[] {
  const byHost = new Map<string, ScanResult>();

  for (const result of results) {
    if (!result.ip || !isValidHostIdentifier(result.ip)) continue;
    const key = result.ip.toLowerCase();
    const previous = byHost.get(key);
    if (!previous) {
      byHost.set(key, {
        ...result,
        ports: [...result.ports],
        aiInsights: result.aiInsights ? [...result.aiInsights] : [],
      });
      continue;
    }

    const portsByKey = new Map<string, PortInfo>();
    for (const port of previous.ports) {
      portsByKey.set(`${port.protocol.toLowerCase()}/${port.port}`, port);
    }
    for (const port of result.ports) {
      const portKey = `${port.protocol.toLowerCase()}/${port.port}`;
      const existingPort = portsByKey.get(portKey);
      portsByKey.set(portKey, existingPort ? mergePorts(existingPort, port) : port);
    }

    byHost.set(key, {
      ...previous,
      hostname: previous.hostname || result.hostname,
      status: previous.status === 'up' || result.status === 'up' ? 'up' : 'down',
      latency: previous.latency || result.latency,
      mac: previous.mac || result.mac,
      vendor: previous.vendor || result.vendor,
      os: previous.os || result.os,
      ports: Array.from(portsByKey.values()),
      aiInsights: Array.from(new Set([...(previous.aiInsights || []), ...(result.aiInsights || [])])),
    });
  }

  return Array.from(byHost.values()).slice(0, MAX_HOSTS);
}

function isCompleteNmapXml(value: string): boolean {
  return /<nmaprun\b[^>]*>[\s\S]*<\/nmaprun>/i.test(value);
}

function toScanResult(host: ReturnType<typeof parseNmapXmlHosts>[number]): ScanResult {
  return {
    ip: host.ip,
    hostname: host.hostname,
    status: host.status,
    latency: host.latency,
    mac: host.mac,
    vendor: host.vendor,
    os: host.os,
    ports: host.ports.map(port => ({
      port: port.port,
      protocol: port.protocol,
      state: normalizePortState(port.state),
      service: port.service || 'unknown',
      version: [port.product, port.version].filter(Boolean).join(' ') || undefined,
    })),
    aiInsights: [],
  };
}

export function parseNmapOutput(nmapOutput: unknown): ScanResult[] {
  const cleanOutput = cleanANSI(boundInput(toSafeString(nmapOutput)));

  // XML is a preferred path, not a terminal assumption. Malformed, empty, or
  // MAC-only XML falls back to the text parser rather than returning no data
  // prematurely.
  if (isCompleteNmapXml(cleanOutput)) {
    const xmlResults = parseNmapXmlHosts(cleanOutput).map(toScanResult);
    if (xmlResults.length > 0) return mergeScanResults(xmlResults);
  }

  const results: ScanResult[] = [];
  const lines = cleanOutput.split(/\r?\n/);
  let currentHost: Partial<ScanResult> | null = null;
  let inPortSection = false;

  const saveCurrentHost = (): void => {
    if (currentHost?.ip && isValidHostIdentifier(currentHost.ip)) {
      results.push({
        ip: currentHost.ip,
        hostname: currentHost.hostname,
        status: currentHost.status || 'up',
        latency: currentHost.latency,
        mac: currentHost.mac,
        vendor: currentHost.vendor,
        os: currentHost.os,
        ports: currentHost.ports || [],
        aiInsights: currentHost.aiInsights || [],
      });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inPortSection) inPortSection = false;
      continue;
    }

    const hostReport = parseHostReport(line);
    if (hostReport) {
      saveCurrentHost();
      if (results.length >= MAX_HOSTS) break;
      currentHost = {
        ip: hostReport.ip,
        hostname: hostReport.hostname,
        status: 'up',
        ports: [],
        aiInsights: [],
      };
      // Port tables belong to one host only.
      inPortSection = false;
      continue;
    }

    if (!currentHost) continue;

    if (/Host is up\b/i.test(line)) {
      currentHost.status = 'up';
      const latencyMatch = line.match(/\(([^)]*?s)\s+latency\)/i);
      if (latencyMatch) currentHost.latency = latencyMatch[1];
      continue;
    }
    if (/Host is down\b/i.test(line)) {
      currentHost.status = 'down';
      inPortSection = false;
      continue;
    }

    if (/^Not shown:/i.test(line) || /\b\d+\s+(?:closed|filtered)\s+ports?\b/i.test(line)) {
      continue;
    }

    if (/^MAC Address:/i.test(line)) {
      const macMatch = line.match(/^MAC Address:\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})(?:\s+\((.+?)\))?$/i);
      if (macMatch) {
        currentHost.mac = macMatch[1];
        currentHost.vendor = macMatch[2];
      }
      continue;
    }

    const osMatch = line.match(/^(?:OS details?|Running):\s*(.+)$/i);
    if (osMatch) {
      currentHost.os = osMatch[1].trim();
      continue;
    }

    if (/^PORT\s+STATE\s+SERVICE(?:\s+VERSION)?/i.test(line)) {
      inPortSection = true;
      continue;
    }

    if (/^(?:Service detection|OS detection|Service Info:|TRACEROUTE:|Nmap done:)/i.test(line)) {
      inPortSection = false;
      continue;
    }

    if (inPortSection) {
      const portMatch = line.match(/^(\d{1,5})\/([A-Za-z0-9][A-Za-z0-9+._-]*)\s+([A-Za-z]+(?:\|[A-Za-z]+)?)\s+(\S+)(?:\s+(.*))?$/);
      if (!portMatch) continue;

      const port = Number(portMatch[1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) continue;
      const state = normalizePortState(portMatch[3]);
      // Preserve the historical dedicated-result behavior of omitting known
      // closed/filtered ports, while retaining open compounds and unknown
      // states instead of silently converting them to closed.
      if (state === 'closed' || state === 'filtered' || state === 'unfiltered' || state === 'closed|filtered') continue;

      currentHost.ports = currentHost.ports || [];
      const incoming: PortInfo = {
        port,
        protocol: portMatch[2].toLowerCase(),
        state,
        service: portMatch[4],
        version: portMatch[5]?.trim().replace(/\s+/g, ' ') || undefined,
      };
      const existingIndex = currentHost.ports.findIndex(existing =>
        existing.port === incoming.port && existing.protocol.toLowerCase() === incoming.protocol,
      );
      if (existingIndex >= 0) {
        currentHost.ports[existingIndex] = mergePorts(currentHost.ports[existingIndex], incoming);
      } else {
        currentHost.ports.push(incoming);
      }
    }
  }

  saveCurrentHost();
  return mergeScanResults(results);
}

export function summarizeNmapOutput(nmapOutput: unknown): string {
  const cleanOutput = cleanANSI(boundInput(toSafeString(nmapOutput)));

  if (isCompleteNmapXml(cleanOutput)) {
    const hosts = parseNmapXmlHosts(cleanOutput);
    if (hosts.length > 0) {
      const summary: string[] = [];
      for (const host of hosts) {
        summary.push(`Nmap scan report for ${host.hostname ? `${host.hostname} (${host.ip})` : host.ip}`);
        summary.push(`  Host is ${host.status}${host.latency ? ` (${host.latency} latency)` : ''}`);
        if (host.mac) summary.push(`  MAC Address: ${host.mac}${host.vendor ? ` (${host.vendor})` : ''}`);
        if (host.os) summary.push(`  OS details: ${host.os}`);
        for (const port of host.ports) {
          const version = [port.product, port.version].filter(Boolean).join(' ');
          summary.push(`  ${port.port}/${port.protocol} ${port.state} ${port.service || 'unknown'}${version ? ` ${version}` : ''}`);
        }
      }
      summary.push(`\nNmap XML summary: ${hosts.length} host${hosts.length === 1 ? '' : 's'}`);
      return summary.join('\n');
    }
  }

  const lines = cleanOutput.split(/\r?\n/);
  const summary: string[] = [];
  for (const line of lines) {
    if (/Nmap scan report/i.test(line)) {
      summary.push(line);
    } else if (/Host is up|Host is down/i.test(line)) {
      summary.push(`  ${line.trim()}`);
    } else if (/^\d+\/[A-Za-z0-9][A-Za-z0-9+._-]*\s+\S+\s+/i.test(line.trim())) {
      summary.push(`  ${line.trim()}`);
    } else if (/^MAC Address:/i.test(line)) {
      summary.push(`  ${line.trim()}`);
    } else if (/^(?:OS details?|Running):/i.test(line.trim())) {
      summary.push(`  ${line.trim()}`);
    } else if (/Nmap done:/i.test(line)) {
      summary.push(`\n${line}`);
    }
  }

  return summary.join('\n');
}

export function extractHostInfo(nmapOutput: unknown, targetIp: unknown): {
  hostname?: string;
  latency?: string;
  mac?: string;
  vendor?: string;
  os?: string;
} {
  const target = toSafeString(targetIp).trim();
  if (!target) return {};

  const cleanOutput = cleanANSI(boundInput(toSafeString(nmapOutput)));
  const info: {
    hostname?: string;
    latency?: string;
    mac?: string;
    vendor?: string;
    os?: string;
  } = {};
  let isTargetHost = false;
  let sawHost = false;
  const normalizedTarget = target.toLowerCase();

  for (const rawLine of cleanOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    const hostReport = parseHostReport(line);
    if (hostReport) {
      const candidates = [hostReport.ip, hostReport.hostname].filter(Boolean) as string[];
      const matches = candidates.some(candidate => candidate.toLowerCase() === normalizedTarget);
      if (matches) {
        isTargetHost = true;
        sawHost = true;
        if (hostReport.hostname) info.hostname = hostReport.hostname;
      } else if (sawHost) {
        break;
      }
      continue;
    }

    if (!isTargetHost) continue;

    if (/Host is up\b/i.test(line)) {
      const latencyMatch = line.match(/\(([^)]*?s)\s+latency\)/i);
      if (latencyMatch) info.latency = latencyMatch[1];
      continue;
    }

    const macMatch = line.match(/^MAC Address:\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})(?:\s+\((.+?)\))?$/i);
    if (macMatch) {
      info.mac = macMatch[1];
      info.vendor = macMatch[2];
      continue;
    }

    const osMatch = line.match(/^(?:OS details?|Running):\s*(.+)$/i);
    if (osMatch) info.os = osMatch[1].trim();
  }

  return info;
}
