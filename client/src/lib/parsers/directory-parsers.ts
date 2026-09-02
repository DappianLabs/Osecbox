/**
 * Directory Buster Parsers
 * Handles: gobuster, dirbuster, ffuf, feroxbuster, dirb, dirsearch, wfuzz
 */

import type { UniversalFinding } from '../universal-parser';
import { cleanANSI } from '../utils/ansi-cleaner';

export function parseGobuster(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10000;
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Format: /admin (Status: 200) [Size: 1234] [--> redirect]
    const match = trimmed.match(/^(.+?)\s+\(Status:\s+(\d+)\)(?:\s+\[Size:\s+(\d+)\])?(?:\s+\[--> (.+)\])?$/);
    if (match) {
      const [, path, statusCode, size, redirect] = match;
      const code = parseInt(statusCode);
      
      let severity: any = 'info';
      if (code === 200 || code === 201) severity = 'info';
      else if (code === 301 || code === 302) severity = 'low';
      else if (code === 403) severity = 'medium';
      else if (code === 401) severity = 'medium';
      
      findings.push({
        id: `gobuster-${findings.length}`,
        type: 'path',
        severity,
        title: path,
        description: redirect ? `Redirects to ${redirect}` : undefined,
        data: {
          path,
          statusCode: code,
          size: size ? parseInt(size) : undefined,
          redirect: redirect || undefined,
        },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}

/**
 * Parse ffuf directory-mode output. ffuf is also used by the subdomain view,
 * so keep this parser scoped to directory findings; the subdomain view uses
 * its target-aware parser instead.
 */
export function parseFfuf(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const MAX_FINDINGS = 10000;
  const seen = new Set<string>();
  const normalizedOutput = cleanANSI(output);
  const lines = normalizedOutput.split('\n');
  const normalizePath = (value: string): string => {
    try {
      return new URL(value).pathname || '/';
    } catch {
      const path = value.startsWith('/') ? value : `/${value}`;
      return path.replace(/\/+/g, '/');
    }
  };

  const addJsonFinding = (value: unknown): void => {
    if (findings.length >= MAX_FINDINGS) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const record = value as Record<string, any>;
    const url = typeof record.url === 'string'
      ? record.url
      : typeof record.path === 'string'
        ? record.path
        : '';
    const statusCode = Number(record.status ?? record.statusCode ?? record['status-code']);
    if (!url || !Number.isInteger(statusCode)) return;

    const rawSize = record.length ?? record.size ?? record.contentLength;
    const size = Number(rawSize);
    const key = `${normalizePath(url)}|${statusCode}|${Number.isFinite(size) ? size : ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    findings.push({
      id: `ffuf-${findings.length}`,
      type: 'path',
      severity: statusCode === 401 || statusCode === 403
        ? 'medium'
        : statusCode >= 300 && statusCode < 400
          ? 'low'
          : 'info',
      title: url,
      data: {
        path: url,
        url,
        statusCode,
        size: Number.isFinite(size) ? size : undefined,
        words: record.words,
        lines: record.lines,
        redirect: record.redirectlocation || record.redirect || undefined,
      },
      timestamp: Date.now(),
    });
  };

  const addJsonPayload = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(addJsonFinding);
      return;
    }

    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, any>;
    if (Array.isArray(record.results)) {
      record.results.forEach(addJsonFinding);
      return;
    }

    addJsonFinding(record);
  };

  // ffuf's file JSON output is a single object with a `results` array, while
  // streaming mode emits one JSON result per line. Parse the complete payload
  // first so pretty-printed JSON is not mistaken for human-readable text.
  const trimmedOutput = normalizedOutput.trim();
  if (trimmedOutput.startsWith('{') || trimmedOutput.startsWith('[')) {
    try {
      addJsonPayload(JSON.parse(trimmedOutput));
      if (findings.length > 0) return findings;
    } catch {
      // Fall back to JSONL/human-readable parsing below.
    }
  }

  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('::') || trimmed.startsWith('___')) continue;

    // JSON mode: {"url":"https://target/admin","status":200,"length":123}
    if (trimmed.startsWith('{')) {
      try {
        addJsonPayload(JSON.parse(trimmed));
      } catch {
        // Continue with the human-readable parser.
      }
      continue;
    }

    // Human-readable mode: admin [Status: 200, Size: 1234, Words: 56, Lines: 12]
    const match = trimmed.match(/^(.+?)\s+\[Status:\s*(\d+),\s*Size:\s*(\d+)(?:,\s*Words:\s*(\d+))?(?:,\s*Lines:\s*(\d+))?/i);
    if (!match) continue;

    const [, path, rawStatus, rawSize, rawWords, rawLines] = match;
    const statusCode = Number(rawStatus);
    const size = Number(rawSize);
    const key = `${normalizePath(path)}|${statusCode}|${size}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      id: `ffuf-${findings.length}`,
      type: 'path',
      severity: statusCode === 401 || statusCode === 403 ? 'medium' : statusCode >= 300 && statusCode < 400 ? 'low' : 'info',
      title: path,
      data: {
        path,
        statusCode,
        size,
        words: rawWords ? Number(rawWords) : undefined,
        lines: rawLines ? Number(rawLines) : undefined,
      },
      timestamp: Date.now(),
    });
  }

  return findings;
}

export function parseWfuzz(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 10000;
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    
    // 000000001:   200        45 L     123 W    1234 Ch     "admin"
    const match = line.match(/(\d+):\s+(\d+)\s+(\d+)\s+L\s+(\d+)\s+W\s+(\d+)\s+Ch\s+"([^"]+)"/);
    if (match && match[2] && match[3] && match[4] && match[5] && match[6]) {
      const statusCode = parseInt(match[2]);
      const path = match[6];
      
      // GUI enhancement: Better severity classification
      let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info';
      if (statusCode === 200 || statusCode === 201) severity = 'info';
      else if (statusCode === 301 || statusCode === 302) severity = 'low';
      else if (statusCode === 401 || statusCode === 403) severity = 'medium';
      else if (statusCode >= 500) severity = 'low';
      
      // GUI enhancement: Detect interesting paths
      const isInteresting = 
        /admin|login|dashboard|config|backup|upload|api|debug/i.test(path);
      
      if (isInteresting && statusCode === 200) severity = 'medium';
      
      findings.push({
        id: `wfuzz-${findings.length}`,
        type: 'path',
        severity,
        title: path,
        description: `HTTP ${statusCode} - ${match[5]} chars`,
        data: {
          statusCode,
          lines: parseInt(match[3]),
          words: parseInt(match[4]),
          chars: parseInt(match[5]),
          path,
          isInteresting,
        },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}
