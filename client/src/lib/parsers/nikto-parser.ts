/**
 * Nikto Parser - SIMPLE VERSION THAT WORKS
 */

import { BaseParser, type Severity, type ParseResult } from './base-parser';
import { cleanANSI } from '@/lib/utils/ansi-cleaner';

export interface NiktoFinding {
  id: string;
  severity: Severity;
  category: string;
  path: string;
  description: string;
  osvdbId?: string;
  cveId?: string;
}

export interface NiktoResult extends ParseResult<NiktoFinding> {
  target: string;
  server?: string;
  scanDuration?: string;
  scanCompleted?: boolean;
}

class NiktoParser extends BaseParser<NiktoFinding> {
  parse(output: string): NiktoResult {
    // Preserve the managed completion marker before ANSI cleanup removes OSC
    // control sequences.
    const rawOutput = String(output || '');
    const cleanOutput = cleanANSI(rawOutput);
    const lines = cleanOutput.split('\n');
    const findings: NiktoFinding[] = [];
    const MAX_FINDINGS = 10_000;
    let target = '';
    let server = '';
    let scanDuration = '';

    let scanCompleted = /\x1b\]9;osecbox-command-exit;\d+\x07/.test(rawOutput);

    for (const line of lines) {
      // Detect scan completion
      if (line.includes('End Time:') || line.includes('host(s) tested')) {
        scanCompleted = true;
      }
      
      // Extract target
      if (line.includes('Target Hostname:')) {
        target = line.split(':')[1]?.trim() || '';
        continue;
      }

      // Extract server
      if (line.startsWith('+ Server:')) {
        server = line.replace('+ Server:', '').trim();
        continue;
      }

      // Extract duration
      if (line.includes('End Time:')) {
        const match = line.match(/\((\d+\s+seconds)\)/);
        if (match) scanDuration = match[1];
        continue;
      }

      // Parse findings - ANY line starting with + that's not metadata
      if (line.startsWith('+ ') && line.length > 10) {
        // Skip metadata lines
        if (line.startsWith('+ Server:') ||
            line.startsWith('+ Start Time:') ||
            line.startsWith('+ End Time:') ||
            line.startsWith('+ Target ') ||
            line.startsWith('+ SSL Info:') ||
            line.startsWith('+ No CGI Directories found') ||
            line.includes('host(s) tested') ||
            line.includes('requests:') && line.includes('error(s)')) {
          continue;
        }

        const finding = this.parseFinding(line, findings.length);
        if (finding) {
          if (findings.length >= MAX_FINDINGS - 1) break;
          findings.push(finding);
        }
      }
    }

    if (findings.length >= MAX_FINDINGS - 1 && !findings.some(finding => finding.id === 'nikto-parser-limit')) {
      findings.push({
        id: 'nikto-parser-limit',
        severity: 'medium',
        category: 'Parser',
        path: '/',
        description: `Nikto findings were capped at ${MAX_FINDINGS - 1}. The complete transcript remains available in the terminal.`,
      });
    }

    return {
      target,
      server,
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
      scanDuration
    };
  }

  private parseFinding(line: string, index: number): NiktoFinding | null {
    const description = line.substring(2).trim();
    
    // Skip if description is too short (likely noise)
    if (description.length < 10) {
      return null;
    }
    
    // Extract OSVDB ID (format: OSVDB-XXXX:)
    let osvdbId: string | undefined;
    const osvdbMatch = description.match(/^(OSVDB-\d+):/);
    if (osvdbMatch) {
      osvdbId = osvdbMatch[1];
    }
    
    // Extract CVE (format: CVE-YYYY-XXXX)
    const cveMatch = description.match(/CVE-\d{4}-\d+/);
    const cveId = cveMatch ? cveMatch[0] : undefined;
    
    // Extract path (anything between colons or starting with /)
    let path = '/';
    // Try to find path after OSVDB/CVE prefix or standalone
    const pathMatch = description.match(/:\s*(\/[^\s:,]+)/) || 
                      description.match(/^(\/[^\s:,]+)/);
    if (pathMatch) {
      path = pathMatch[1];
    }
    
    return {
      id: `nikto-${index}`,
      severity: this.classifySeverity(description),
      category: this.categorize(description),
      path,
      description,
      osvdbId,
      cveId
    };
  }

  protected classifySeverity(description: string): Severity {
    const lower = description.toLowerCase();
    
    // Critical - Immediate exploitation possible
    if (lower.includes('remote code execution') || 
        lower.includes('rce') ||
        lower.includes('sql injection') ||
        lower.includes('command injection') ||
        lower.includes('arbitrary file upload') ||
        lower.includes('unrestricted file upload')) {
      return 'critical';
    }
    
    // High - Serious security issues
    if (lower.includes('shellshock') ||
        lower.includes('vulnerability') || 
        lower.includes('exploit') ||
        lower.includes('authentication bypass') ||
        lower.includes('directory traversal') ||
        lower.includes('path traversal') ||
        lower.includes('local file inclusion') ||
        lower.includes('lfi') ||
        lower.includes('remote file inclusion') ||
        lower.includes('rfi') ||
        lower.includes('xxe') ||
        lower.includes('xml external entity')) {
      return 'high';
    }
    
    // Medium - Significant security concerns
    if (lower.includes('xss') ||
        lower.includes('cross-site scripting') ||
        lower.includes('cross-site') ||
        lower.includes('csrf') ||
        lower.includes('cross-site request forgery') ||
        lower.includes('clickjacking') ||
        lower.includes('httponly') || 
        lower.includes('secure flag') ||
        lower.includes('security header') ||
        lower.includes('weak cipher') ||
        lower.includes('outdated') && lower.includes('version') ||
        lower.includes('default credentials') ||
        lower.includes('default password')) {
      return 'medium';
    }
    
    // Low - Minor issues or information disclosure
    if (lower.includes('header') && !lower.includes('security') || 
        lower.includes('cookie') && !lower.includes('httponly') ||
        lower.includes('banner') ||
        lower.includes('version disclosure') ||
        lower.includes('information disclosure') ||
        lower.includes('directory indexing') ||
        lower.includes('directory listing') ||
        lower.includes('robots.txt') ||
        lower.includes('uncommon header')) {
      return 'low';
    }
    
    // Info - Informational findings
    return 'info';
  }

  private categorize(description: string): string {
    const lower = description.toLowerCase();
    
    // Security Headers
    if (lower.includes('x-frame-options') || 
        lower.includes('x-xss-protection') ||
        lower.includes('x-content-type-options') ||
        lower.includes('content-security-policy') ||
        lower.includes('strict-transport-security') ||
        lower.includes('hsts') ||
        lower.includes('security header')) {
      return 'Security Headers';
    }
    
    // Cookie Security
    if (lower.includes('cookie') && (lower.includes('httponly') || lower.includes('secure flag'))) {
      return 'Cookie Security';
    }
    
    // SSL/TLS
    if (lower.includes('ssl') || 
        lower.includes('tls') || 
        lower.includes('certificate') ||
        lower.includes('cipher') ||
        lower.includes('https')) {
      return 'SSL/TLS';
    }
    
    // Directory/File Access
    if (lower.includes('directory indexing') || 
        lower.includes('directory listing') ||
        lower.includes('browsable') ||
        lower.includes('index of')) {
      return 'Directory Listing';
    }
    
    // Information Disclosure
    if (lower.includes('version') || 
        lower.includes('banner') || 
        lower.includes('disclosure') ||
        lower.includes('x-powered-by') ||
        lower.includes('server:') ||
        lower.includes('uncommon header')) {
      return 'Information Disclosure';
    }
    
    // Admin/Management Interfaces
    if (lower.includes('admin') || 
        lower.includes('login') || 
        lower.includes('panel') ||
        lower.includes('console') ||
        lower.includes('manager') ||
        lower.includes('phpmyadmin') ||
        lower.includes('cpanel')) {
      return 'Admin Interface';
    }
    
    // Backup/Sensitive Files
    if (lower.includes('backup') || 
        lower.includes('.bak') || 
        lower.includes('.old') ||
        lower.includes('.swp') ||
        lower.includes('.save') ||
        lower.includes('~') ||
        lower.includes('.git') ||
        lower.includes('.svn')) {
      return 'Backup Files';
    }
    
    // CGI/Scripts
    if (lower.includes('cgi') || 
        lower.includes('script') || 
        lower.includes('php') ||
        lower.includes('.pl') ||
        lower.includes('.py') ||
        lower.includes('.sh')) {
      return 'CGI/Scripts';
    }
    
    // Default/Test Files
    if (lower.includes('default') || 
        lower.includes('test') || 
        lower.includes('example') ||
        lower.includes('demo') ||
        lower.includes('sample')) {
      return 'Default Files';
    }
    
    // HTTP Methods
    if (lower.includes('http method') || 
        lower.includes('trace') || 
        lower.includes('options') ||
        lower.includes('put') ||
        lower.includes('delete')) {
      return 'HTTP Methods';
    }
    
    // Vulnerabilities
    if (lower.includes('shellshock') ||
        lower.includes('xss') ||
        lower.includes('sql injection') ||
        lower.includes('csrf') ||
        lower.includes('vulnerability') ||
        lower.includes('exploit')) {
      return 'Vulnerabilities';
    }
    
    // Robots.txt
    if (lower.includes('robots.txt')) {
      return 'Robots.txt';
    }
    
    // Miscellaneous
    return 'Other';
  }
}

const parser = new NiktoParser();

export function parseNiktoOutput(output: string): NiktoResult {
  return parser.parse(output);
}
