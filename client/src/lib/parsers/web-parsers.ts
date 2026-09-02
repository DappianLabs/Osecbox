/**
 * Web Scanner Parsers
 * Handles: nikto, nuclei, wpscan
 */

import type { UniversalFinding } from '../universal-parser';

/**
 * Extract version from text
 */
function extractVersion(text: string): string | undefined {
  const versionMatch = text.match(/\b(\d+\.[\d.]+)\b/);
  return versionMatch ? versionMatch[1] : undefined;
}

/**
 * Extract component name from text
 */
function extractComponent(text: string): string | undefined {
  const componentMatch = text.match(/\b(WordPress|Plugin|Theme|PHP|Apache|Nginx)\b/i);
  return componentMatch ? componentMatch[1] : undefined;
}

function normalizeSeverity(value: string): UniversalFinding['severity'] {
  const severity = value.toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'info'].includes(severity)
    ? severity as UniversalFinding['severity']
    : 'unknown';
}

export function parseNikto(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10000;
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Skip headers, separators, and version info
    if (!trimmed || 
        trimmed.startsWith('+-') ||
        trimmed.startsWith('+ Target') || 
        trimmed.startsWith('+ Start') ||
        trimmed.includes('Nikto v')) {
      continue;
    }
    
    // Only process lines starting with '+'
    if (!trimmed.startsWith('+')) {
      continue;
    }
    
    // Keep scan summary (requests count)
    if (trimmed.includes('requests:') && trimmed.includes('error(s)')) {
      findings.push({
        id: `nikto-summary-${findings.length}`,
        type: 'summary',
        severity: 'info',
        title: trimmed.replace('+ ', ''),
        data: { message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Keep "End Time" for duration
    if (trimmed.startsWith('+ End Time:')) {
      const durationMatch = trimmed.match(/\((\d+\s+seconds)\)/);
      if (durationMatch) {
        findings.push({
          id: `nikto-duration-${findings.length}`,
          type: 'info',
          severity: 'info',
          title: `Scan completed in ${durationMatch[1]}`,
          data: { duration: durationMatch[1] },
          timestamp: Date.now(),
        });
      }
      continue;
    }
    
    // Format: + OSVDB-3268: /admin/: Directory indexing found.
    const osvdbMatch = trimmed.match(/^\+\s+OSVDB-(\d+):\s*(.+?):\s*(.+)$/);
    if (osvdbMatch) {
      const [, osvdbId, path, description] = osvdbMatch;
      const severity = description.toLowerCase().includes('vulnerable') ? 'high' : 'medium';
      
      findings.push({
        id: `nikto-${findings.length}`,
        type: 'vulnerability',
        severity,
        title: description,
        description: `Path: ${path}`,
        data: { osvdbId: `OSVDB-${osvdbId}`, path, description },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // Format: + /admin/: Directory indexing found.
    const simpleMatch = trimmed.match(/^\+\s+(.+?):\s*(.+)$/);
    if (simpleMatch) {
      const [, path, description] = simpleMatch;
      
      // Skip server info lines
      if (path.startsWith('Server:') || path.startsWith('Retrieved')) continue;
      
      const severity = description.toLowerCase().includes('vulnerable') ? 'high' : 'info';
      
      findings.push({
        id: `nikto-${findings.length}`,
        type: 'finding',
        severity,
        title: description,
        description: `Path: ${path}`,
        data: { path, description },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}

export function parseNuclei(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10000;
  const addFinding = (finding: UniversalFinding): void => {
    if (findings.length < MAX_FINDINGS) findings.push(finding);
  };
  const lines = output.split('\n');

  // Nuclei's `-json`/`-jsonl` output is the most lossless mode. Parse the
  // stable fields while retaining the exact JSON in the terminal buffer.
  for (const line of lines) {
    const trimmedJson = line.trim();
    if (!trimmedJson || (!trimmedJson.startsWith('{') && !trimmedJson.startsWith('['))) continue;
    try {
      const payload = JSON.parse(trimmedJson);
      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        const item = record as Record<string, any>;
        const info = item.info && typeof item.info === 'object' ? item.info : {};
        const templateId = String(item['template-id'] || item.templateId || 'nuclei-finding');
        const url = String(item['matched-at'] || item.matchedAt || item.host || item.url || '');
        if (!url) continue;
        const severityText = String(info.severity || item.severity || 'unknown').toLowerCase();
        const severity = ['critical', 'high', 'medium', 'low', 'info'].includes(severityText)
          ? severityText as UniversalFinding['severity']
          : 'unknown';
        const classification = info.classification && typeof info.classification === 'object'
          ? info.classification
          : {};
        addFinding({
          id: `nuclei-json-${findings.length}`,
          type: 'vulnerability',
          severity,
          title: String(info.name || templateId),
          description: typeof info.description === 'string' ? info.description : undefined,
          data: {
            templateId,
            url,
            protocol: item.type || item['matcher-name'] || '',
            extracted: item['extracted-results'] || [],
            cve: classification['cve-id'] || undefined,
            cwe: classification['cwe-id'] || undefined,
            cvss: classification['cvss-score'] || undefined,
            tags: info.tags || [],
          },
          timestamp: Date.now(),
        });
      }
    } catch {
      // Human-readable lines are handled by the text parser below.
    }
  }

  if (findings.length > 0) return findings;
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Skip ONLY loading/progress messages, keep warnings/errors/summaries
    if (!trimmed || 
        trimmed.includes('Loading templates') ||
        trimmed.includes('Templates loaded for current scan') ||
        trimmed.includes('Targets loaded for current scan') ||
        trimmed.includes('Templates clustered') ||
        trimmed.includes('Using Interactsh') ||
        trimmed.includes('Current nuclei version') ||
        trimmed.includes('Current nuclei-templates version')) {
      continue;
    }
    
    // Keep [WRN] and [ERR] - they're important
    // Keep [INF] if it's a summary (contains "Requests [total:")
    if (trimmed.startsWith('[INF]') && !trimmed.includes('Requests [total:')) {
      continue;
    }
    
    // If it's a warning, error, or summary, create an info finding
    if (trimmed.startsWith('[WRN]') || trimmed.startsWith('[ERR]') || trimmed.includes('Requests [total:')) {
      addFinding({
        id: `nuclei-info-${findings.length}`,
        type: trimmed.startsWith('[ERR]') ? 'error' : 'info',
        severity: trimmed.startsWith('[ERR]') ? 'medium' : 'info',
        title: trimmed.replace(/^\[(INF|WRN|ERR)\]\s*/, ''),
        data: { message: trimmed },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // NEW FORMAT: [2024-01-15 12:00:15] [template-id] [protocol] [severity] url [extracted-data]
    // OR: [template-id] [protocol] [severity] url [extracted-data]
    const newFormatMatch = trimmed.match(/^(?:\[[^\]]+\]\s+)?\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[(\w+)\]\s+(.+?)(?:\s+\[(.+)\])?$/);
    if (newFormatMatch) {
      const [, templateId, protocol, severity, url, extracted] = newFormatMatch;
      
      addFinding({
        id: `nuclei-${findings.length}`,
        type: 'vulnerability',
        severity: normalizeSeverity(severity),
        title: templateId.replace(/-/g, ' ').replace(/:/g, ' - '),
        description: extracted || undefined,
        data: {
          templateId,
          protocol,
          url,
          extracted: extracted || '',
        },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // OLD FORMAT: [severity] [template-id] description on url
    const oldFormatMatch = trimmed.match(/^\[(\w+)\]\s+\[([^\]]+)\]\s+(.+?)\s+(?:on|at)\s+(.+)$/);
    if (oldFormatMatch) {
      const [, severity, templateId, description, url] = oldFormatMatch;
      
      addFinding({
        id: `nuclei-${findings.length}`,
        type: 'vulnerability',
        severity: normalizeSeverity(severity),
        title: templateId.replace(/-/g, ' '),
        description,
        data: { templateId, url, description },
        timestamp: Date.now(),
      });
      continue;
    }
    
    // COMPACT FORMAT: [severity] [template-id] url
    const compactMatch = trimmed.match(/^\[(\w+)\]\s+\[([^\]]+)\]\s+(.+)$/);
    if (compactMatch) {
      const [, severity, templateId, url] = compactMatch;
      
      addFinding({
        id: `nuclei-${findings.length}`,
        type: 'vulnerability',
        severity: normalizeSeverity(severity),
        title: templateId.replace(/-/g, ' '),
        data: { templateId, url },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}

export function parseWPScan(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 10000;
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // [+] WordPress version 5.8 identified
    if (trimmed.startsWith('[+]') && trimmed.includes('identified')) {
      const title = trimmed.replace('[+]', '').trim();
      findings.push({
        id: `wpscan-${findings.length}`,
        type: 'identification',
        severity: 'info',
        title,
        description: 'WordPress component identified',
        data: { 
          raw: trimmed,
          // GUI enhancement: Extract version if present
          version: extractVersion(title),
          component: extractComponent(title),
        },
        timestamp: Date.now(),
      });
    }
    
    // [!] Vulnerability found
    if (trimmed.startsWith('[!]')) {
      const title = trimmed.replace('[!]', '').trim();
      findings.push({
        id: `wpscan-${findings.length}`,
        type: 'vulnerability',
        severity: 'high',
        title,
        description: 'WordPress vulnerability detected',
        data: { 
          raw: trimmed,
          // GUI enhancement: Check if it's a known CVE
          hasCVE: /CVE-\d{4}-\d{4,}/i.test(title),
        },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}
