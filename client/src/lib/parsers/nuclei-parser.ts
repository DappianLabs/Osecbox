/**
 * Nuclei Parser - SIMPLE VERSION THAT WORKS
 */

import { BaseParser, type Severity, type ParseResult } from './base-parser';
import { cleanANSI } from '@/lib/utils/ansi-cleaner';

export interface NucleiFinding {
  id: string;
  severity: Severity;
  templateId: string;
  name: string;
  description: string;  // Required by BaseFinding
  url: string;
  matchedAt?: string;
  extractedResults?: string[];
  cve?: string;
  cwe?: string;
  cvss?: number;
  tags?: string[];
  reference?: string[];
}

export interface NucleiResult extends ParseResult<NucleiFinding> {
  affectedUrls: string[];
  cves: string[];
  templates: string[];
  scanCompleted?: boolean;
}

class NucleiParser extends BaseParser<NucleiFinding> {
  parse(output: string): NucleiResult {
    // Preserve the managed completion marker before ANSI cleanup removes OSC
    // control sequences. This lets an empty-but-successful scan render as a
    // completed neutral result instead of looking like it never ran.
    const rawOutput = String(output || '');
    let scanCompleted = /\x1b\]9;osecbox-command-exit;\d+\x07/.test(rawOutput);
    const cleanOutput = cleanANSI(rawOutput);
    const lines = cleanOutput.split('\n');
    
    const findings: NucleiFinding[] = [];
    const affectedUrls = new Set<string>();
    const cves = new Set<string>();
    const templates = new Set<string>();
    const MAX_FINDINGS = 10_000;

    const addFinding = (finding: NucleiFinding): boolean => {
      if (findings.length >= MAX_FINDINGS) return false;
      findings.push(finding);
      if (finding.url) affectedUrls.add(finding.url);
      templates.add(finding.templateId);
      if (finding.cve) cves.add(finding.cve);
      return true;
    };

    const addJsonRecord = (record: unknown): boolean => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return false;

      const item = record as Record<string, any>;
      const info = item.info && typeof item.info === 'object' ? item.info : {};
      const templateId = String(item['template-id'] || item.templateId || 'nuclei-finding');
      const url = String(item['matched-at'] || item.matchedAt || item.host || item.url || '').trim();
      if (!url) return false;

      const severity = this.normalizeSeverity(String(info.severity || item.severity || 'unknown'));
      const classification = info.classification && typeof info.classification === 'object'
        ? info.classification
        : {};
      const extracted = item['extracted-results'] ?? item.extractedResults;
      const extractedResults = Array.isArray(extracted)
        ? extracted.map(value => String(value))
        : extracted === undefined || extracted === null
          ? undefined
          : [String(extracted)];
      const references = Array.isArray(info.reference)
        ? info.reference.map((value: unknown) => String(value))
        : typeof info.reference === 'string'
          ? [info.reference]
          : undefined;
      const cvssValue = Number(classification['cvss-score'] ?? info['cvss-score'] ?? item.cvss);

      return addFinding({
        id: `nuclei-json-${findings.length}`,
        severity,
        templateId,
        name: String(info.name || templateId),
        description: typeof info.description === 'string'
          ? info.description
          : String(info.name || templateId),
        url,
        matchedAt: url,
        extractedResults,
        cve: String(classification['cve-id'] || item.cve || '').trim() || undefined,
        cwe: String(classification['cwe-id'] || item.cwe || '').trim() || undefined,
        cvss: Number.isFinite(cvssValue) ? cvssValue : undefined,
        tags: Array.isArray(info.tags) ? info.tags.map((value: unknown) => String(value)) : undefined,
        reference: references,
      });
    };

    // Human-readable completion banners supplement the managed exit marker.
    let truncated = false;
    for (const line of lines) {
      if (findings.length >= MAX_FINDINGS) {
        truncated = true;
        break;
      }

      const trimmedJson = line.trim();
      if (trimmedJson.startsWith('{') || trimmedJson.startsWith('[')) {
        try {
          const payload = JSON.parse(trimmedJson);
          const records = Array.isArray(payload) ? payload : [payload];
          const before = findings.length;
          records.forEach(record => addJsonRecord(record));
          if (findings.length > before || records.some(record => record && typeof record === 'object')) {
            continue;
          }
        } catch {
          // Fall through to the human-readable parser below.
        }
      }

      // Detect scan completion
      if (line.includes('Requests [total:') || 
          line.includes('Scan completed') ||
          line.includes('[INF] Scan completed') ||
          line.includes('Templates executed:')) {
        scanCompleted = true;
      }
      
      // Skip empty lines and system messages
      if (!line.trim()) continue;
      if (line.startsWith('[WRN]') || line.startsWith('[ERR]')) continue;
      
      // FIX: Skip ALL informational/status messages
      if (line.includes('Templates loaded') || 
          line.includes('Executing') ||
          line.includes('Using Interactsh') ||
          line.includes('Current nuclei') ||
          line.includes('nuclei-templates version') ||
          line.includes('New templates added') ||
          line.includes('Targets loaded') ||
          line.includes('Templates clustered') ||
          line.includes('Scan completed') ||
          line.includes('matches found') ||
          line.includes('Requests [total:') ||
          line.includes('templates with runtime error') ||
          line.includes('To view results on cloud') ||
          line.includes('host(s) tested') ||
          line.includes('End Time:') ||
          line.includes('Start Time:') ||
          line.includes('signed templates from') ||
          line.includes('update check') ||
          line.includes('latest release')) {
        continue;
      }

      const finding = this.parseLine(line, findings.length);
      if (finding) {
        if (!addFinding(finding)) {
          truncated = true;
          break;
        }
      }
    }

    if (truncated && findings.length < MAX_FINDINGS) {
      addFinding({
        id: 'nuclei-parser-limit',
        severity: 'medium',
        templateId: 'parser-limit',
        name: 'Parser output limit reached',
        description: `Nuclei findings were capped at ${MAX_FINDINGS}. The complete transcript remains available in the terminal.`,
        url: '',
      });
    }

    return {
      findings,
      scanCompleted,
      summary: {
        total: findings.length,
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
        info: findings.filter(f => f.severity === 'info').length,
        unknown: findings.filter(f => f.severity === 'unknown').length,
      },
      affectedUrls: Array.from(affectedUrls),
      cves: Array.from(cves),
      templates: Array.from(templates)
    };
  }

  private parseLine(line: string, index: number): NucleiFinding | null {
    // FIX: Don't parse [INF], [WRN], [ERR] lines - they're status messages
    if (line.startsWith('[INF]') || line.startsWith('[WRN]') || line.startsWith('[ERR]')) {
      return null;
    }
    
    // Format: [template-id] [protocol] [severity] url [extracted-data]
    // Example: [tls-version] [ssl] [info] www.example.com:443 ["tls12"]
    // Example: [ssl-dns-names] [ssl] [info] www.example.com:443 ["example.com", "www.example.com"]
    // Example: [CVE-2021-26855] [http] [critical] http://example.com/path
    const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[(\w+)\]\s+([^\[]+)(?:\s+(\[.+\]))?$/);
    if (match) {
      const [, templateId, protocol, severity, url, extractedData] = match;
      const cve = templateId.match(/CVE-\d{4}-\d+/)?.[0];
      
      // Parse extracted data if present
      let extractedResults: string[] | undefined;
      if (extractedData) {
        try {
          // Handle JSON arrays
          extractedResults = JSON.parse(extractedData);
          // Ensure it's an array
          if (!Array.isArray(extractedResults)) {
            extractedResults = [String(extractedResults)];
          }
        } catch (e) {
          // If JSON parse fails, try to extract content between brackets
          const content = extractedData.replace(/^\[|\]$/g, '').trim();
          if (content) {
            extractedResults = [content];
          }
        }
      }
      
      return {
        id: `nuclei-${index}`,
        severity: this.normalizeSeverity(severity),
        templateId,
        name: this.formatName(templateId),
        description: this.formatName(templateId),  // Use formatted name as description
        url: url.trim(),
        extractedResults,
        cve
      };
    }

    // Format: [severity] [template-id] description on url
    const match2 = line.match(/^\[(\w+)\]\s+\[([^\]]+)\]\s+(.+?)\s+(?:on|at)\s+(.+)$/);
    if (match2) {
      const [, severity, templateId, description, url] = match2;
      const cve = templateId.match(/CVE-\d{4}-\d+/)?.[0];
      
      return {
        id: `nuclei-${index}`,
        severity: this.normalizeSeverity(severity),
        templateId,
        name: description.trim(),
        description: description.trim(),
        url: url.trim(),
        cve
      };
    }

    // Format: [severity] [template-id] url
    const match3 = line.match(/^\[(\w+)\]\s+\[([^\]]+)\]\s+(.+)$/);
    if (match3) {
      const [, severity, templateId, url] = match3;
      const cve = templateId.match(/CVE-\d{4}-\d+/)?.[0];
      
      return {
        id: `nuclei-${index}`,
        severity: this.normalizeSeverity(severity),
        templateId,
        name: this.formatName(templateId),
        description: this.formatName(templateId),
        url: url.trim(),
        cve
      };
    }

    return null;
  }

  private normalizeSeverity(severity: string): Severity {
    const normalized = severity.toLowerCase();
    const valid: Severity[] = ['critical', 'high', 'medium', 'low', 'info', 'unknown'];
    return valid.includes(normalized as Severity) ? (normalized as Severity) : 'unknown';
  }

  private formatName(templateId: string): string {
    return templateId
      .replace(/-/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }
}

const parser = new NucleiParser();

export function parseNucleiOutput(output: string): NucleiResult {
  return parser.parse(output);
}
