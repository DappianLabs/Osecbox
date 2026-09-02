/**
 * SSL/TLS Scanner Parsers
 * Handles: sslscan, sslyze, testssl
 */

import type { UniversalFinding } from '../universal-parser';

export function parseSSLScan(output: string): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const lines = output.split('\n');
  const MAX_FINDINGS = 10000;
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    
    // Accepted  TLSv1.2  256 bits  ECDHE-RSA-AES256-GCM-SHA384
    if (trimmed.startsWith('Accepted') || trimmed.startsWith('Preferred')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        const protocol = parts[1] || 'unknown';
        const bits = parts[2] || '0';
        const cipher = parts[parts.length - 1] || 'unknown';
        
        // GUI enhancement: Better severity classification
        let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info';
        if (protocol.includes('SSLv2') || protocol.includes('SSLv3')) severity = 'critical';
        else if (protocol.includes('1.0') || protocol.includes('1.1')) severity = 'medium';
        else if (parseInt(bits) < 128) severity = 'medium';
        
        findings.push({
          id: `sslscan-${findings.length}`,
          type: 'ssl_cipher',
          severity,
          title: `${protocol} - ${cipher}`,
          description: `${parts[0]} cipher with ${bits} bits`,
          data: {
            status: parts[0],
            protocol,
            bits,
            cipher,
            // GUI enhancement: Add security rating
            rating: severity === 'info' ? 'secure' : severity === 'medium' ? 'weak' : 'insecure',
          },
          timestamp: Date.now(),
        });
      }
    }
    
    // Vulnerabilities
    if (trimmed.includes('vulnerable') || trimmed.includes('VULNERABLE')) {
      findings.push({
        id: `sslscan-${findings.length}`,
        type: 'vulnerability',
        severity: 'high',
        title: trimmed.substring(0, 100),
        description: 'SSL/TLS vulnerability detected',
        data: { raw: trimmed },
        timestamp: Date.now(),
      });
    }
  }
  
  return findings;
}
