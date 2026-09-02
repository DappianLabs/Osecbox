/**
 * Small, renderer-safe Nmap XML reader.
 *
 * Nmap XML is deliberately parsed without DOMParser so the same parser works
 * in Vitest/Node, Electron's renderer, and a browser preview. It extracts the
 * stable host/address/port/service fields and ignores the rest of the XML.
 */

export interface NmapXmlPort {
  port: number;
  protocol: string;
  state: string;
  service?: string;
  product?: string;
  version?: string;
  tunnel?: string;
}

export interface NmapXmlHost {
  ip: string;
  hostname?: string;
  status: 'up' | 'down';
  reason?: string;
  latency?: string;
  mac?: string;
  vendor?: string;
  os?: string;
  ports: NmapXmlPort[];
}

export const NMAP_XML_LIMITS = {
  maxInputChars: 8 * 1024 * 1024,
  maxHosts: 10_000,
  maxPortsPerHost: 10_000,
  maxTotalPorts: 50_000,
} as const;

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  try {
    return String(value);
  } catch {
    return '';
  }
}

function boundXmlInput(value: string): string {
  if (value.length <= NMAP_XML_LIMITS.maxInputChars) return value;

  const marker = '\n<!-- parser input truncated -->\n';
  const available = NMAP_XML_LIMITS.maxInputChars - marker.length;
  const headLength = Math.floor(available * 0.75);
  return `${value.slice(0, headLength)}${marker}${value.slice(- (available - headLength))}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function attribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : undefined;
}

function firstTag(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<${name}\\b[^>]*>`, 'i'))?.[0];
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
  const containsIPv4 = address.includes('.');
  if (containsIPv4) {
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
  const hasCompression = compressionCount === 1;

  if (hasCompression ? segmentCount >= 8 : segmentCount !== 8) return false;

  return segments.filter(Boolean).every(segment =>
    segment === 'ipv4' || /^[0-9a-f]{1,4}$/i.test(segment),
  );
}

function isValidPrimaryAddress(value: string, type: string): boolean {
  if (type === 'ipv4') return isValidIPv4(value);
  if (type === 'ipv6') return isValidIPv6(value);
  return false;
}

function mergePort(existing: NmapXmlPort, incoming: NmapXmlPort): NmapXmlPort {
  const existingState = existing.state.toLowerCase();
  const incomingState = incoming.state.toLowerCase();
  const state = existingState === 'unknown' && incomingState !== 'unknown'
    ? incoming.state
    : existing.state || incoming.state;

  return {
    ...existing,
    state,
    service: existing.service || incoming.service,
    product: existing.product || incoming.product,
    version: existing.version || incoming.version,
    tunnel: existing.tunnel || incoming.tunnel,
  };
}

function mergeHost(existing: NmapXmlHost, incoming: NmapXmlHost): NmapXmlHost {
  const portsByKey = new Map<string, NmapXmlPort>();
  for (const port of existing.ports) {
    portsByKey.set(`${port.protocol.toLowerCase()}/${port.port}`, port);
  }
  for (const port of incoming.ports) {
    const key = `${port.protocol.toLowerCase()}/${port.port}`;
    const previous = portsByKey.get(key);
    portsByKey.set(key, previous ? mergePort(previous, port) : port);
  }

  return {
    ...existing,
    hostname: existing.hostname || incoming.hostname,
    status: existing.status === 'up' || incoming.status === 'up' ? 'up' : 'down',
    reason: existing.reason || incoming.reason,
    latency: existing.latency || incoming.latency,
    mac: existing.mac || incoming.mac,
    vendor: existing.vendor || incoming.vendor,
    os: existing.os || incoming.os,
    ports: Array.from(portsByKey.values()).slice(0, NMAP_XML_LIMITS.maxPortsPerHost),
  };
}

export function parseNmapXmlHosts(output: unknown): NmapXmlHost[] {
  const safeOutput = boundXmlInput(toSafeString(output));
  const hostsByIp = new Map<string, NmapXmlHost>();
  const hostBlocks = (safeOutput.match(/<host\b[\s\S]*?<\/host>/gi) || [])
    .slice(0, NMAP_XML_LIMITS.maxHosts);
  let totalPorts = 0;

  for (const block of hostBlocks) {
    const statusTag = firstTag(block, 'status');
    const status = attribute(statusTag || '', 'state')?.toLowerCase() === 'down' ? 'down' : 'up';
    const addressTags = block.match(/<address\b[^>]*>/gi) || [];
    const addresses = addressTags.map(tag => ({
      value: attribute(tag, 'addr') || '',
      type: (attribute(tag, 'addrtype') || '').toLowerCase(),
      vendor: attribute(tag, 'vendor'),
    })).filter(address => address.value && isValidPrimaryAddress(address.value, address.type));

    // A MAC address identifies a network interface, not a host address. Never
    // promote a MAC-only XML host into a scan result.
    const primaryAddress = addresses.find(address => address.type === 'ipv4')
      || addresses.find(address => address.type === 'ipv6');
    if (!primaryAddress?.value) continue;

    const hostnameTag = firstTag(block, 'hostname');
    const timesTag = firstTag(block, 'times');
    const osMatch = block.match(/<osmatch\b[^>]*name=["']([^"']+)["'][^>]*>/i);
    const portBlocks = (block.match(/<port\b[\s\S]*?<\/port>/gi) || [])
      .slice(0, NMAP_XML_LIMITS.maxPortsPerHost);
    const ports: NmapXmlPort[] = [];

    for (const portBlock of portBlocks) {
      if (totalPorts >= NMAP_XML_LIMITS.maxTotalPorts) break;
      const portTag = firstTag(portBlock, 'port');
      const port = Number(attribute(portTag || '', 'portid'));
      if (!Number.isInteger(port) || port < 0 || port > 65535) continue;

      const stateTag = firstTag(portBlock, 'state');
      const serviceTag = firstTag(portBlock, 'service');
      ports.push({
        port,
        protocol: attribute(portTag || '', 'protocol') || 'unknown',
        state: attribute(stateTag || '', 'state') || 'unknown',
        service: attribute(serviceTag || '', 'name'),
        product: attribute(serviceTag || '', 'product'),
        version: attribute(serviceTag || '', 'version'),
        tunnel: attribute(serviceTag || '', 'tunnel'),
      });
      totalPorts += 1;
    }

    const parsedHost: NmapXmlHost = {
      ip: primaryAddress.value,
      hostname: attribute(hostnameTag || '', 'name'),
      status,
      reason: attribute(statusTag || '', 'reason'),
      latency: (() => {
        const srtt = Number(attribute(timesTag || '', 'srtt'));
        return Number.isFinite(srtt) && srtt >= 0 ? `${srtt / 1_000_000}s` : undefined;
      })(),
      mac: addressTags.map(tag => ({
        value: attribute(tag, 'addr') || '',
        type: (attribute(tag, 'addrtype') || '').toLowerCase(),
        vendor: attribute(tag, 'vendor'),
      })).find(address => address.type === 'mac')?.value,
      vendor: addressTags.map(tag => ({
        value: attribute(tag, 'addr') || '',
        type: (attribute(tag, 'addrtype') || '').toLowerCase(),
        vendor: attribute(tag, 'vendor'),
      })).find(address => address.type === 'mac')?.vendor,
      os: osMatch ? decodeXml(osMatch[1]) : undefined,
      ports,
    };

    const key = parsedHost.ip.toLowerCase();
    const previous = hostsByIp.get(key);
    hostsByIp.set(key, previous ? mergeHost(previous, parsedHost) : parsedHost);
    if (hostsByIp.size >= NMAP_XML_LIMITS.maxHosts) break;
  }

  return Array.from(hostsByIp.values()).slice(0, NMAP_XML_LIMITS.maxHosts);
}
