/**
 * Network Scanner Parsers
 * Handles: nmap, masscan, zmap, unicornscan
 */

import type { UniversalFinding } from '../universal-parser';
import { parseNmapXmlHosts } from './nmap-xml-parser';

/**
 * Get common service name for port number
 */
function getServiceName(port: number): string {
  const services: Record<number, string> = {
    20: 'FTP-DATA',
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    53: 'DNS',
    80: 'HTTP',
    110: 'POP3',
    143: 'IMAP',
    443: 'HTTPS',
    445: 'SMB',
    3306: 'MySQL',
    3389: 'RDP',
    5432: 'PostgreSQL',
    5900: 'VNC',
    6379: 'Redis',
    8080: 'HTTP-Proxy',
    8443: 'HTTPS-Alt',
    27017: 'MongoDB',
  };
  
  return services[port] || `Port ${port}`;
}

export function parseNmap(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10000;
  let truncated = false;
  const addFinding = (finding: UniversalFinding): void => {
    if (findings.length >= MAX_FINDINGS) {
      truncated = true;
      return;
    }
    findings.push(finding);
  };

  // `nmap -oX` is a supported output mode, not an opaque format. Parse it
  // before the text parser so XML scans populate the same UI evidence model.
  if (/<(?:\?xml[^>]*>\s*)?<nmaprun\b|<host\b/i.test(output)) {
    const hosts = parseNmapXmlHosts(output);
    for (const host of hosts) {
      addFinding({
        id: `nmap-xml-host-${findings.length}`,
        type: 'host',
        severity: host.status === 'up' ? 'info' : 'low',
        title: `${host.hostname ? `${host.hostname} ` : ''}${host.ip} (${host.status})`,
        description: host.reason,
        data: {
          host: host.ip,
          hostname: host.hostname || '',
          status: host.status,
          latency: host.latency || '',
          mac: host.mac || '',
          vendor: host.vendor || '',
          os: host.os || '',
        },
        timestamp: Date.now(),
      });

      for (const port of host.ports) {
        if (findings.length >= MAX_FINDINGS) break;
        const state = port.state.toLowerCase();
        addFinding({
          id: `nmap-xml-port-${findings.length}`,
          type: state === 'open' ? 'open_port' : 'port',
          severity: state === 'open' ? 'info' : 'low',
          title: `${host.ip}:${port.port}/${port.protocol} - ${port.service || 'unknown'}`,
          description: [port.product, port.version].filter(Boolean).join(' ') || undefined,
          data: {
            host: host.ip,
            port: port.port,
            protocol: port.protocol,
            state: port.state,
            service: port.service || '',
            product: port.product || '',
            version: port.version || '',
            tunnel: port.tunnel || '',
          },
          timestamp: Date.now(),
        });
      }
    }
    if (findings.length > 0) return findings;
  }

  const lines = output.split('\n');
  let currentHost = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip ONLY startup/footer messages, keep scan info
    if (!trimmed ||
        trimmed.startsWith('Starting Nmap') ||
        trimmed.startsWith('Service detection performed') ||
        trimmed.startsWith('Please report') ||
        trimmed.startsWith('PORT') ||
        trimmed.startsWith('STATE')) {
      continue;
    }
    
    // Keep "Nmap done:" as summary
    if (trimmed.startsWith('Nmap done:')) {
      addFinding({
        id: `nmap-summary-${findings.length}`,
        type: 'summary',
        severity: 'info',
        title: trimmed,
        data: { message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Keep "Not shown:" as context
    if (trimmed.startsWith('Not shown:')) {
      addFinding({
        id: `nmap-context-${findings.length}`,
        type: 'info',
        severity: 'info',
        title: trimmed,
        data: { message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Host is up - latency info
    if (trimmed.match(/Host is up \((.+?) latency\)/)) {
      addFinding({
        id: `nmap-latency-${findings.length}`,
        type: 'info',
        severity: 'info',
        title: trimmed,
        data: { message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // MAC Address
    const macMatch = trimmed.match(/MAC Address: ([0-9A-F:]+) \((.+?)\)/i);
    if (macMatch && currentHost) {
      addFinding({
        id: `nmap-mac-${findings.length}`,
        type: 'info',
        severity: 'info',
        title: `MAC: ${macMatch[1]} (${macMatch[2]})`,
        data: { host: currentHost, mac: macMatch[1], vendor: macMatch[2] },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // OS detection
    if (trimmed.startsWith('OS:') || trimmed.startsWith('Running:')) {
      addFinding({
        id: `nmap-os-${findings.length}`,
        type: 'info',
        severity: 'info',
        title: trimmed,
        data: { host: currentHost, message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Host line: Nmap scan report for example.com (192.168.1.1)
    const hostMatch = trimmed.match(/Nmap scan report for (.+?)(?:\s+\(([^)]+)\))?$/);
    if (hostMatch) {
      currentHost = hostMatch[2] || hostMatch[1];
      addFinding({
        id: `nmap-host-${findings.length}`,
        type: 'host',
        severity: 'info',
        title: `Host: ${currentHost}`,
        data: { host: currentHost, hostname: hostMatch[1] },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Port line: 80/tcp open http Apache httpd 2.4.41
    // P1 FIX: Support compound states like "open|filtered", "closed|filtered"
    const portMatch = trimmed.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered|open\|filtered|closed\|filtered)\s+(\S+)(?:\s+(.+))?$/);
    if (portMatch && currentHost) {
      const [, port, protocol, state, service, version] = portMatch;
      
      // P1 FIX: Determine severity based on state
      let severity: 'info' | 'low' | 'medium' = 'low';
      if (state === 'open') {
        severity = 'info';
      } else if (state.includes('open')) {
        // open|filtered is less certain but still important
        severity = 'low';
      }
      
      addFinding({
        id: `nmap-port-${findings.length}`,
        type: 'open_port',
        severity,
        title: `${currentHost}:${port}/${protocol} - ${service}`,
        description: version || undefined,
        data: {
          host: currentHost,
          port: parseInt(port),
          protocol,
          state,
          service,
          version: version || '',
        },
        timestamp: Date.now(),
      });
    }
  }
  
  if (truncated) {
    findings[findings.length - 1] = {
      id: 'nmap-truncated',
      type: 'warning',
      severity: 'medium',
      title: `Results truncated at ${MAX_FINDINGS} findings`,
      description: `Nmap output exceeded maximum of ${MAX_FINDINGS} findings. Narrow the scan scope for complete parsing.`,
      data: { truncated: true, maxFindings: MAX_FINDINGS },
      timestamp: Date.now(),
    };
  }

  return findings;
}

export function parseMasscan(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 10000;
  let truncated = false;
  
  for (const line of lines) {
    // Reserve one slot for the truncation marker so the public parser limit
    // is a hard limit even when the marker is added.
    if (findings.length >= MAX_FINDINGS - 1) {
      truncated = true;
      break;
    }
    
    // Format: Discovered open port 80/tcp on 192.168.1.1
    const match = line.match(/Discovered open port (\d+)\/(tcp|udp) on ([\d.]+)/);
    if (match && match[1] && match[2] && match[3]) {
      const port = parseInt(match[1]);
      if (!isNaN(port)) {
        findings.push({
          id: `masscan-${findings.length}`,
          type: 'open_port',
          severity: 'info',
          title: `${match[3]}:${port}/${match[2]}`,
          description: `Open port discovered on ${match[3]}`,
          data: {
            port,
            protocol: match[2],
            host: match[3],
            service: getServiceName(port), // Add service name for GUI
          },
          timestamp: Date.now(),
        });
      }
    }
  }
  
  // P1 FIX: Add warning if results were truncated
  if (truncated) {
    findings.push({
      id: 'masscan-truncated',
      type: 'warning',
      severity: 'medium',
      title: `Results truncated at ${MAX_FINDINGS} findings`,
      description: `Masscan output exceeded maximum of ${MAX_FINDINGS} findings. Consider narrowing your scan scope.`,
      data: { truncated: true, maxFindings: MAX_FINDINGS },
      timestamp: Date.now(),
    });
  }
  
  return findings;
}
