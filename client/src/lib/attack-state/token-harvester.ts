/**
 * Universal Token Harvester
 * Extracts meaningful entities from ANY terminal output using regex
 * 
 * Philosophy: Every pentest tool prints text. Extract everything.
 */

export interface HarvestedTokens {
  // Network
  ips: string[];
  ports: number[];
  urls: string[];
  domains: string[];
  
  // Filesystem
  paths: Array<{ path: string; access?: 'readable' | 'writable' | 'denied' | 'unknown'; context?: string }>;
  
  // Credentials
  credentials: Array<{ user?: string; pass?: string; token?: string; valid?: 'valid' | 'invalid' | 'unknown'; context?: string }>;
  
  // Infrastructure keywords
  keywords: string[];
  
  // Constraints (errors/blockers)
  constraints: string[];
  
  // Service states (NEW)
  services: Array<{ port: number; state: 'open' | 'closed' | 'filtered'; protocol?: string; service?: string }>;
}

/**
 * Harvest all tokens from command output
 */
export function harvestTokens(text: string): HarvestedTokens {
  return {
    ips: extractIPs(text),
    ports: extractPorts(text),
    urls: extractURLs(text),
    domains: extractDomains(text),
    paths: extractPaths(text),
    credentials: extractCredentials(text),
    keywords: extractKeywords(text),
    constraints: extractConstraints(text),
    services: extractServices(text)
  };
}

/**
 * Extract IPv4 addresses (comprehensive patterns for all tools)
 */
function extractIPs(text: string): string[] {
  const ips = new Set<string>();
  
  // Standard IP pattern
  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const matches = text.match(ipRegex) || [];
  
  for (const ip of matches) {
    const parts = ip.split('.');
    const isValid = parts.every(part => {
      const num = parseInt(part);
      return num >= 0 && num <= 255;
    });
    
    if (isValid) {
      // Filter out noise
      if (ip === '0.0.0.0') continue;
      if (ip === '127.0.0.1') continue;
      if (ip.startsWith('127.')) continue;
      if (ip === '255.255.255.255') continue;
      
      // Filter out version numbers (e.g., OpenSSH 8.2.1)
      if (parts.some(p => parseInt(p) < 10 && p.length === 1)) {
        // Likely a version number, skip unless it looks like a real IP
        const hasHighOctet = parts.some(p => parseInt(p) > 10);
        if (!hasHighOctet) continue;
      }
      
      ips.add(ip);
    }
  }
  
  return Array.from(ips).sort();
}

/**
 * Extract port numbers from ALL common pentest tool formats
 */
function extractPorts(text: string): number[] {
  const ports = new Set<number>();
  
  // Pattern 1: nmap style - 22/tcp, 80/tcp open, 443/tcp open ssh
  const nmapRegex = /(\d+)\/(tcp|udp)(?:\s+(?:open|closed|filtered))?/gi;
  let match;
  while ((match = nmapRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  // Pattern 2: masscan style - Discovered open port 22/tcp on 10.10.11.247
  const masscanRegex = /(?:open|closed|filtered)\s+port\s+(\d+)/gi;
  while ((match = masscanRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  // Pattern 3: netcat style - (UNKNOWN) [10.10.11.247] 22 (ssh) open
  const netcatRegex = /\]\s+(\d+)\s+\([^)]+\)\s+(?:open|closed)/gi;
  while ((match = netcatRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  // Pattern 4: URL style - :8080, :443, http://example.com:8000
  const urlPortRegex = /:(\d+)(?:\/|\\|\s|$)/g;
  while ((match = urlPortRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  // Pattern 5: Generic "port 443", "Port: 22", "PORT 80"
  const genericRegex = /\bport[:\s]+(\d+)/gi;
  while ((match = genericRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  // Pattern 6: Service on port - "ssh on port 22", "http running on 8080"
  const serviceRegex = /(?:on|port)\s+(\d+)/gi;
  while ((match = serviceRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  
  return Array.from(ports).sort((a, b) => a - b);
}

/**
 * Extract URLs
 */
function extractURLs(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return Array.from(new Set(matches));
}

/**
 * Extract domain names
 */
function extractDomains(text: string): string[] {
  const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
  const matches = text.match(domainRegex) || [];
  
  // Filter out common false positives
  const filtered = matches.filter(d => 
    !d.endsWith('.local') && 
    !d.endsWith('.test') &&
    d.includes('.')
  );
  
  return Array.from(new Set(filtered));
}

/**
 * Extract file paths with relevance filtering and per-file access detection
 */
function extractPaths(text: string): Array<{ path: string; access?: 'readable' | 'writable' | 'denied' | 'unknown'; context?: string }> {
  const pathsMap = new Map<string, { path: string; access?: 'readable' | 'writable' | 'denied' | 'unknown'; context?: string }>();
  
  // Absolute paths: /path/to/file
  const absoluteRegex = /(?:^|\s)(\/[^\s:*?"<>|]+)/gm;
  let match;
  while ((match = absoluteRegex.exec(text)) !== null) {
    const path = match[1];
    
    // Filter out system noise
    if (path.startsWith('/usr/lib')) continue;
    if (path.startsWith('/usr/share/man')) continue;
    if (path.startsWith('/usr/share/doc')) continue;
    if (path.startsWith('/lib/')) continue;
    if (path.startsWith('/proc/')) continue;
    if (path.startsWith('/sys/')) continue;
    if (path.startsWith('/dev/')) continue;
    if (path.match(/\.so(\.\d+)*$/)) continue; // Skip .so files
    
    // Keep interesting paths (IMPROVED: fuzzy matching for compound words)
    const interestingPatterns = [
      // Credentials (fuzzy matching)
      /cred/i, /pass/i, /pwd/i, /auth/i, /login/i,
      // Keys and secrets
      /key/i, /secret/i, /token/i, /api/i,
      // System files
      /shadow/i, /\.ssh/i, /\.git/i, /\.env/i,
      // Configs
      /config/i, /\.conf/i, /\.ini/i, /settings/i,
      // Backups and dumps
      /backup/i, /dump/i, /export/i, /archive/i,
      // Database
      /database/i, /\.db/i, /\.sql/i, /mysql/i, /postgres/i,
      // Admin and privileged
      /admin/i, /root/i, /sudo/i, /privilege/i,
      // Important/sensitive indicators
      /important/i, /imp\./i, /sensitive/i, /private/i, /confidential/i,
      // User data
      /user/i, /account/i, /profile/i,
      // Logs that might contain creds
      /auth\.log/i, /access\.log/i, /error\.log/i,
    ];
    
    // Directory-based scoring (always interesting)
    const interestingDirs = [
      '/home/', '/root/', '/var/www/', '/opt/', '/tmp/', '/etc/',
      '/.ssh/', '/.git/', '/backup/', '/config/'
    ];
    
    const hasInterestingPattern = interestingPatterns.some(pattern => pattern.test(path));
    const inInterestingDir = interestingDirs.some(dir => path.includes(dir));
    
    if (hasInterestingPattern || inInterestingDir) {
      
      // Get context around the path
      const startIdx = Math.max(0, match.index - 100);
      const endIdx = Math.min(text.length, match.index + path.length + 100);
      const context = text.substring(startIdx, endIdx);
      const access = inferFileAccessFromContext(context, path);
      
      pathsMap.set(path, { path, access, context: context.substring(0, 50) });
    }
  }
  
  // Common path patterns: ./file, ../file, ~/file
  const relativeRegex = /(?:^|\s)(\.{1,2}\/[^\s:*?"<>|]+)/gm;
  while ((match = relativeRegex.exec(text)) !== null) {
    const path = match[1];
    const startIdx = Math.max(0, match.index - 100);
    const endIdx = Math.min(text.length, match.index + path.length + 100);
    const context = text.substring(startIdx, endIdx);
    const access = inferFileAccessFromContext(context, path);
    pathsMap.set(path, { path, access, context: context.substring(0, 50) });
  }
  
  const homeRegex = /(?:^|\s)(~\/[^\s:*?"<>|]+)/gm;
  while ((match = homeRegex.exec(text)) !== null) {
    const path = match[1];
    const startIdx = Math.max(0, match.index - 100);
    const endIdx = Math.min(text.length, match.index + path.length + 100);
    const context = text.substring(startIdx, endIdx);
    const access = inferFileAccessFromContext(context, path);
    pathsMap.set(path, { path, access, context: context.substring(0, 50) });
  }
  
  return Array.from(pathsMap.values());
}

/**
 * Extract credentials (comprehensive patterns for all auth types)
 */
function extractCredentials(text: string): Array<{ user?: string; pass?: string; token?: string; valid?: 'valid' | 'invalid' | 'unknown'; context?: string }> {
  const creds: Array<{ user?: string; pass?: string; token?: string; valid?: 'valid' | 'invalid' | 'unknown'; context?: string }> = [];
  
  // Pattern 1: user:pass@ (URLs, connection strings)
  const userPassRegex = /\b([a-zA-Z0-9_-]+):([^\s:@]+)@/g;
  let match;
  while ((match = userPassRegex.exec(text)) !== null) {
    const startIdx = Math.max(0, match.index - 100);
    const endIdx = Math.min(text.length, match.index + 100);
    const context = text.substring(startIdx, endIdx);
    const valid = inferCredentialValidityFromContext(context);
    creds.push({ user: match[1], pass: match[2], valid, context: context.substring(0, 50) });
  }
  
  // Pattern 2: username/password pairs (common in output)
  const userPassPairRegex = /(?:username|user|login)[:\s]+([a-zA-Z0-9_-]+)[\s\S]{0,50}(?:password|pass|pwd)[:\s]+([^\s]+)/gi;
  while ((match = userPassPairRegex.exec(text)) !== null) {
    const startIdx = Math.max(0, match.index - 100);
    const endIdx = Math.min(text.length, match.index + 150);
    const context = text.substring(startIdx, endIdx);
    const valid = inferCredentialValidityFromContext(context);
    creds.push({ user: match[1], pass: match[2], valid, context: context.substring(0, 50) });
  }
  
  // Pattern 3: Key-value style - password=xxx, token=xxx, api_key=xxx
  const keyValueRegex = /(?:password|passwd|pwd|pass|token|api[_-]?key|secret|auth)[:\s]*[=:]\s*['"]?([^\s'"]+)['"]?/gi;
  while ((match = keyValueRegex.exec(text)) !== null) {
    const value = match[1];
    // Skip common placeholders
    if (value.toLowerCase() === 'password') continue;
    if (value.toLowerCase() === 'token') continue;
    if (value === 'xxx' || value === '***') continue;
    creds.push({ token: value });
  }
  
  // Pattern 4: JWT tokens (eyJ...)
  const jwtRegex = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  const jwts = text.match(jwtRegex) || [];
  for (const jwt of jwts) {
    creds.push({ token: jwt });
  }
  
  // Pattern 5: SSH/PEM key headers
  if (text.includes('BEGIN RSA PRIVATE KEY') || 
      text.includes('BEGIN OPENSSH PRIVATE KEY') ||
      text.includes('BEGIN PRIVATE KEY') ||
      text.includes('BEGIN DSA PRIVATE KEY') ||
      text.includes('BEGIN EC PRIVATE KEY')) {
    creds.push({ token: 'SSH_PRIVATE_KEY' });
  }
  
  // Pattern 6: Hash formats (common in password dumps)
  const md5Regex = /\b[a-f0-9]{32}\b/gi;
  const sha1Regex = /\b[a-f0-9]{40}\b/gi;
  const sha256Regex = /\b[a-f0-9]{64}\b/gi;
  
  // Only extract if we see hash-like context
  if (text.match(/hash|md5|sha|ntlm|password/i)) {
    const md5Matches = text.match(md5Regex) || [];
    const sha1Matches = text.match(sha1Regex) || [];
    const sha256Matches = text.match(sha256Regex) || [];
    
    if (md5Matches.length > 0 && md5Matches.length < 10) {
      for (const hash of md5Matches.slice(0, 5)) {
        creds.push({ token: `MD5:${hash}` });
      }
    }
    if (sha1Matches.length > 0 && sha1Matches.length < 10) {
      for (const hash of sha1Matches.slice(0, 5)) {
        creds.push({ token: `SHA1:${hash}` });
      }
    }
    if (sha256Matches.length > 0 && sha256Matches.length < 10) {
      for (const hash of sha256Matches.slice(0, 5)) {
        creds.push({ token: `SHA256:${hash}` });
      }
    }
  }
  
  // Pattern 7: NTLM hashes
  const ntlmRegex = /\b([a-zA-Z0-9_-]+):(\d+):([a-f0-9]{32}):([a-f0-9]{32}):/gi;
  while ((match = ntlmRegex.exec(text)) !== null) {
    creds.push({ 
      user: match[1], 
      token: `NTLM:${match[3]}:${match[4]}` 
    });
  }
  
  // Pattern 8: API keys (common formats)
  const apiKeyRegex = /\b(?:sk|pk|api)[-_]?[a-zA-Z0-9]{20,}/gi;
  const apiKeys = text.match(apiKeyRegex) || [];
  for (const key of apiKeys.slice(0, 5)) {
    creds.push({ token: key });
  }
  
  return creds;
}

/**
 * Extract infrastructure keywords (comprehensive pentest tool detection)
 */
function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();
  
  // Services
  const servicePatterns = [
    /\b(ssh|ftp|ftps|sftp|smb|cifs|ldap|ldaps|kerberos|mysql|mariadb|postgresql|postgres|mssql|oracle|redis|mongodb|memcached|elasticsearch|cassandra|couchdb)\b/gi,
    /\b(http|https|smtp|smtps|pop3|pop3s|imap|imaps|dns|dhcp|ntp|snmp|telnet|rdp|vnc|x11)\b/gi,
    /\b(docker|kubernetes|k8s|containerd|podman|apache|nginx|iis|tomcat|jboss|weblogic|websphere)\b/gi,
    /\b(jenkins|gitlab|github|bitbucket|jira|confluence|wordpress|drupal|joomla)\b/gi
  ];
  
  for (const pattern of servicePatterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => keywords.add(m.toLowerCase()));
  }
  
  // Protocols
  const protocolPattern = /\b(tcp|udp|icmp|arp|ipv4|ipv6|ssl|tls|ssh2|http2|quic)\b/gi;
  const protocols = text.match(protocolPattern) || [];
  protocols.forEach(p => keywords.add(p.toLowerCase()));
  
  // Pentest tools (detection for context)
  const toolPattern = /\b(nmap|masscan|rustscan|metasploit|msfconsole|msfvenom|burp|sqlmap|hydra|john|hashcat|gobuster|ffuf|wfuzz|nikto|nuclei|amass|subfinder|sublist3r)\b/gi;
  const tools = text.match(toolPattern) || [];
  tools.forEach(t => keywords.add(t.toLowerCase()));
  
  // Vulnerability indicators
  const vulnPattern = /\b(cve-\d{4}-\d{4,}|exploit|vulnerability|vuln|rce|sqli|xss|csrf|ssrf|lfi|rfi|xxe|ssti|idor)\b/gi;
  const vulns = text.match(vulnPattern) || [];
  vulns.forEach(v => keywords.add(v.toLowerCase()));
  
  // Authentication methods
  const authPattern = /\b(ntlm|kerberos|oauth|saml|jwt|basic\s+auth|digest\s+auth|api\s+key)\b/gi;
  const auths = text.match(authPattern) || [];
  auths.forEach(a => keywords.add(a.toLowerCase().replace(/\s+/g, '_')));
  
  return Array.from(keywords);
}

/**
 * Extract constraints (comprehensive error/blocker detection)
 */
function extractConstraints(text: string): string[] {
  const constraints = new Set<string>();
  
  const patterns = [
    // Command errors
    { pattern: /command not found/gi, label: 'command_not_found' },
    { pattern: /no such file or directory/gi, label: 'file_not_found' },
    { pattern: /cannot access/gi, label: 'cannot_access' },
    
    // Permission errors
    { pattern: /permission denied/gi, label: 'permission_denied' },
    { pattern: /access denied/gi, label: 'access_denied' },
    { pattern: /operation not permitted/gi, label: 'operation_not_permitted' },
    { pattern: /insufficient privileges/gi, label: 'insufficient_privileges' },
    { pattern: /you must be root/gi, label: 'requires_root' },
    
    // Network errors
    { pattern: /connection refused/gi, label: 'connection_refused' },
    { pattern: /connection timed out/gi, label: 'connection_timeout' },
    { pattern: /no route to host/gi, label: 'no_route' },
    { pattern: /network unreachable/gi, label: 'network_unreachable' },
    { pattern: /host is down/gi, label: 'host_down' },
    { pattern: /connection reset/gi, label: 'connection_reset' },
    
    // Authentication errors
    { pattern: /authentication failed/gi, label: 'auth_failed' },
    { pattern: /invalid credentials/gi, label: 'invalid_credentials' },
    { pattern: /login incorrect/gi, label: 'login_incorrect' },
    { pattern: /access forbidden/gi, label: 'forbidden' },
    { pattern: /unauthorized/gi, label: 'unauthorized' },
    { pattern: /bad password/gi, label: 'bad_password' },
    
    // HTTP errors
    { pattern: /403 forbidden/gi, label: '403_forbidden' },
    { pattern: /401 unauthorized/gi, label: '401_unauthorized' },
    { pattern: /404 not found/gi, label: '404_not_found' },
    { pattern: /500 internal server error/gi, label: '500_error' },
    { pattern: /502 bad gateway/gi, label: '502_bad_gateway' },
    { pattern: /503 service unavailable/gi, label: '503_unavailable' },
    
    // Service errors
    { pattern: /service unavailable/gi, label: 'service_unavailable' },
    { pattern: /port is closed/gi, label: 'port_closed' },
    { pattern: /no response/gi, label: 'no_response' },
    { pattern: /timeout/gi, label: 'timeout' },
    
    // Resource errors
    { pattern: /out of memory/gi, label: 'out_of_memory' },
    { pattern: /disk full/gi, label: 'disk_full' },
    { pattern: /too many open files/gi, label: 'too_many_files' },
    
    // Firewall/filtering
    { pattern: /filtered/gi, label: 'filtered' },
    { pattern: /blocked by firewall/gi, label: 'firewall_blocked' },
    { pattern: /connection filtered/gi, label: 'connection_filtered' }
  ];
  
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) {
      constraints.add(label);
    }
  }
  
  return Array.from(constraints);
}

/**
 * Extract services with state (NEW - captures open/closed/filtered)
 */
function extractServices(text: string): Array<{ port: number; state: 'open' | 'closed' | 'filtered'; protocol?: string; service?: string }> {
  const services: Array<{ port: number; state: 'open' | 'closed' | 'filtered'; protocol?: string; service?: string }> = [];
  
  // Pattern 1: nmap style - 22/tcp open ssh
  const nmapRegex = /(\d+)\/(tcp|udp)\s+(open|closed|filtered)(?:\s+([a-zA-Z0-9_-]+))?/gi;
  let match;
  while ((match = nmapRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) {
      services.push({
        port,
        state: match[3].toLowerCase() as 'open' | 'closed' | 'filtered',
        protocol: match[2].toLowerCase(),
        service: match[4]?.toLowerCase()
      });
    }
  }
  
  // Pattern 2: masscan style - Discovered open port 22/tcp on 10.10.11.247
  const masscanRegex = /discovered\s+(open|closed|filtered)\s+port\s+(\d+)\/(tcp|udp)/gi;
  while ((match = masscanRegex.exec(text)) !== null) {
    const port = parseInt(match[2]);
    if (port > 0 && port <= 65535) {
      services.push({
        port,
        state: match[1].toLowerCase() as 'open' | 'closed' | 'filtered',
        protocol: match[3].toLowerCase()
      });
    }
  }
  
  // Pattern 3: Generic "Port 22 is OPEN/CLOSED"
  const genericRegex = /port\s+(\d+)\s+is\s+(open|closed|filtered)/gi;
  while ((match = genericRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) {
      services.push({
        port,
        state: match[2].toLowerCase() as 'open' | 'closed' | 'filtered'
      });
    }
  }
  
  // Pattern 4: netcat style - (UNKNOWN) [10.10.11.247] 22 (ssh) open
  const netcatRegex = /\]\s+(\d+)\s+\(([^)]+)\)\s+(open|closed)/gi;
  while ((match = netcatRegex.exec(text)) !== null) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) {
      services.push({
        port,
        state: match[3].toLowerCase() as 'open' | 'closed' | 'filtered',
        service: match[2].toLowerCase()
      });
    }
  }
  
  return services;
}

/**
 * Infer credential validity from terminal output (global - checks entire output)
 */
export function inferCredentialValidity(text: string): 'valid' | 'invalid' | 'unknown' {
  // Success indicators
  const successPatterns = [
    /authentication successful/i,
    /login successful/i,
    /logged in/i,
    /access granted/i,
    /welcome/i,
    /last login/i
  ];
  
  // Failure indicators
  const failurePatterns = [
    /authentication failed/i,
    /login incorrect/i,
    /invalid credentials/i,
    /access denied/i,
    /permission denied/i,
    /bad password/i,
    /incorrect password/i
  ];
  
  for (const pattern of successPatterns) {
    if (pattern.test(text)) return 'valid';
  }
  
  for (const pattern of failurePatterns) {
    if (pattern.test(text)) return 'invalid';
  }
  
  return 'unknown';
}

/**
 * Infer credential validity from local context (per-credential)
 */
function inferCredentialValidityFromContext(context: string): 'valid' | 'invalid' | 'unknown' {
  // Success indicators (look for these near the credential)
  const successPatterns = [
    /authentication successful/i,
    /login successful/i,
    /logged in/i,
    /access granted/i,
    /welcome/i,
    /last login/i,
    /session opened/i,
    /accepted password/i,
    /accepted publickey/i
  ];
  
  // Failure indicators (look for these near the credential)
  const failurePatterns = [
    /authentication failed/i,
    /login failed/i,
    /login incorrect/i,
    /invalid credentials/i,
    /access denied/i,
    /permission denied/i,
    /bad password/i,
    /incorrect password/i,
    /connection refused/i,
    /authentication error/i
  ];
  
  for (const pattern of successPatterns) {
    if (pattern.test(context)) return 'valid';
  }
  
  for (const pattern of failurePatterns) {
    if (pattern.test(context)) return 'invalid';
  }
  
  return 'unknown';
}

/**
 * Infer file access from terminal output (global - checks entire output)
 */
export function inferFileAccess(text: string): 'readable' | 'writable' | 'denied' | 'unknown' {
  // Denied indicators
  const deniedPatterns = [
    /permission denied/i,
    /access denied/i,
    /cannot access/i,
    /no such file/i,
    /operation not permitted/i
  ];
  
  // Readable indicators (file content shown)
  const readablePatterns = [
    /^-rw/m, // ls -la output
    /^[drwx-]{10}/m, // Permission string
    /cat.*:/i, // cat command with content
    /^#!/m // Shebang (file content)
  ];
  
  // Writable indicators
  const writablePatterns = [
    /^-rw.*w/m, // Write permission in ls
    /writable/i,
    /write access/i
  ];
  
  for (const pattern of deniedPatterns) {
    if (pattern.test(text)) return 'denied';
  }
  
  for (const pattern of writablePatterns) {
    if (pattern.test(text)) return 'writable';
  }
  
  for (const pattern of readablePatterns) {
    if (pattern.test(text)) return 'readable';
  }
  
  return 'unknown';
}

/**
 * Infer file access from local context (per-file)
 */
function inferFileAccessFromContext(context: string, path: string): 'readable' | 'writable' | 'denied' | 'unknown' {
  // Check if this specific file is mentioned with access indicators
  const pathEscaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Denied indicators (look for path + error)
  const deniedPatterns = [
    new RegExp(`${pathEscaped}.*permission denied`, 'i'),
    new RegExp(`${pathEscaped}.*access denied`, 'i'),
    new RegExp(`${pathEscaped}.*cannot access`, 'i'),
    new RegExp(`${pathEscaped}.*no such file`, 'i'),
    new RegExp(`${pathEscaped}.*operation not permitted`, 'i'),
    /permission denied/i,
    /access denied/i,
    /cannot access/i,
    /no such file/i
  ];
  
  // Readable indicators (file content shown or read permission)
  const readablePatterns = [
    new RegExp(`${pathEscaped}.*-r`, 'i'), // ls -la with read permission
    /^-r/m, // Permission string starting with -r
    /cat\s+/i, // cat command
    /^#!/m, // Shebang (file content)
    /readable/i
  ];
  
  // Writable indicators
  const writablePatterns = [
    new RegExp(`${pathEscaped}.*-rw`, 'i'), // ls -la with write permission
    /^-rw.*w/m, // Write permission in ls
    /writable/i,
    /write access/i,
    /successfully written/i,
    /file created/i
  ];
  
  for (const pattern of deniedPatterns) {
    if (pattern.test(context)) return 'denied';
  }
  
  for (const pattern of writablePatterns) {
    if (pattern.test(context)) return 'writable';
  }
  
  for (const pattern of readablePatterns) {
    if (pattern.test(context)) return 'readable';
  }
  
  return 'unknown';
}

/**
 * Infer authentication result from terminal output
 */
export function inferAuthResult(text: string): 'success' | 'failed' | 'unknown' {
  // Success indicators
  const successPatterns = [
    /authentication successful/i,
    /login successful/i,
    /logged in/i,
    /access granted/i,
    /welcome/i,
    /last login/i,
    /session opened/i
  ];
  
  // Failure indicators
  const failurePatterns = [
    /authentication failed/i,
    /login failed/i,
    /login incorrect/i,
    /invalid credentials/i,
    /access denied/i,
    /permission denied/i,
    /bad password/i,
    /connection refused/i
  ];
  
  for (const pattern of successPatterns) {
    if (pattern.test(text)) return 'success';
  }
  
  for (const pattern of failurePatterns) {
    if (pattern.test(text)) return 'failed';
  }
  
  return 'unknown';
}

