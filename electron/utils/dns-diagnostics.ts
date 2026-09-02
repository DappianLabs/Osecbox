/**
 * Shared DNS preflight types and classification.
 *
 * DNS is runtime-specific in OsecBox: on Windows the Linux tools normally run
 * inside WSL2, so a Windows-side lookup is not enough evidence that Nikto,
 * Nuclei, or Nmap can resolve a hostname. Keep classification independent of
 * the process runner so it can be tested without a live WSL installation.
 */

import { isIP } from 'node:net';

export const DNS_PUBLIC_PROBE = 'example.com';

export type DnsDiagnosticStatus =
  | 'healthy'
  | 'not-required'
  | 'target-unresolved'
  | 'resolver-unavailable'
  | 'network-unavailable'
  | 'runtime-unavailable'
  | 'diagnostic-unavailable';

export type DnsRuntime = 'wsl2' | 'linux' | 'darwin' | 'windows' | 'unknown';

export interface DnsProbeResult {
  ok: boolean;
  available: boolean;
  output?: string;
  error?: string;
}

export interface DnsDiagnostic {
  status: DnsDiagnosticStatus;
  ok: boolean;
  runtime: DnsRuntime;
  target?: string;
  publicProbe: DnsProbeResult;
  targetProbe?: DnsProbeResult;
  nameservers: string[];
  resolverEvidence?: string;
  routeEvidence?: string;
  message: string;
  remediation: string[];
}

export interface DnsClassificationInput {
  runtime: DnsRuntime;
  runtimeAvailable: boolean;
  target?: string;
  publicProbe: DnsProbeResult;
  targetProbe?: DnsProbeResult;
  resolverEvidence?: string;
  routeEvidence?: string;
}

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

/** Return a hostname only when DNS is actually relevant for the input. */
export function normalizeDnsHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let candidate = value.trim();
  if (!candidate) return null;

  if (candidate.includes('://')) {
    try {
      candidate = new URL(candidate).hostname;
    } catch {
      return null;
    }
  }

  candidate = candidate.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!candidate || isIP(candidate) !== 0) return null;
  if (/[/\s,:]/.test(candidate)) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2}|-\d{1,3})?$/.test(candidate)) return null;
  if (!HOSTNAME_PATTERN.test(candidate)) return null;

  return candidate.toLowerCase();
}

export function extractNameservers(evidence: string | undefined): string[] {
  if (!evidence) return [];

  const values: string[] = [];
  for (const line of evidence.split(/\r?\n/)) {
    const nameserverMatch = line.match(/^\s*nameserver\s+([^\s#]+)/i);
    if (nameserverMatch) values.push(nameserverMatch[1]);

    const currentMatch = line.match(/^\s*current\s+dns\s+server:\s*([^\s]+)/i);
    if (currentMatch) values.push(currentMatch[1]);

    const serversMatch = line.match(/^\s*dns\s+servers?:\s*(.+)$/i);
    if (serversMatch) {
      values.push(...serversMatch[1].split(/\s+/).filter(Boolean));
    }
  }

  return [...new Set(values)].slice(0, 8);
}

function hasDefaultRoute(routeEvidence: string | undefined): boolean {
  if (!routeEvidence) return true;
  return /(^|\s)default(\s|$)/im.test(routeEvidence)
    || /^0\.0\.0\.0\s+/m.test(routeEvidence);
}

function remediationFor(status: DnsDiagnosticStatus, runtime: DnsRuntime): string[] {
  switch (status) {
    case 'target-unresolved':
      return [
        'The runtime DNS works for the neutral public probe, so this is target-specific rather than proof that all DNS is broken.',
        'Check the hostname spelling and query its A/AAAA records with dig or nslookup in the same runtime.',
        'If the name is private or split-DNS, connect the required VPN and use the VPN/corporate DNS server; do not replace it with a public resolver.',
      ];
    case 'network-unavailable':
      return [
        'Restore a default route and reconnect the workstation network or required VPN.',
        runtime === 'wsl2'
          ? 'After the host network is restored, close active WSL work only if safe, run `wsl --shutdown`, reopen WSL, and rerun the preflight.'
          : 'Rerun the preflight after the network interface and VPN are ready.',
      ];
    case 'resolver-unavailable':
      return [
        'Inspect `/etc/resolv.conf` and `resolvectl status` inside the reported runtime.',
        runtime === 'wsl2'
          ? 'Reconnect the VPN first, then restart WSL. If the WSL DNS tunnel still fails, configure systemd-resolved with the current Windows/VPN DNS and back up the existing files first.'
          : 'Repair the active resolver configuration or reconnect the network/VPN that supplies DNS.',
        'Do not hard-code 1.1.1.1 or 8.8.8.8 when private names or split-DNS are required; that is outside OsecBox control.',
      ];
    case 'runtime-unavailable':
      return runtime === 'wsl2'
        ? [
            'Install or enable WSL2, install at least one version-2 distribution, and make sure it can execute `true`.',
            'If WSL reports Access Denied or service errors, repair/update the Windows WSL installation or restart the WSL service, then refresh OsecBox.',
          ]
        : ['Install or enable the runtime required by the selected tool, then refresh OsecBox.'];
    case 'diagnostic-unavailable':
      return [
        'Install a resolver utility and timeout support in the tool runtime: getent is preferred; dnsutils provides dig and nslookup on Debian/Ubuntu, and coreutils provides timeout.',
        'The tool may still work, but OsecBox cannot certify DNS without a supported resolver command.',
      ];
    case 'not-required':
    case 'healthy':
    default:
      return [];
  }
}

export function classifyDnsDiagnostic(input: DnsClassificationInput): DnsDiagnostic {
  const target = normalizeDnsHostname(input.target);
  const nameservers = extractNameservers(input.resolverEvidence);
  const base = {
    runtime: input.runtime,
    target: target || undefined,
    publicProbe: input.publicProbe,
    targetProbe: input.targetProbe,
    nameservers,
    resolverEvidence: input.resolverEvidence,
    routeEvidence: input.routeEvidence,
  };

  if (input.target && !target) {
    return {
      ...base,
      status: 'not-required',
      ok: true,
      message: 'The supplied target is an IP address or network range; DNS preflight is not required.',
      remediation: [],
    };
  }

  if (!input.runtimeAvailable) {
    const status: DnsDiagnosticStatus = 'runtime-unavailable';
    return {
      ...base,
      status,
      ok: false,
      message: `The ${input.runtime} tool runtime is unavailable, so OsecBox cannot run the DNS check in the same environment as the tool.`,
      remediation: remediationFor(status, input.runtime),
    };
  }

  const hasProbeTool = input.publicProbe.available || input.targetProbe?.available;
  if (!hasProbeTool) {
    const status: DnsDiagnosticStatus = 'diagnostic-unavailable';
    return {
      ...base,
      status,
      ok: false,
      message: 'No supported resolver command was available in the tool runtime.',
      remediation: remediationFor(status, input.runtime),
    };
  }

  // A private/VPN target can be healthy even when a neutral public probe is
  // blocked. Never block a scan when the actual target resolved successfully.
  if (target && input.targetProbe?.ok) {
    return {
      ...base,
      status: 'healthy',
      ok: true,
      message: input.publicProbe.ok
        ? `DNS resolved ${target} in the tool runtime.`
        : `DNS resolved ${target} in the tool runtime; the neutral public probe was unavailable, which may be expected on a restricted/VPN network.`,
      remediation: [],
    };
  }

  if (!input.publicProbe.ok) {
    const status: DnsDiagnosticStatus = hasDefaultRoute(input.routeEvidence)
      ? 'resolver-unavailable'
      : 'network-unavailable';
    return {
      ...base,
      status,
      ok: false,
      message: status === 'network-unavailable'
        ? `The runtime has no usable default route, so it cannot reach DNS for ${DNS_PUBLIC_PROBE}.`
        : `The runtime could not resolve the neutral public probe ${DNS_PUBLIC_PROBE}; this is a local resolver/DNS-path failure, not evidence that the target has no record.`,
      remediation: remediationFor(status, input.runtime),
    };
  }

  if (target && !input.targetProbe?.ok) {
    const status: DnsDiagnosticStatus = 'target-unresolved';
    return {
      ...base,
      status,
      ok: false,
      message: `The runtime resolved ${DNS_PUBLIC_PROBE} but could not resolve target ${target}. This is target-specific DNS, VPN/split-DNS, or record configuration—not a general resolver failure.`,
      remediation: remediationFor(status, input.runtime),
    };
  }

  return {
    ...base,
    status: 'healthy',
    ok: true,
    message: `DNS resolved ${DNS_PUBLIC_PROBE} in the tool runtime.`,
    remediation: [],
  };
}

export function formatDnsDiagnosticFailure(diagnostic: DnsDiagnostic): string {
  const lines = [
    'OSECBOX_DNS_PREFLIGHT_FAILED',
    `Status: ${diagnostic.status}`,
    `Runtime: ${diagnostic.runtime}`,
    diagnostic.target ? `Target: ${diagnostic.target}` : `Probe: ${DNS_PUBLIC_PROBE}`,
    `Reason: ${diagnostic.message}`,
  ];

  if (diagnostic.nameservers.length > 0) {
    lines.push(`Nameservers observed: ${diagnostic.nameservers.join(', ')}`);
  }
  if (diagnostic.routeEvidence?.trim()) {
    lines.push(`Route evidence: ${diagnostic.routeEvidence.trim().replace(/\s+/g, ' ').slice(0, 240)}`);
  }

  if (diagnostic.remediation.length > 0) {
    lines.push('How to solve it:');
    lines.push(...diagnostic.remediation.map(item => `- ${item}`));
  }

  return lines.join('\n');
}
