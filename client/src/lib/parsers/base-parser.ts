/**
 * Base Parser - Shared utilities for all pentesting tool parsers
 * Eliminates duplication across nmap, nikto, nuclei, etc.
 */

import { cleanANSI as cleanAnsiText, cleanText as cleanPlainText } from '../utils/ansi-cleaner';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';

export interface BaseFinding {
  id: string;
  severity: Severity;
  description: string;
}

export interface ParseResult<T extends BaseFinding> {
  findings: T[];
  summary: SeveritySummary;
}

export interface SeveritySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unknown?: number;
  total: number;
}

/**
 * Abstract base class for all parsers
 */
export abstract class BaseParser<T extends BaseFinding> {
  /**
   * Parse tool output into structured findings
   */
  abstract parse(output: string): ParseResult<T>;

  /**
   * Classify severity based on keywords in description
   */
  protected classifySeverity(description: string, context?: string): Severity {
    const text = `${description} ${context || ''}`.toLowerCase();

    // Critical indicators
    if (this.matchesAny(text, [
      'remote code execution', 'rce', 'sql injection', 'command injection',
      'arbitrary code', 'shell upload', 'unrestricted file upload'
    ])) {
      return 'critical';
    }

    // High severity
    if (this.matchesAny(text, [
      'xss', 'cross-site scripting', 'authentication bypass', 'directory traversal',
      'file inclusion', 'arbitrary file', 'privilege escalation', 'csrf',
      'deserialization', 'xxe', 'ssrf'
    ])) {
      return 'high';
    }

    // Medium severity
    if (this.matchesAny(text, [
      'disclosure', 'exposed', 'misconfiguration', 'outdated', 'vulnerable',
      'weak', 'insecure', 'unencrypted', 'plaintext'
    ])) {
      return 'medium';
    }

    // Low severity
    if (this.matchesAny(text, [
      'header', 'cookie', 'ssl', 'tls', 'certificate', 'banner',
      'version', 'fingerprint'
    ])) {
      return 'low';
    }

    return 'info';
  }

  /**
   * Check if text contains any of the keywords
   */
  protected matchesAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword));
  }

  /**
   * Extract CVE identifier from text
   */
  protected extractCVE(text: string): string | undefined {
    const match = text.match(/CVE-\d{4}-\d{4,7}/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  /**
   * Extract CWE identifier from text
   */
  protected extractCWE(text: string): string | undefined {
    const match = text.match(/CWE-\d+/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  /**
   * Extract OSVDB identifier from text
   */
  protected extractOSVDB(text: string): string | undefined {
    const match = text.match(/OSVDB-\d+/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  /**
   * Parse JSON safely with error handling
   */
  protected parseJSON<R = unknown>(text: string): R | null {
    try {
      return JSON.parse(text) as R;
    } catch {
      return null;
    }
  }

  /**
   * Split output into lines and trim
   */
  protected getLines(output: string): string[] {
    return output.split('\n').map(line => line.trim()).filter(Boolean);
  }

  /**
   * Calculate severity summary from findings
   */
  protected calculateSummary(findings: T[]): SeveritySummary {
    const summary: SeveritySummary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      unknown: 0,
      total: findings.length
    };

    for (const finding of findings) {
      const severity = finding.severity;
      if (severity in summary) {
        summary[severity as keyof SeveritySummary] = 
          (summary[severity as keyof SeveritySummary] as number) + 1;
      }
    }

    return summary;
  }

  /**
   * Generate unique ID for finding
   */
  protected generateId(prefix: string, index: number): string {
    return `${prefix}-${index}-${Date.now()}`;
  }

  /**
   * Extract target/host from common patterns
   */
  protected extractTarget(line: string): string | undefined {
    const patterns = [
      /Target (?:IP|Hostname|Host):\s*(.+?)(?:\s|$)/i,
      /Testing:\s*(.+?)(?:\s|$)/i,
      /Scanning:\s*(.+?)(?:\s|$)/i,
      /(?:on|at)\s+(https?:\/\/[^\s]+)/i,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }

    return undefined;
  }

  /**
   * Remove ANSI escape codes and control characters through the shared
   * sanitizer. Keep the protected method for parser subclasses that already
   * use the BaseParser API.
   */
  protected cleanANSI(text: string): string {
    return cleanAnsiText(text);
  }

  /**
   * Clean and normalize whitespace through the shared sanitizer.
   */
  protected cleanText(text: string): string {
    return cleanPlainText(text);
  }

  /**
   * Validate that output is not empty
   */
  protected validateOutput(output: string): void {
    if (!output || output.trim().length === 0) {
      throw new Error('Parser received empty output');
    }
  }
}

/**
 * Utility functions for parser consumers
 */
export class ParserUtils {
  /**
   * Merge multiple parse results
   */
  static mergeResults<T extends BaseFinding>(
    results: ParseResult<T>[]
  ): ParseResult<T> {
    const allFindings = results.flatMap(r => r.findings);
    
    return {
      findings: allFindings,
      summary: {
        critical: results.reduce((sum, r) => sum + r.summary.critical, 0),
        high: results.reduce((sum, r) => sum + r.summary.high, 0),
        medium: results.reduce((sum, r) => sum + r.summary.medium, 0),
        low: results.reduce((sum, r) => sum + r.summary.low, 0),
        info: results.reduce((sum, r) => sum + r.summary.info, 0),
        unknown: results.reduce((sum, r) => sum + (r.summary.unknown || 0), 0),
        total: allFindings.length
      }
    };
  }

  /**
   * Filter findings by severity
   */
  static filterBySeverity<T extends BaseFinding>(
    findings: T[],
    severities: Severity[]
  ): T[] {
    return findings.filter(f => severities.includes(f.severity));
  }

  /**
   * Sort findings by severity (critical first)
   */
  static sortBySeverity<T extends BaseFinding>(findings: T[]): T[] {
    const severityOrder: Record<Severity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
      unknown: 5
    };

    return [...findings].sort((a, b) => 
      severityOrder[a.severity] - severityOrder[b.severity]
    );
  }
}
