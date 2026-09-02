/**
 * Custom/Generic Parser
 * Handles: unknown tools and custom commands
 */

import type { UniversalFinding } from '../universal-parser';

export function parseCustom(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const seenItems = new Set<string>();
  
  // PROTECTION: Limit findings to prevent OOM in exam chaos
  const MAX_FINDINGS = 10000;
  
  // Try to extract structured data
  for (const line of lines) {
    // PROTECTION: Stop if we hit limit
    if (findings.length >= MAX_FINDINGS) {
      findings.push({
        id: 'limit-reached',
        type: 'warning',
        severity: 'medium',
        title: `Findings limit reached (${MAX_FINDINGS})`,
        description: 'Output too large, showing first 10,000 findings',
        data: { limit: MAX_FINDINGS, totalLines: lines.length },
        timestamp: Date.now(),
      });
      break;
    }
    
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 5) continue;
    
    // Skip common noise
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('Starting')) continue;
    
    // Look for common patterns
    // IP addresses with ports
    const ipPortMatch = trimmed.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)\b/);
    if (ipPortMatch) {
      const key = `ip-port-${ipPortMatch[1]}-${ipPortMatch[2]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'ip_port',
          severity: 'info',
          title: `${ipPortMatch[1]}:${ipPortMatch[2]}`,
          data: { ip: ipPortMatch[1], port: parseInt(ipPortMatch[2]), line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // IP addresses
    const ipMatch = trimmed.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    if (ipMatch) {
      const key = `ip-${ipMatch[1]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'ip_address',
          severity: 'info',
          title: ipMatch[1],
          data: { ip: ipMatch[1], line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // URLs
    const urlMatch = trimmed.match(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/);
    if (urlMatch) {
      const key = `url-${urlMatch[1]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'url',
          severity: 'info',
          title: urlMatch[1],
          data: { url: urlMatch[1], line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // Email addresses
    const emailMatch = trimmed.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/);
    if (emailMatch) {
      const key = `email-${emailMatch[1]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'email',
          severity: 'info',
          title: emailMatch[1],
          data: { email: emailMatch[1], line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // CVE IDs
    const cveMatch = trimmed.match(/\b(CVE-\d{4}-\d{4,})\b/i);
    if (cveMatch && cveMatch[1]) {
      const key = `cve-${cveMatch[1]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'cve',
          severity: 'high',
          title: cveMatch[1].toUpperCase(),
          data: { cve: cveMatch[1].toUpperCase(), line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // Ports (open/closed)
    const portMatch = trimmed.match(/(?:port|Port)\s+(\d+)(?:\/(\w+))?\s+(open|closed|filtered)/i);
    if (portMatch && portMatch[1] && portMatch[3]) {
      const key = `port-${portMatch[1]}`;
      if (!seenItems.has(key)) {
        seenItems.add(key);
        findings.push({
          id: `custom-${findings.length}`,
          type: 'port',
          severity: portMatch[3].toLowerCase() === 'open' ? 'info' : 'low',
          title: `Port ${portMatch[1]}${portMatch[2] ? '/' + portMatch[2] : ''} ${portMatch[3]}`,
          data: { port: parseInt(portMatch[1]), protocol: portMatch[2] || 'tcp', state: portMatch[3], line: trimmed },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // Vulnerabilities (generic)
    if (trimmed.toLowerCase().includes('vulnerab') || trimmed.toLowerCase().includes('exploit')) {
      findings.push({
        id: `custom-${findings.length}`,
        type: 'vulnerability',
        severity: 'medium',
        title: trimmed.substring(0, 100),
        data: { line: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Errors/Warnings
    if (trimmed.toLowerCase().includes('error') || trimmed.toLowerCase().includes('failed')) {
      findings.push({
        id: `custom-${findings.length}`,
        type: 'error',
        severity: 'low',
        title: trimmed.substring(0, 100),
        data: { line: trimmed },
        timestamp: Date.now(),
      });
    }
  }
  
  // If no structured data found, create summary finding
  if (findings.length === 0) {
    const outputLines = lines.filter(l => l.trim().length > 0);
    if (outputLines.length > 0) {
      findings.push({
        id: 'custom-0',
        type: 'raw_output',
        severity: 'info',
        title: 'Command output',
        description: outputLines.slice(0, 10).join('\n'),
        data: { totalLines: outputLines.length, output: output.substring(0, 1000) },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}
