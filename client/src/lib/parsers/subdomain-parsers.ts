/**
 * Subdomain Enumeration Parsers
 * Handles: subfinder, amass, assetfinder, dnsenum
 */

import type { UniversalFinding } from '../universal-parser';
import { cleanANSI } from '@/lib/utils/ansi-cleaner';

/**
 * Validate domain/subdomain format
 * P1 FIX: Prevent invalid domains from being added
 */
function isValidDomain(domain: string): boolean {
  // Basic validation: alphanumeric, dots, hyphens only
  // Must have at least one dot, no consecutive dots
  // Each label max 63 chars, total max 253 chars
  if (!domain || domain.length > 253) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  
  const labels = domain.split('.');
  if (labels.length < 2) return false; // Must have at least domain.tld
  
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    if (!/^[a-zA-Z0-9-]+$/.test(label)) return false;
  }
  
  return true;
}

/**
 * Parse the line-oriented formats shared by the lightweight subdomain tools.
 * Sublist3r commonly prefixes discoveries with `[+]`, while assetfinder and
 * the default subfinder/amass modes emit a bare hostname. JSON output from
 * subfinder/amass is handled as a best-effort per-line object as well.
 */
function parseLineOrientedSubdomains(output: string, source: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10_000;
  const seen = new Set<string>();

  const addFinding = (candidate: unknown, data: Record<string, any> = {}) => {
    if (findings.length >= MAX_FINDINGS) return;
    if (typeof candidate !== 'string') return;
    let normalized = candidate.trim().toLowerCase().replace(/\.$/, '');
    if (normalized.startsWith('*.')) normalized = normalized.slice(2);

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        normalized = new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
      } catch {
        return;
      }
    }

    if (!isValidDomain(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    findings.push({
      id: `${source}-${findings.length}`,
      type: 'subdomain',
      title: normalized,
      data: { subdomain: normalized, ...data },
      timestamp: Date.now(),
    });
  };

  for (const rawLine of cleanANSI(output).split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('{')) {
      try {
        const json = JSON.parse(line);
        const candidate = json.host || json.subdomain || json.name || json.domain || json.url;
        const addresses = Array.isArray(json.addresses)
          ? json.addresses.map((entry: any) => entry?.ip).filter(Boolean)
          : undefined;
        addFinding(candidate, {
          source: json.source || json.sources || source,
          ...(addresses?.length ? { addresses } : {}),
        });
      } catch {
        // A malformed JSON line is not a hostname; continue safely.
      }
      continue;
    }

    // Sublist3r uses status prefixes for both discoveries and progress lines.
    line = line.replace(/^\[(?:\+|\*|!|i|-)\]\s*/i, '');
    if (!line || /^(?:total|enumerating|searching|starting|finished|error|warning)\b/i.test(line)) {
      continue;
    }

    const candidate = line.split(/\s+/)[0];
    addFinding(candidate);
  }

  return findings;
}

export function parseSubfinder(output: string): UniversalFinding[] {
  return parseLineOrientedSubdomains(output, 'subfinder');
}

export function parseAmass(output: string): UniversalFinding[] {
  return parseLineOrientedSubdomains(output, 'amass');
}

export function parseAssetfinder(output: string): UniversalFinding[] {
  return parseLineOrientedSubdomains(output, 'assetfinder');
}

export function parseSublist3r(output: string): UniversalFinding[] {
  return parseLineOrientedSubdomains(output, 'sublist3r');
}

export function parseDNSEnum(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10_000;
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Host records
    const hostMatch = trimmed.match(/^(\S+)\s+(\d+)\s+IN\s+A\s+([\d.]+)/);
    if (hostMatch) {
      findings.push({
        id: `dnsenum-${findings.length}`,
        type: 'dns_record',
        title: `${hostMatch[1]} → ${hostMatch[3]}`,
        data: {
          hostname: hostMatch[1],
          type: 'A',
          value: hostMatch[3],
        },
        timestamp: Date.now(),
      });
    }
    
    // MX records
    const mxMatch = trimmed.match(/^(\S+)\s+(\d+)\s+IN\s+MX\s+(\d+)\s+(\S+)/);
    if (mxMatch) {
      findings.push({
        id: `dnsenum-${findings.length}`,
        type: 'dns_record',
        title: `MX: ${mxMatch[4]} (priority ${mxMatch[3]})`,
        data: {
          hostname: mxMatch[1],
          type: 'MX',
          priority: parseInt(mxMatch[3]),
          value: mxMatch[4],
        },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}
