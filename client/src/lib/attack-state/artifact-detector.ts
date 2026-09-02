/**
 * Artifact Detector
 * Cheap signal detection for interesting files, paths, and artifacts
 * 
 * NO AI. NO LLM. Just regex and pattern matching.
 * Like grep, trufflehog, secretscanner, nuclei.
 */

export interface ArtifactSignal {
  type: 'file' | 'path' | 'service' | 'config' | 'binary';
  severity: 'critical' | 'high' | 'medium' | 'low';
  value: string;
  reason: string;
  line: string; // The actual line from output
  confidence: number; // 0-100
}

/**
 * Scan terminal output for interesting artifacts
 */
export function detectArtifacts(output: string): ArtifactSignal[] {
  const signals: ArtifactSignal[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Credential files
    if (matchesCredentialFile(line)) {
      signals.push({
        type: 'file',
        severity: 'critical',
        value: extractPath(line),
        reason: 'Potential credential file',
        line: line.trim(),
        confidence: 95
      });
    }
    
    // SSH keys
    if (matchesSSHKey(line)) {
      signals.push({
        type: 'file',
        severity: 'critical',
        value: extractPath(line),
        reason: 'SSH private key',
        line: line.trim(),
        confidence: 100
      });
    }
    
    // HIGH: Config files
    if (matchesConfigFile(line)) {
      signals.push({
        type: 'config',
        severity: 'high',
        value: extractPath(line),
        reason: 'Configuration file',
        line: line.trim(),
        confidence: 85
      });
    }
    
    // HIGH: Database files
    if (matchesDatabaseFile(line)) {
      signals.push({
        type: 'file',
        severity: 'high',
        value: extractPath(line),
        reason: 'Database file',
        line: line.trim(),
        confidence: 90
      });
    }
    
    // HIGH: Backup files
    if (matchesBackupFile(line)) {
      signals.push({
        type: 'file',
        severity: 'high',
        value: extractPath(line),
        reason: 'Backup file',
        line: line.trim(),
        confidence: 80
      });
    }
    
    // MEDIUM: Writable directories
    if (matchesWritablePath(line)) {
      signals.push({
        type: 'path',
        severity: 'medium',
        value: extractPath(line),
        reason: 'Writable directory',
        line: line.trim(),
        confidence: 70
      });
    }
    
    // MEDIUM: SUID binaries
    if (matchesSUIDBinary(line)) {
      signals.push({
        type: 'binary',
        severity: 'high',
        value: extractPath(line),
        reason: 'SUID binary',
        line: line.trim(),
        confidence: 95
      });
    }
    
    // LOW: Interesting paths
    if (matchesInterestingPath(line)) {
      signals.push({
        type: 'path',
        severity: 'low',
        value: extractPath(line),
        reason: 'Interesting directory',
        line: line.trim(),
        confidence: 60
      });
    }
  }
  
  // Deduplicate by value
  const seen = new Set<string>();
  return signals.filter(s => {
    if (seen.has(s.value)) return false;
    seen.add(s.value);
    return true;
  });
}

/**
 * Credential files
 */
function matchesCredentialFile(line: string): boolean {
  const patterns = [
    /cred/i,
    /pass/i,
    /secret/i,
    /token/i,
    /key(?!\.)/i, // "key" but not "key."
    /auth/i,
    /\.pem$/i,
    /\.key$/i,
    /\.crt$/i,
    /id_rsa/i,
    /id_dsa/i,
    /id_ecdsa/i,
    /id_ed25519/i,
    /\.ppk$/i,
    /shadow$/i,
    /passwd$/i,
    /htpasswd/i,
    /\.pwd$/i,
    /\.password$/i
  ];
  
  return patterns.some(p => p.test(line));
}

/**
 * SSH keys
 */
function matchesSSHKey(line: string): boolean {
  return /id_(rsa|dsa|ecdsa|ed25519)/i.test(line) ||
         /\.pem$/i.test(line) ||
         /\.key$/i.test(line) ||
         /authorized_keys/i.test(line) ||
         /known_hosts/i.test(line);
}

/**
 * HIGH: Config files
 */
function matchesConfigFile(line: string): boolean {
  const patterns = [
    /\.env$/i,
    /\.config$/i,
    /\.conf$/i,
    /\.ini$/i,
    /\.yml$/i,
    /\.yaml$/i,
    /\.json$/i,
    /\.xml$/i,
    /config\./i,
    /settings\./i,
    /wp-config/i,
    /database\.yml/i,
    /\.htaccess/i,
    /\.htpasswd/i,
    /web\.config/i,
    /app\.config/i
  ];
  
  return patterns.some(p => p.test(line));
}

/**
 * HIGH: Database files
 */
function matchesDatabaseFile(line: string): boolean {
  return /\.db$/i.test(line) ||
         /\.sqlite/i.test(line) ||
         /\.sql$/i.test(line) ||
         /\.mdb$/i.test(line) ||
         /\.accdb$/i.test(line) ||
         /database/i.test(line);
}

/**
 * HIGH: Backup files
 */
function matchesBackupFile(line: string): boolean {
  return /\.bak$/i.test(line) ||
         /\.backup$/i.test(line) ||
         /\.old$/i.test(line) ||
         /\.save$/i.test(line) ||
         /\.swp$/i.test(line) ||
         /~$/i.test(line) ||
         /backup/i.test(line);
}

/**
 * MEDIUM: Writable paths (from ls -la output)
 */
function matchesWritablePath(line: string): boolean {
  // Match: drwxrwxrwx or drwxrwxr-x with 'w' in group/other
  return /^d.{2}w.{2}w/i.test(line) || // world writable
         /^d.{5}w/i.test(line); // group writable
}

/**
 * HIGH: SUID binaries
 */
function matchesSUIDBinary(line: string): boolean {
  // Match: -rwsr-xr-x (SUID bit set)
  return /^-..s/i.test(line) || // SUID
         /^-....s/i.test(line); // SGID
}

/**
 * LOW: Interesting paths
 */
function matchesInterestingPath(line: string): boolean {
  const patterns = [
    /\/home\//i,
    /\/root\//i,
    /\/var\/www\//i,
    /\/opt\//i,
    /\/tmp\//i,
    /\/dev\/shm\//i,
    /\/mnt\//i,
    /\/media\//i,
    /\.git\//i,
    /\.svn\//i,
    /\.ssh\//i,
    /\.aws\//i,
    /\.docker\//i
  ];
  
  return patterns.some(p => p.test(line));
}

/**
 * Extract file path from line
 */
function extractPath(line: string): string {
  // Try to extract path from ls -la output
  // Format: drwxr-xr-x 2 user group 4096 Jan 1 12:00 /path/to/file
  const lsMatch = line.match(/\s+(\S+\/\S+)$/);
  if (lsMatch) return lsMatch[1];
  
  // Try to extract path from find output
  const findMatch = line.match(/^(\/\S+)/);
  if (findMatch) return findMatch[1];
  
  // Try to extract any path-like string
  const pathMatch = line.match(/([\/~]\S+)/);
  if (pathMatch) return pathMatch[1];
  
  // Fallback: return the whole line
  return line.trim();
}

/**
 * Format signals for display
 */
export function formatSignals(signals: ArtifactSignal[]): string {
  if (signals.length === 0) return '';
  
  const critical = signals.filter(s => s.severity === 'critical');
  const high = signals.filter(s => s.severity === 'high');
  const medium = signals.filter(s => s.severity === 'medium');
  const low = signals.filter(s => s.severity === 'low');
  
  let output = '';
  
  if (critical.length > 0) {
    output += '🔴 CRITICAL ARTIFACTS:\n';
    critical.forEach(s => {
      output += `  • ${s.value} (${s.reason})\n`;
    });
    output += '\n';
  }
  
  if (high.length > 0) {
    output += '🟠 HIGH PRIORITY:\n';
    high.forEach(s => {
      output += `  • ${s.value} (${s.reason})\n`;
    });
    output += '\n';
  }
  
  if (medium.length > 0) {
    output += '🟡 MEDIUM PRIORITY:\n';
    medium.forEach(s => {
      output += `  • ${s.value} (${s.reason})\n`;
    });
    output += '\n';
  }
  
  if (low.length > 0) {
    output += '⚪ INTERESTING:\n';
    low.forEach(s => {
      output += `  • ${s.value} (${s.reason})\n`;
    });
  }
  
  return output;
}
