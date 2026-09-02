/**
 * Nmap Semantic Parser
 * 
 * Parses nmap output into structured facts with full provenance.
 * Handles all nmap output formats: normal, grepable, XML (future).
 * 
 * Philosophy: Deterministic parsing, not regex guessing.
 * Every fact is traceable to exact line in output.
 */

import type { Fact, Provenance } from '../types';

export interface NmapHost {
  ip: string;
  hostname?: string;
  state: 'up' | 'down' | 'unknown';
  reason?: string;
  os?: string;
  mac?: string;
}

export interface NmapPort {
  ip: string;
  port: number;
  protocol: 'tcp' | 'udp' | 'sctp';
  state: 'open' | 'closed' | 'filtered' | 'unfiltered' | 'open|filtered' | 'closed|filtered';
  service?: string;
  version?: string;
  product?: string;
  extrainfo?: string;
}

export interface NmapScript {
  ip: string;
  port?: number;
  script_id: string;
  output: string;
}

export interface NmapScanInfo {
  scan_type: string;
  protocol: string;
  num_services?: number;
  services?: string;
}

/**
 * Parse nmap output into facts
 */
export function parseNmap(
  command: string,
  output: string,
  command_id: number,
  timestamp: number
): Fact[] {
  // PROTECTION: Strip ALL ANSI codes and control characters aggressively
  const cleanOutput = stripAnsiCodes(output);
  
  const facts: Fact[] = [];
  const lines = cleanOutput.split('\n');
  
  // Detect output format
  const format = detectFormat(cleanOutput);
  
  if (format === 'grepable') {
    return parseGrepable(lines, command_id, timestamp);
  } else if (format === 'xml') {
    return parseXML(cleanOutput, command_id, timestamp);
  } else {
    // Normal format (default)
    return parseNormal(lines, command, command_id, timestamp);
  }
}

/**
 * Aggressive ANSI code stripping for exam chaos
 */
function stripAnsiCodes(text: string): string {
  return text
    // ANSI escape sequences
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // OSC sequences
    .replace(/\x1b\][0-9;]*\x07/g, '')
    // Control characters (except newline, tab, carriage return)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    // Remaining escape codes
    .replace(/\[\d*[A-K]/g, '')
    // Bell character
    .replace(/\x07/g, '')
    // Backspace sequences
    .replace(/\x08+/g, '')
    // Form feed
    .replace(/\x0C/g, '')
    // Vertical tab
    .replace(/\x0B/g, '');
}

/**
 * Detect nmap output format
 */
function detectFormat(output: string): 'normal' | 'grepable' | 'xml' {
  if (output.includes('<?xml')) {
    return 'xml';
  } else if (output.includes('# Nmap') && output.includes('Host:')) {
    return 'grepable';
  } else {
    return 'normal';
  }
}

/**
 * Parse normal nmap output format
 */
function parseNormal(
  lines: string[],
  command: string,
  command_id: number,
  timestamp: number
): Fact[] {
  const facts: Fact[] = [];
  
  let currentHost: NmapHost | null = null;
  let currentHostLineStart = -1;
  let inPortSection = false;
  let inScriptSection = false;
  let currentScriptId: string | null = null;
  let currentScriptOutput: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Parse scan info
    if (trimmed.startsWith('Nmap scan report for')) {
      // Save previous host if exists
      if (currentHost) {
        facts.push(createHostFact(currentHost, command_id, timestamp, currentHostLineStart));
      }
      
      // Parse new host
      currentHost = parseHostLine(trimmed);
      currentHostLineStart = i;
      inPortSection = false;
      inScriptSection = false;
      continue;
    }
    
    // Parse host state
    if (currentHost && trimmed.startsWith('Host is')) {
      const stateMatch = trimmed.match(/Host is (up|down)/);
      if (stateMatch) {
        currentHost.state = stateMatch[1] as 'up' | 'down';
        
        // Extract reason if present
        const reasonMatch = trimmed.match(/\(([^)]+)\)/);
        if (reasonMatch) {
          currentHost.reason = reasonMatch[1];
        }
      }
      continue;
    }
    
    // Parse MAC address
    if (currentHost && trimmed.startsWith('MAC Address:')) {
      const macMatch = trimmed.match(/MAC Address: ([0-9A-F:]+)/i);
      if (macMatch) {
        currentHost.mac = macMatch[1];
      }
      continue;
    }
    
    // Detect port section start
    if (trimmed.startsWith('PORT') && trimmed.includes('STATE') && trimmed.includes('SERVICE')) {
      inPortSection = true;
      inScriptSection = false;
      continue;
    }
    
    // Parse port line
    if (inPortSection && currentHost && /^\d+\/(tcp|udp|sctp)/.test(trimmed)) {
      const port = parsePortLine(trimmed, currentHost.ip);
      if (port) {
        facts.push(createPortFact(port, command_id, timestamp, i));
      }
      continue;
    }
    
    // Detect script output start
    if (trimmed.startsWith('|')) {
      inScriptSection = true;
      
      // Parse script ID
      const scriptMatch = trimmed.match(/^\|\s*([a-zA-Z0-9_-]+):/);
      if (scriptMatch) {
        // Save previous script if exists
        if (currentScriptId && currentScriptOutput.length > 0 && currentHost) {
          const script: NmapScript = {
            ip: currentHost.ip,
            script_id: currentScriptId,
            output: currentScriptOutput.join('\n')
          };
          facts.push(createScriptFact(script, command_id, timestamp, i - currentScriptOutput.length));
        }
        
        // Start new script
        currentScriptId = scriptMatch[1];
        currentScriptOutput = [trimmed];
      } else if (currentScriptId) {
        // Continue current script
        currentScriptOutput.push(trimmed);
      }
      continue;
    } else if (inScriptSection) {
      // End of script section
      if (currentScriptId && currentScriptOutput.length > 0 && currentHost) {
        const script: NmapScript = {
          ip: currentHost.ip,
          script_id: currentScriptId,
          output: currentScriptOutput.join('\n')
        };
        facts.push(createScriptFact(script, command_id, timestamp, i - currentScriptOutput.length));
      }
      currentScriptId = null;
      currentScriptOutput = [];
      inScriptSection = false;
    }
    
    // Parse OS detection
    if (currentHost && trimmed.startsWith('OS details:')) {
      currentHost.os = trimmed.replace('OS details:', '').trim();
      continue;
    }
    
    // Detect end of port section
    if (inPortSection && (trimmed.startsWith('Service detection') || 
                          trimmed.startsWith('OS detection') ||
                          trimmed.startsWith('Nmap done'))) {
      inPortSection = false;
    }
  }
  
  // Save last host
  if (currentHost) {
    facts.push(createHostFact(currentHost, command_id, timestamp, currentHostLineStart));
  }
  
  // Save last script
  if (currentScriptId && currentScriptOutput.length > 0 && currentHost) {
    const script: NmapScript = {
      ip: currentHost.ip,
      script_id: currentScriptId,
      output: currentScriptOutput.join('\n')
    };
    facts.push(createScriptFact(script, command_id, timestamp, lines.length - currentScriptOutput.length));
  }
  
  return facts;
}

/**
 * Parse XML nmap output format (-oX)
 */
function parseXML(
  output: string,
  command_id: number,
  timestamp: number
): Fact[] {
  const facts: Fact[] = [];
  
  // PROTECTION: Check XML size before parsing
  const MAX_XML_SIZE = 50 * 1024 * 1024; // 50MB limit
  if (output.length > MAX_XML_SIZE) {
    console.warn(`[nmap-parser] XML too large (${output.length} bytes), skipping XML parse`);
    facts.push({
      fact_id: `xml-too-large-${command_id}`,
      type: 'error' as any,
      payload: {
        error: 'XML output too large',
        size: output.length,
        limit: MAX_XML_SIZE,
      },
      provenance: {
        command_id,
        line: 0,
        timestamp,
        source: 'nmap-parser',
      },
      timestamp,
    });
    return facts;
  }
  
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(output, 'text/xml');
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      console.warn('[nmap-parser] XML parsing error:', parserError.textContent);
      return facts;
    }
    
    // Parse all hosts
    const hosts = xmlDoc.querySelectorAll('host');
    
    hosts.forEach((hostElement, hostIndex) => {
      // Parse host status
      const statusElement = hostElement.querySelector('status');
      const state = statusElement?.getAttribute('state') as 'up' | 'down' | 'unknown' || 'unknown';
      const reason = statusElement?.getAttribute('reason') || undefined;
      
      // Parse addresses
      const addresses = hostElement.querySelectorAll('address');
      let ip = '';
      let mac = '';
      
      addresses.forEach(addr => {
        const addrType = addr.getAttribute('addrtype');
        const addrValue = addr.getAttribute('addr');
        
        if (addrType === 'ipv4' || addrType === 'ipv6') {
          ip = addrValue || '';
        } else if (addrType === 'mac') {
          mac = addrValue || '';
        }
      });
      
      if (!ip) return; // Skip if no IP found
      
      // Parse hostnames
      const hostnamesElement = hostElement.querySelector('hostnames');
      const hostnameElement = hostnamesElement?.querySelector('hostname');
      const hostname = hostnameElement?.getAttribute('name') || undefined;
      
      // Parse OS detection
      const osElement = hostElement.querySelector('os osmatch');
      const os = osElement?.getAttribute('name') || undefined;
      
      // Create host fact
      const host: NmapHost = {
        ip,
        hostname,
        state,
        reason,
        os,
        mac: mac || undefined
      };
      
      facts.push(createHostFact(host, command_id, timestamp, hostIndex));
      
      // Parse ports
      const ports = hostElement.querySelectorAll('ports port');
      
      ports.forEach((portElement, portIndex) => {
        const portId = portElement.getAttribute('portid');
        const protocol = portElement.getAttribute('protocol') as 'tcp' | 'udp' | 'sctp';
        
        if (!portId || !protocol) return;
        
        const portNum = parseInt(portId);
        if (isNaN(portNum)) return;
        
        // Parse port state
        const stateElement = portElement.querySelector('state');
        const portState = stateElement?.getAttribute('state') as NmapPort['state'] || 'unknown';
        
        // Parse service
        const serviceElement = portElement.querySelector('service');
        const service = serviceElement?.getAttribute('name') || undefined;
        const product = serviceElement?.getAttribute('product') || undefined;
        const version = serviceElement?.getAttribute('version') || undefined;
        const extrainfo = serviceElement?.getAttribute('extrainfo') || undefined;
        
        // Create port fact
        const port: NmapPort = {
          ip,
          port: portNum,
          protocol,
          state: portState,
          service,
          version,
          product,
          extrainfo
        };
        
        facts.push(createPortFact(port, command_id, timestamp, hostIndex * 1000 + portIndex));
        
        // Parse scripts for this port
        const scripts = portElement.querySelectorAll('script');
        
        scripts.forEach((scriptElement, scriptIndex) => {
          const scriptId = scriptElement.getAttribute('id');
          const scriptOutput = scriptElement.getAttribute('output');
          
          if (!scriptId || !scriptOutput) return;
          
          const script: NmapScript = {
            ip,
            port: portNum,
            script_id: scriptId,
            output: scriptOutput
          };
          
          facts.push(createScriptFact(script, command_id, timestamp, hostIndex * 1000 + portIndex * 100 + scriptIndex));
        });
      });
      
      // Parse host scripts (not associated with specific port)
      const hostScripts = hostElement.querySelectorAll('hostscript script');
      
      hostScripts.forEach((scriptElement, scriptIndex) => {
        const scriptId = scriptElement.getAttribute('id');
        const scriptOutput = scriptElement.getAttribute('output');
        
        if (!scriptId || !scriptOutput) return;
        
        const script: NmapScript = {
          ip,
          script_id: scriptId,
          output: scriptOutput
        };
        
        facts.push(createScriptFact(script, command_id, timestamp, hostIndex * 10000 + scriptIndex));
      });
    });
    
  } catch (error) {
    console.error('[nmap-parser] Error parsing XML:', error);
  }
  
  return facts;
}

/**
 * Parse grepable nmap output format
 */
function parseGrepable(
  lines: string[],
  command_id: number,
  timestamp: number
): Fact[] {
  const facts: Fact[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip comments
    if (line.startsWith('#')) continue;
    
    // Parse host line: Host: 10.10.11.247 () Status: Up
    const hostMatch = line.match(/^Host:\s+([0-9.]+)\s+\(([^)]*)\)\s+Status:\s+(Up|Down)/i);
    if (hostMatch) {
      const host: NmapHost = {
        ip: hostMatch[1],
        hostname: hostMatch[2] || undefined,
        state: hostMatch[3].toLowerCase() as 'up' | 'down'
      };
      facts.push(createHostFact(host, command_id, timestamp, i));
      continue;
    }
    
    // Parse port line: Host: 10.10.11.247 () Ports: 22/open/tcp//ssh///
    const portMatch = line.match(/^Host:\s+([0-9.]+)\s+\([^)]*\)\s+Ports:\s+(.+)/);
    if (portMatch) {
      const ip = portMatch[1];
      const portsStr = portMatch[2];
      
      // Split by comma (multiple ports)
      const portEntries = portsStr.split(',').map(p => p.trim());
      
      for (const entry of portEntries) {
        // Format: 22/open/tcp//ssh///
        const parts = entry.split('/');
        if (parts.length >= 3) {
          const port: NmapPort = {
            ip,
            port: parseInt(parts[0]),
            protocol: parts[2] as 'tcp' | 'udp' | 'sctp',
            state: parts[1] as NmapPort['state'],
            service: parts[4] || undefined,
            version: parts[6] || undefined
          };
          
          if (!isNaN(port.port)) {
            facts.push(createPortFact(port, command_id, timestamp, i));
          }
        }
      }
    }
  }
  
  return facts;
}

/**
 * Parse host line from normal output
 */
function parseHostLine(line: string): NmapHost {
  // Format: "Nmap scan report for 10.10.11.247"
  // Format: "Nmap scan report for example.com (10.10.11.247)"
  
  const match1 = line.match(/Nmap scan report for ([a-zA-Z0-9.-]+) \(([0-9.]+)\)/);
  if (match1) {
    return {
      ip: match1[2],
      hostname: match1[1],
      state: 'unknown'
    };
  }
  
  const match2 = line.match(/Nmap scan report for ([0-9.]+)/);
  if (match2) {
    return {
      ip: match2[1],
      state: 'unknown'
    };
  }
  
  // Fallback
  return {
    ip: 'unknown',
    state: 'unknown'
  };
}

/**
 * Parse port line from normal output
 */
function parsePortLine(line: string, ip: string): NmapPort | null {
  // Format: "22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.5"
  // Format: "80/tcp   open  http    Apache httpd 2.4.41"
  // Format: "443/tcp  filtered https"
  
  const parts = line.split(/\s+/);
  if (parts.length < 3) return null;
  
  // Parse port/protocol
  const portProto = parts[0].split('/');
  if (portProto.length !== 2) return null;
  
  const portNum = parseInt(portProto[0]);
  if (isNaN(portNum)) return null;
  
  const protocol = portProto[1] as 'tcp' | 'udp' | 'sctp';
  const state = parts[1] as NmapPort['state'];
  const service = parts[2] !== '?' ? parts[2] : undefined;
  
  // Parse version info (everything after service name)
  let version: string | undefined;
  let product: string | undefined;
  let extrainfo: string | undefined;
  
  if (parts.length > 3) {
    const versionParts = parts.slice(3);
    product = versionParts.join(' ');
    
    // Try to extract version number
    const versionMatch = product.match(/\b(\d+\.[\d.]+[a-z0-9]*)\b/i);
    if (versionMatch) {
      version = versionMatch[1];
    }
  }
  
  return {
    ip,
    port: portNum,
    protocol,
    state,
    service,
    version,
    product,
    extrainfo
  };
}

/**
 * Create host fact with provenance
 */
function createHostFact(
  host: NmapHost,
  command_id: number,
  timestamp: number,
  line: number
): Fact {
  return {
    fact_id: `host:${host.ip}:${command_id}`,
    type: 'host',
    payload: {
      ip: host.ip,
      hostname: host.hostname,
      state: host.state,
      reason: host.reason,
      os: host.os,
      mac: host.mac
    },
    provenance: {
      command_id,
      line,
      timestamp,
      source: 'nmap-parser'
    },
    timestamp
  };
}

/**
 * Create port fact with provenance
 */
function createPortFact(
  port: NmapPort,
  command_id: number,
  timestamp: number,
  line: number
): Fact {
  return {
    fact_id: `port:${port.ip}:${port.port}:${port.protocol}:${command_id}`,
    type: 'port',
    payload: {
      ip: port.ip,
      port: port.port,
      protocol: port.protocol,
      state: port.state,
      service: port.service,
      version: port.version,
      product: port.product,
      extrainfo: port.extrainfo
    },
    provenance: {
      command_id,
      line,
      timestamp,
      source: 'nmap-parser'
    },
    timestamp
  };
}

/**
 * Create script fact with provenance
 */
function createScriptFact(
  script: NmapScript,
  command_id: number,
  timestamp: number,
  line: number
): Fact {
  return {
    fact_id: `script:${script.ip}:${script.script_id}:${command_id}`,
    type: 'script_output',
    payload: {
      ip: script.ip,
      port: script.port,
      script_id: script.script_id,
      output: script.output
    },
    provenance: {
      command_id,
      line,
      timestamp,
      source: 'nmap-parser'
    },
    timestamp
  };
}

/**
 * Extract scan statistics from nmap output
 */
export function extractScanStats(output: string): {
  hosts_scanned: number;
  hosts_up: number;
  ports_scanned: number;
  scan_time: number;
} | null {
  // Parse: "Nmap done: 1 IP address (1 host up) scanned in 2.34 seconds"
  const match = output.match(/Nmap done: (\d+) IP address(?:es)? \((\d+) host(?:s)? up\) scanned in ([\d.]+) seconds/);
  
  if (match) {
    return {
      hosts_scanned: parseInt(match[1]),
      hosts_up: parseInt(match[2]),
      ports_scanned: 0, // Not available in this format
      scan_time: parseFloat(match[3])
    };
  }
  
  return null;
}
