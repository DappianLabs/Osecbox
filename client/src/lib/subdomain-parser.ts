// Subdomain enumeration output parser - supports multiple tools

import { cleanANSI } from '@/lib/utils/ansi-cleaner';

const MAX_SUBDOMAIN_FINDINGS = 10_000;

export interface SubdomainFinding {
  subdomain: string;
  ip?: string;
  source?: string; // Which tool/source found it
  ports?: string[];
  status?: 'active' | 'inactive' | 'unknown';
  httpStatus?: number;
  title?: string;
  technologies?: string[];
}

export interface SubdomainResult {
  domain: string;
  tool: string;
  subdomains: SubdomainFinding[];
  summary: {
    total: number;
    withIP: number;
    withPorts: number;
    active: number;
    sources: string[];
  };
  metadata?: {
    scanTime?: string;
    sources?: string[];
  };
}

function normalizeDomain(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function isValidHostname(value: string): boolean {
  if (!value || value.length > 253 || value.startsWith('*.')) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every(label =>
    label.length > 0 &&
    label.length <= 63 &&
    !label.startsWith('-') &&
    !label.endsWith('-') &&
    /^[a-z0-9-]+$/i.test(label)
  );
}

function belongsToTarget(value: string, targetDomain: string): boolean {
  return value === targetDomain || value.endsWith(`.${targetDomain}`);
}

/**
 * Parse Subfinder output
 * Format: subdomain.example.com (default)
 * With -oJ (JSON): {"host":"subdomain.example.com","ip":"1.2.3.4","source":"crtsh"}
 * With -oI (IP): subdomain.example.com [1.2.3.4]
 * 
 * Edge cases handled:
 * - Empty lines and whitespace
 * - Malformed JSON
 * - Invalid domain formats
 * - Duplicate entries
 * - Mixed output formats
 */
function parseSubfinder(output: string): SubdomainFinding[] {
  const findings: SubdomainFinding[] = [];
  // Use shared ANSI cleaner for comprehensive cleaning
  const cleanOutput = cleanANSI(output);
  const lines = cleanOutput.split('\n');

  for (const line of lines) {
    if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip progress/info lines (comprehensive patterns from documentation)
    if (trimmed.startsWith('[') || 
        trimmed.startsWith('INF') ||
        trimmed.startsWith('WRN') ||
        trimmed.startsWith('ERR') ||
        trimmed.includes('INF ') || 
        trimmed.includes('WRN ') ||
        trimmed.includes('ERR ') ||
        trimmed.includes('Enumerating') ||
        trimmed.includes('sources for') ||
        trimmed.includes('Starting') ||
        trimmed.includes('Finished')) {
      continue;
    }

    // Try JSON format first (-oJ flag)
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        const subdomain = json.host || json.subdomain || json.name || json.domain;
        if (subdomain && subdomain.includes('.')) {
          findings.push({
            subdomain: subdomain.toLowerCase(),
            ip: json.ip || json.address || json.ipaddress,
            source: json.source || 'subfinder',
            status: (json.ip || json.address || json.ipaddress) ? 'active' : 'unknown',
          });
        }
        continue;
      } catch (e) {
        // Not valid JSON, continue to plain text parsing
      }
    }

    // Format with IP: subdomain.example.com [1.2.3.4]
    const ipMatch = trimmed.match(/^([^\s\[]+)\s+\[([^\]]+)\]$/);
    if (ipMatch) {
      const subdomain = ipMatch[1].toLowerCase();
      const ip = ipMatch[2].trim();
      if (subdomain.includes('.') && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        findings.push({
          subdomain,
          ip,
          source: 'subfinder',
          status: 'active',
        });
      }
      continue;
    }

    // Plain text format (default) - validate domain format
    if (trimmed.includes('.') && 
        !trimmed.includes(' ') && 
        trimmed.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
      findings.push({
        subdomain: trimmed.toLowerCase(),
        source: 'subfinder',
        status: 'unknown',
      });
    }
  }

  return findings;
}

/**
 * Parse Amass output
 * Default format: subdomain.example.com
 * With -ip: subdomain.example.com [1.2.3.4,5.6.7.8]
 * With -json: {"name":"subdomain.example.com","domain":"example.com","addresses":[{"ip":"1.2.3.4"}],"sources":["crtsh","virustotal"]}
 * With -src: subdomain.example.com (Google)
 * 
 * Edge cases handled:
 * - Multiple IP addresses
 * - IPv6 addresses
 * - Missing addresses field in JSON
 * - Progress/status messages
 * - ANSI color codes
 */
function parseAmass(output: string): SubdomainFinding[] {
  const findings: SubdomainFinding[] = [];
  // Use shared ANSI cleaner for comprehensive cleaning
  const cleanOutput = cleanANSI(output);
  const lines = cleanOutput.split('\n');

  for (const line of lines) {
    if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip progress/status lines (comprehensive patterns from documentation)
    if (trimmed.startsWith('OWASP') ||
        trimmed.startsWith('Amass') ||
        trimmed.includes('Querying') ||
        trimmed.includes('Average DNS') ||
        trimmed.includes('Performing DNS') ||
        trimmed.includes('Performing') ||
        trimmed.includes('ASN:') ||
        trimmed.includes('CIDR:') ||
        trimmed.includes('Resolved') ||
        trimmed.includes('DNS queries')) {
      continue;
    }

    // Try JSON format first (-json flag)
    if (trimmed.startsWith('{')) {
      try {
        interface AmassJSON {
          name: string;
          addresses?: Array<{ ip: string; cidr?: string }>;
          sources?: string[];
          tag?: string;
        }
        const json: AmassJSON = JSON.parse(trimmed);
        if (json.name && json.name.includes('.')) {
          const ips = json.addresses?.map((a) => a.ip).filter(Boolean) || [];
          findings.push({
            subdomain: json.name.toLowerCase(),
            ip: ips[0],
            source: json.sources?.join(', ') || 'amass',
            status: ips.length > 0 ? 'active' : 'unknown',
          });
        }
        continue;
      } catch (e) {
        // Not valid JSON, continue to plain text parsing
      }
    }

    // Format with IPs: subdomain.example.com [1.2.3.4,5.6.7.8]
    const ipMatch = trimmed.match(/^([^\s\[]+)\s+\[([^\]]+)\]$/);
    if (ipMatch) {
      const subdomain = ipMatch[1].toLowerCase();
      const ips = ipMatch[2].split(',').map(ip => ip.trim());
      // Validate IP format (IPv4 or IPv6)
      const validIps = ips.filter(ip => 
        ip.match(/^\d+\.\d+\.\d+\.\d+$/) || // IPv4
        ip.match(/^[0-9a-f:]+$/i) // IPv6
      );
      if (subdomain.includes('.') && validIps.length > 0) {
        findings.push({
          subdomain,
          ip: validIps[0],
          source: 'amass',
          status: 'active',
        });
      }
      continue;
    }

    // Format with source: subdomain.example.com (Google)
    const sourceMatch = trimmed.match(/^([^\s\(]+)\s+\(([^)]+)\)$/);
    if (sourceMatch) {
      const subdomain = sourceMatch[1].toLowerCase();
      if (subdomain.includes('.') && subdomain.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
        findings.push({
          subdomain,
          source: `amass (${sourceMatch[2]})`,
          status: 'unknown',
        });
      }
      continue;
    }

    // Plain text format (default) - validate domain format
    if (trimmed.includes('.') && 
        !trimmed.includes(' ') && 
        !trimmed.startsWith('[') &&
        trimmed.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
      findings.push({
        subdomain: trimmed.toLowerCase(),
        source: 'amass',
        status: 'unknown',
      });
    }
  }

  return findings;
}

/**
 * Parse Assetfinder output
 * Default format: subdomain.example.com
 * With -subs-only: only subdomains (filters out main domain)
 * 
 * Edge cases handled:
 * - Wildcard domains (*.example.com)
 * - Invalid domain formats
 * - Empty lines
 * - Duplicate entries
 */
function parseAssetfinder(output: string): SubdomainFinding[] {
  const findings: SubdomainFinding[] = [];
  // Use shared ANSI cleaner for comprehensive cleaning
  const cleanOutput = cleanANSI(output);
  const lines = cleanOutput.split('\n');

  for (const line of lines) {
    if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip wildcard domains
    if (trimmed.startsWith('*.')) {
      continue;
    }

    // Validate domain format and extract
    if (trimmed.includes('.') && 
        !trimmed.includes(' ') &&
        trimmed.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
      findings.push({
        subdomain: trimmed.toLowerCase(),
        source: 'assetfinder',
        status: 'unknown',
      });
    }
  }

  return findings;
}

/**
 * Parse Sublist3r output
 * Format: subdomain.example.com
 * Progress lines: [*] Enumerating subdomains now for example.com
 * Summary: [*] Total Unique Subdomains Found: 42
 * 
 * Edge cases handled:
 * - Progress messages with [*], [-], [+]
 * - Search engine status messages
 * - Error messages
 * - ANSI color codes
 * - Duplicate entries
 */
function parseSublist3r(output: string): SubdomainFinding[] {
  const findings: SubdomainFinding[] = [];
  // Use shared ANSI cleaner for comprehensive cleaning
  const cleanOutput = cleanANSI(output);
  const lines = cleanOutput.split('\n');

  for (const line of lines) {
    if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Sublist3r uses [+] for discovered hosts, while [*]/[-]/[!]/[i]
    // are status or diagnostic lines. Keep the discovery prefix and parse
    // the hostname that follows it.
    if (trimmed.startsWith('[*]') ||
        trimmed.startsWith('[-]') ||
        trimmed.startsWith('[!]') ||
        trimmed.startsWith('[i]') ||
        trimmed.includes('Total Unique Subdomains') ||
        trimmed.includes('Enumerating subdomains') ||
        trimmed.includes('Starting enumeration') ||
        trimmed.includes('Searching now in') ||
        trimmed.includes('Searching in') ||
        trimmed.includes('Total Subdomains Found') ||
        trimmed.includes('Bruteforcing') ||
        trimmed.includes('Error:') ||
        trimmed.includes('Warning:') ||
        trimmed.includes('Sublist3r') ||
        trimmed.includes('====')) {
      continue;
    }

    const discoveryLine = trimmed.replace(/^\[\+\]\s*/, '').trim();
    const hostnameMatch = discoveryLine.match(/(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/i);
    const candidate = hostnameMatch?.[1]?.toLowerCase();

    if (candidate && isValidHostname(candidate)) {
      findings.push({
        subdomain: candidate,
        source: 'sublist3r',
        status: 'unknown',
      });
    }
  }

  return findings;
}

/**
 * Parse ffuf output for subdomain enumeration
 * Plain format: api.example.com [Status: 200, Size: 1234, Words: 56, Lines: 78]
 * OR FUZZ value: api [Status: 200, Size: 1234, Words: 56, Lines: 78]
 * JSON format: {"input":{"FUZZ":"api"},"position":1,"status":200,"length":1234,"words":56,"lines":78,"content-type":"text/html","url":"https://api.example.com/"}
 * Simple format: https://api.example.com
 * 
 * Edge cases handled:
 * - Progress bars and status messages
 * - Multiple FUZZ positions
 * - Error responses (4xx, 5xx)
 * - Redirects
 * - Invalid URLs
 * - ANSI color codes
 * - FUZZ value reconstruction (when ffuf outputs just "api" instead of "api.example.com")
 */
function parseFfuf(output: string, domain: string): SubdomainFinding[] {
  const findings: SubdomainFinding[] = [];
  // Use shared ANSI cleaner for comprehensive cleaning
  const cleanOutput = cleanANSI(output);
  const lines = cleanOutput.split('\n');

  for (const line of lines) {
    if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip progress/header lines (comprehensive patterns from documentation)
    if (trimmed.startsWith('::') ||
        trimmed.startsWith('___') ||
        trimmed.startsWith('//') ||
        trimmed.includes('Progress:') ||
        trimmed.includes('Calibration') ||
        trimmed.includes('Errors:') ||
        (trimmed.includes('FUZZ') && trimmed.includes('Status') && trimmed.includes('Size')) ||
        trimmed.includes('by OJ Reeves') ||
        trimmed.includes('ffuf') ||
        trimmed.includes('v1.') || trimmed.includes('v2.')) {
      continue;
    }

    // Try JSON format first (-json flag)
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        if (json.url) {
          const url = new URL(json.url);
          const status = json.status || json['status-code'];
          findings.push({
            subdomain: url.hostname.toLowerCase(),
            httpStatus: status,
            source: 'ffuf',
            status: status >= 200 && status < 400 ? 'active' : 
                    status >= 400 && status < 600 ? 'inactive' : 'unknown',
          });
        }
        continue;
      } catch (e) {
        // Not valid JSON or URL, continue to plain text parsing
      }
    }

    // Plain text format: FUZZ_VALUE [Status: 200, Size: 1234, ...]
    // OR: subdomain.example.com [Status: 200, Size: 1234, ...]
    const statusMatch = trimmed.match(/^([^\s\[]+)\s+\[Status:\s*(\d+)/i);
    if (statusMatch) {
      let subdomain = statusMatch[1].toLowerCase();
      const status = parseInt(statusMatch[2]);
      
      // If it's just the FUZZ value (no dots), reconstruct full subdomain
      // This happens when ffuf is used with -u https://FUZZ.example.com
      if (!subdomain.includes('.')) {
        // Reconstruct: FUZZ_VALUE -> FUZZ_VALUE.domain
        subdomain = `${subdomain}.${domain}`;
      }
      
      if (subdomain.includes('.') && subdomain.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
        findings.push({
          subdomain,
          httpStatus: status,
          source: 'ffuf',
          status: status >= 200 && status < 400 ? 'active' : 
                  status >= 400 && status < 600 ? 'inactive' : 'unknown',
        });
      }
      continue;
    }

    // Simple URL format: https://subdomain.example.com
    if (trimmed.startsWith('http')) {
      try {
        const url = new URL(trimmed.split(/\s+/)[0]);
        if (url.hostname.includes('.')) {
          findings.push({
            subdomain: url.hostname.toLowerCase(),
            source: 'ffuf',
            status: 'active',
          });
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }

  return findings;
}

/**
 * Main parser function - detects tool and parses accordingly
 * 
 * Edge cases handled:
 * - Empty output
 * - Tool not found errors
 * - Permission denied errors
 * - Network errors
 * - Malformed output
 * - Mixed output formats
 * - Invalid domain formats
 * - Duplicate entries across tools
 */
export function parseSubdomainOutput(tool: string, output: string, domain: string): SubdomainResult {
  let findings: SubdomainFinding[] = [];

  // Validate inputs
  if (!output || output.trim().length === 0) {
    console.warn('[subdomain-parser] Empty output received');
    return {
      domain,
      tool,
      subdomains: [],
      summary: {
        total: 0,
        withIP: 0,
        withPorts: 0,
        active: 0,
        sources: [],
      },
      metadata: {
        scanTime: new Date().toISOString(),
        sources: [],
      },
    };
  }

  // Check for common error patterns (comprehensive list from documentation)
  const outputLower = output.toLowerCase();
  const errorPatterns = [
    'command not found',
    'not found, but can be installed',
    'permission denied',
    'access denied',
    'connection refused',
    'connection timed out',
    'failed to resolve',
    'could not resolve',
    'no such host',
    'network is unreachable',
    'timeout',
    'timed out',
    'unable to connect',
    'connection reset',
    'no route to host',
    'name resolution failed',
    'temporary failure',
    'service unavailable',
  ];

  const detectedError = errorPatterns.find(pattern => outputLower.includes(pattern));
  if (detectedError) {
    // Error text is diagnostic context, not proof that the entire stream is
    // unusable. Tools often print a DNS/API warning after already emitting
    // valid subdomains, so continue parsing and preserve those findings.
    console.error(`[subdomain-parser] Error detected in output: ${detectedError}; preserving partial findings`);
  }

  // Detect tool and parse
  const toolLower = tool.toLowerCase();
  
  try {
    if (toolLower.includes('subfinder')) {
      findings = parseSubfinder(output);
    } else if (toolLower.includes('amass')) {
      findings = parseAmass(output);
    } else if (toolLower.includes('assetfinder')) {
      findings = parseAssetfinder(output);
    } else if (toolLower.includes('sublist3r')) {
      findings = parseSublist3r(output);
    } else if (toolLower.includes('ffuf')) {
      findings = parseFfuf(output, domain);
    } else {
      // Generic parser - extract domain-like strings with validation
      // Use shared ANSI cleaner for comprehensive cleaning
      const cleanOutput = cleanANSI(output);
      const lines = cleanOutput.split('\n');
      for (const line of lines) {
        if (findings.length >= MAX_SUBDOMAIN_FINDINGS) break;
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip common non-subdomain lines
        if (trimmed.startsWith('[') || 
            trimmed.startsWith('#') ||
            trimmed.startsWith('//') ||
            trimmed.includes('Total') ||
            trimmed.includes('Found') ||
            trimmed.includes('Enumerating')) {
          continue;
        }

        // Extract first word and validate as domain
        const firstWord = trimmed.split(/\s+/)[0];
        if (firstWord && 
            firstWord.includes('.') &&
            firstWord.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
          findings.push({
            subdomain: firstWord.toLowerCase(),
            source: tool,
            status: 'unknown',
          });
        }
      }
    }
  } catch (error) {
    console.error(`[subdomain-parser] Parser error for ${tool}:`, error);
    // Keep any findings produced before a malformed line/parser branch. The
    // terminal still contains the exact error for the user to inspect.
  }

  // Filter out invalid subdomains and ensure they contain the target domain
  const targetDomain = normalizeDomain(domain);
  const validFindings = findings.filter(finding => {
    const subdomain = normalizeDomain(finding.subdomain);
    // Only accept the requested DNS scope. A loose `includes()` check lets
    // `example.com.attacker.test` and `notexample.com` leak into results.
    return isValidHostname(subdomain) && belongsToTarget(subdomain, targetDomain);
  });

  // Remove duplicates and merge data intelligently
  const uniqueFindings = new Map<string, SubdomainFinding>();
  for (const finding of validFindings) {
    const normalizedSubdomain = normalizeDomain(finding.subdomain);
    const normalizedFinding = { ...finding, subdomain: normalizedSubdomain };
    const existing = uniqueFindings.get(normalizedSubdomain);
    if (!existing) {
      uniqueFindings.set(normalizedSubdomain, normalizedFinding);
    } else {
      // Merge data from multiple sources, preferring more complete data
      uniqueFindings.set(normalizedSubdomain, {
        ...existing,
        ip: normalizedFinding.ip || existing.ip,
        ports: normalizedFinding.ports || existing.ports,
        httpStatus: normalizedFinding.httpStatus || existing.httpStatus,
        title: normalizedFinding.title || existing.title,
        technologies: normalizedFinding.technologies || existing.technologies,
        status: normalizedFinding.status === 'active' || existing.status === 'active' ? 'active' : 
                normalizedFinding.status === 'inactive' || existing.status === 'inactive' ? 'inactive' : 'unknown',
        source: existing.source && existing.source !== normalizedFinding.source ? 
                `${existing.source}, ${normalizedFinding.source}` : (normalizedFinding.source || existing.source),
      });
    }
  }

  const finalFindings = Array.from(uniqueFindings.values()).slice(0, MAX_SUBDOMAIN_FINDINGS);

  // Calculate summary
  const summary = {
    total: finalFindings.length,
    withIP: finalFindings.filter(f => f.ip).length,
    withPorts: finalFindings.filter(f => f.ports && f.ports.length > 0).length,
    active: finalFindings.filter(f => f.status === 'active').length,
    sources: Array.from(new Set(finalFindings.map(f => f.source).filter(Boolean))) as string[],
  };

  return {
    domain: targetDomain,
    tool,
    subdomains: finalFindings,
    summary,
    metadata: {
      scanTime: new Date().toISOString(),
      sources: summary.sources,
    },
  };
}

/**
 * Merge results from multiple tools
 */
export function mergeSubdomainResults(results: SubdomainResult[]): SubdomainResult {
  const allFindings = new Map<string, SubdomainFinding>();

  for (const result of results) {
    for (const finding of result.subdomains) {
      const existing = allFindings.get(finding.subdomain);
      if (!existing) {
        allFindings.set(finding.subdomain, {
          ...finding,
          source: result.tool,
        });
      } else {
        // Merge data from multiple sources
        allFindings.set(finding.subdomain, {
          ...existing,
          ip: finding.ip || existing.ip,
          ports: finding.ports || existing.ports,
          httpStatus: finding.httpStatus || existing.httpStatus,
          title: finding.title || existing.title,
          technologies: finding.technologies || existing.technologies,
          status: finding.status === 'active' || existing.status === 'active' ? 'active' : existing.status,
          source: existing.source ? `${existing.source}, ${result.tool}` : result.tool,
        });
      }
    }
  }

  const finalFindings = Array.from(allFindings.values()).slice(0, MAX_SUBDOMAIN_FINDINGS);
  const domain = results[0]?.domain || '';

  return {
    domain,
    tool: 'merged',
    subdomains: finalFindings,
    summary: {
      total: finalFindings.length,
      withIP: finalFindings.filter(f => f.ip).length,
      withPorts: finalFindings.filter(f => f.ports && f.ports.length > 0).length,
      active: finalFindings.filter(f => f.status === 'active').length,
      sources: Array.from(new Set(finalFindings.map(f => f.source).filter(Boolean))) as string[],
    },
    metadata: {
      sources: results.map(r => r.tool),
    },
  };
}
