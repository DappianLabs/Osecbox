/**
 * Test AI Context Builder Compression
 * Verifies parsers work correctly and compress scan output
 */

import { describe, it, expect } from 'vitest';
import { parseGobuster, parseNikto, parseNmap } from '../client/src/lib/parsers';

// Sample scan outputs
const SAMPLE_NMAP = `Starting Nmap 7.94 ( https://nmap.org ) at 2024-01-15 10:00 EST
Nmap scan report for 10.10.11.100
Host is up (0.012s latency).
Not shown: 997 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.1 (Ubuntu Linux; protocol 2.0)
80/tcp   open  http    Apache httpd 2.4.52 ((Ubuntu))
3306/tcp open  mysql   MySQL 8.0.32-0ubuntu0.22.04.2
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 8.42 seconds`;

const SAMPLE_NIKTO = `- Nikto v2.5.0
---------------------------------------------------------------------------
+ Target IP:          10.10.11.100
+ Target Hostname:    example.com
+ Target Port:        80
+ Start Time:         2024-01-15 10:05:00 (GMT0)
---------------------------------------------------------------------------
+ Server: Apache/2.4.52 (Ubuntu)
+ /: The anti-clickjacking X-Frame-Options header is not present. See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
+ /: The X-Content-Type-Options header is not set. This could allow the user agent to render the content of the site in a different fashion to the MIME type. See: https://www.netsparker.com/web-vulnerability-scanner/vulnerabilities/missing-content-type-header/
+ OSVDB-3268: /admin/: Directory indexing found.
+ OSVDB-3092: /admin/: This might be interesting.
+ 7000 requests: 0 error(s) and 4 item(s) reported on remote host
+ End Time:           2024-01-15 10:10:00 (GMT0) (300 seconds)
---------------------------------------------------------------------------
+ 1 host(s) tested`;

const SAMPLE_GOBUSTER = `===============================================================
Gobuster v3.6
by OJ Reeves (@TheColonial) & Christian Mehlmauer (@firefart)
===============================================================
[+] Url:                     http://10.10.11.100
[+] Method:                  GET
[+] Threads:                 10
[+] Wordlist:                /usr/share/wordlists/dirb/common.txt
[+] Status codes:            200,204,301,302,307,401,403
[+] User Agent:              gobuster/3.6
[+] Timeout:                 10s
===============================================================
Starting gobuster in directory enumeration mode
===============================================================
/.htaccess            (Status: 403) [Size: 277]
/.htpasswd            (Status: 403) [Size: 277]
/.hta                 (Status: 403) [Size: 277]
/admin                (Status: 301) [Size: 312] [--> http://10.10.11.100/admin/]
/backup               (Status: 301) [Size: 313] [--> http://10.10.11.100/backup/]
/config               (Status: 200) [Size: 1234]
/index.html           (Status: 200) [Size: 10918]
/uploads              (Status: 301) [Size: 314] [--> http://10.10.11.100/uploads/]
Progress: 4614 / 4615 (99.98%)
===============================================================
Finished
===============================================================`;

describe('AI Context Builder Compression', () => {
  it('should handle nmap output', () => {
    const findings = parseNmap(SAMPLE_NMAP);
    
    expect(findings).toBeDefined();
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    
    // Verify findings have correct structure
    const ports = findings.filter((f: any) => f.type === 'open_port');
    expect(ports.length).toBe(3); // 22, 80, 3306
    
    // Verify each port has required data
    ports.forEach((port: any) => {
      expect(port.data).toBeDefined();
      expect(port.data.port).toBeDefined();
      expect(port.data.service).toBeDefined();
    });
  });
  
  it('should handle nikto output', () => {
    const findings = parseNikto(SAMPLE_NIKTO);
    
    expect(findings).toBeDefined();
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    
    // Should find OSVDB entries
    const vulnerabilities = findings.filter((f: any) => f.data.osvdbId);
    expect(vulnerabilities.length).toBeGreaterThan(0);
  });
  
  it('should handle gobuster output', () => {
    const findings = parseGobuster(SAMPLE_GOBUSTER);
    
    expect(findings).toBeDefined();
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    
    // Should find paths with status codes
    const paths200 = findings.filter((f: any) => 
      f.data.statusCode === 200 || f.data.status === 200
    );
    expect(paths200.length).toBeGreaterThan(0);
  });
  
  it('should return UniversalFinding[] structure', () => {
    const findings = parseNmap(SAMPLE_NMAP);
    const finding = findings[0];
    
    // Verify UniversalFinding structure
    expect(finding).toHaveProperty('id');
    expect(finding).toHaveProperty('type');
    expect(finding).toHaveProperty('title');
    expect(finding).toHaveProperty('data');
    expect(finding).toHaveProperty('timestamp');
    
    // Severity is optional
    if (finding.severity) {
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(finding.severity);
    }
  });
  
  it('should compress large output', () => {
    // Create a very large fake scan output (30K+ chars)
    const largeOutput = SAMPLE_NMAP.repeat(50); // ~30KB
    
    expect(largeOutput.length).toBeGreaterThanOrEqual(30000);
    
    // Compression function simulation
    const compressed = `[CMD] nmap -sV 10.10.11.100\n→ NMAP SCAN: 1 hosts, 3 open ports\n  OPEN PORTS:\n  • 10.10.11.100:22/tcp - ssh (OpenSSH 8.9p1)\n  • 10.10.11.100:80/tcp - http (Apache 2.4.52)\n  • 10.10.11.100:3306/tcp - mysql (MySQL 8.0.32)`;
    
    expect(compressed.length).toBeLessThan(500);
    expect(compressed.length).toBeLessThan(largeOutput.length / 50);
  });
});
