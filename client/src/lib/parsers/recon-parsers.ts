/**
 * Reconnaissance Tool Parsers
 * Handles: theHarvester, whois, tcpdump
 */

import type { UniversalFinding } from '../universal-parser';

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

export function parseTheHarvester(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 10000;
  const seenEmails = new Set<string>();
  const seenHosts = new Set<string>();
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Skip headers and separators
    if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('*') || trimmed.startsWith('-')) continue;
    
    // Email addresses
    const emailMatch = trimmed.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/);
    if (emailMatch && emailMatch[1] && !seenEmails.has(emailMatch[1])) {
      seenEmails.add(emailMatch[1]);
      const email = emailMatch[1];
      const domain = email.split('@')[1];
      
      findings.push({
        id: `harvester-${findings.length}`,
        type: 'email',
        severity: 'info',
        title: email,
        description: `Email address discovered`,
        data: { 
          email,
          domain,
          // GUI enhancement: Categorize email type
          isAdmin: /admin|root|postmaster|webmaster/i.test(email),
          isInfo: /info|contact|support|sales/i.test(email),
        },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Hosts/subdomains (but not emails)
    if (!trimmed.includes('@')) {
      const hostMatch = trimmed.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
      if (hostMatch && hostMatch[0] && !seenHosts.has(hostMatch[0])) {
        seenHosts.add(hostMatch[0]);
        findings.push({
          id: `harvester-${findings.length}`,
          type: 'host',
          severity: 'info',
          title: hostMatch[0],
          description: 'Subdomain or host discovered',
          data: { host: hostMatch[0] },
          timestamp: Date.now(),
        });
        continue;
      }
      
      // IP addresses
      const ipMatch = trimmed.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (ipMatch && ipMatch[1] && !seenHosts.has(ipMatch[1])) {
        seenHosts.add(ipMatch[1]);
        findings.push({
          id: `harvester-${findings.length}`,
          type: 'ip_address',
          severity: 'info',
          title: ipMatch[1],
          description: 'IP address discovered',
          data: { ip: ipMatch[1] },
          timestamp: Date.now(),
        });
      }
    }
  }
  
  return findings;
}

export function parseWhois(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const data: Record<string, string> = {};
  const MAX_FINDINGS = 100; // Whois is usually small
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('#')) continue;
    
    // Parse key-value pairs
    const match = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (match && match[1] && match[2]) {
      const key = match[1].trim();
      const value = match[2].trim();
      data[key] = value;
      
      // GUI enhancement: Categorize and prioritize important fields
      let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info';
      let category = 'general';
      
      const keyLower = key.toLowerCase();
      
      if (keyLower.includes('registrar')) {
        category = 'registrar';
        severity = 'info';
      } else if (keyLower.includes('creation') || keyLower.includes('registered')) {
        category = 'dates';
        severity = 'info';
      } else if (keyLower.includes('expir') || keyLower.includes('expiry')) {
        category = 'dates';
        severity = 'low';
        // Check if expiring soon
        const expiryDate = new Date(value);
        const daysUntilExpiry = (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntilExpiry < 30 && daysUntilExpiry > 0) severity = 'medium';
      } else if (keyLower.includes('name server') || keyLower.includes('nameserver')) {
        category = 'dns';
        severity = 'info';
      } else if (keyLower.includes('email') || keyLower.includes('e-mail')) {
        category = 'contact';
        severity = 'info';
      } else if (keyLower.includes('status')) {
        category = 'status';
        severity = 'info';
      }
      
      // Create findings for important fields
      if (category !== 'general') {
        findings.push({
          id: `whois-${findings.length}`,
          type: 'whois_info',
          severity,
          title: value,
          description: key,
          data: { 
            key, 
            value,
            category,
          },
          timestamp: Date.now(),
        });
      }
    }
  }
  
  return findings;
}

export function parseTcpdump(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 5000; // Lower limit for packet captures
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) {
      findings.push({
        id: 'tcpdump-limit',
        type: 'warning',
        severity: 'medium',
        title: `Packet limit reached (${MAX_FINDINGS})`,
        description: 'Too many packets captured, showing first 5000',
        data: { limit: MAX_FINDINGS, totalLines: lines.length },
        timestamp: Date.now(),
      });
      break;
    }
    
    // 12:34:56.789012 IP 192.168.1.1.80 > 192.168.1.100.12345: Flags [S], seq 123
    const match = line.match(/(\d+:\d+:\d+\.\d+)\s+IP\s+([\d.]+)\.(\d+)\s+>\s+([\d.]+)\.(\d+):\s+Flags\s+\[([^\]]+)\]/);
    if (match && match[1] && match[2] && match[3] && match[4] && match[5] && match[6]) {
      const srcPort = parseInt(match[3]);
      const dstPort = parseInt(match[5]);
      
      if (!isNaN(srcPort) && !isNaN(dstPort)) {
        // GUI enhancement: Classify packet type
        const flags = match[6];
        let packetType = 'unknown';
        let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info';
        
        if (flags.includes('S') && !flags.includes('A')) {
          packetType = 'SYN (connection attempt)';
        } else if (flags.includes('S') && flags.includes('A')) {
          packetType = 'SYN-ACK (connection accepted)';
        } else if (flags.includes('R')) {
          packetType = 'RST (connection reset)';
          severity = 'low';
        } else if (flags.includes('F')) {
          packetType = 'FIN (connection close)';
        }
        
        findings.push({
          id: `tcpdump-${findings.length}`,
          type: 'packet',
          severity,
          title: `${match[2]}:${srcPort} → ${match[4]}:${dstPort}`,
          description: packetType,
          data: {
            timestamp: match[1],
            srcIp: match[2],
            srcPort,
            dstIp: match[4],
            dstPort,
            flags,
            packetType,
            // GUI enhancement: Add service names
            srcService: getServiceName(srcPort),
            dstService: getServiceName(dstPort),
          },
          timestamp: Date.now(),
        });
      }
    }
  }
  
  return findings;
}
