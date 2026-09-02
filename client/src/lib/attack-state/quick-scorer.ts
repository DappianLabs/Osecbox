/**
 * Quick Scorer
 * Deterministic, regex-based scoring
 * ALWAYS works, even offline
 */

import type { GraphEntity } from './world-graph';

/**
 * Quick score entity (deterministic, instant)
 */
export function quickScore(entity: GraphEntity): number {
  let score = 0;
  
  if (entity.type === 'file') {
    const path = entity.attrs.path?.toLowerCase();
    if (!path) return 0;  // No path = no score
    
    // IMPROVED: Fuzzy matching for compound words
    // Critical patterns (HIGH VALUE)
    if (path.match(/cred|pass|pwd|auth|login/)) score += 40;
    if (path.match(/secret|token|api.*key/)) score += 40;
    if (path.match(/\.env|\.pem|\.key|id_rsa|private.*key/)) score += 40;
    
    // Important indicators (MEDIUM-HIGH VALUE)
    if (path.match(/important|imp\.|sensitive|private|confidential/)) score += 35;
    if (path.match(/backup|dump|export|archive/)) score += 30;
    if (path.match(/admin|root|sudo|privilege/)) score += 25;
    if (path.match(/config|settings|\.conf|\.ini/)) score += 20;
    
    // User data (MEDIUM VALUE)
    if (path.match(/user|account|profile/)) score += 20;
    if (path.match(/database|\.db|\.sql|mysql|postgres/)) score += 25;
    
    // Logs that might contain creds (MEDIUM VALUE)
    if (path.match(/auth\.log|access\.log|error\.log/)) score += 20;
    
    // Context boost (directory-based)
    if (path.includes('/var/log')) score += 10;
    if (path.includes('/tmp')) score += 5;
    if (path.includes('/home')) score += 10;
    if (path.includes('/root')) score += 15;
    if (path.includes('/etc')) score += 10;
    if (path.includes('/.ssh')) score += 15;
    if (path.includes('/var/www')) score += 10;
    if (path.includes('/opt')) score += 5;
    
    // Penalties (filter out noise)
    if (path.includes('node_modules')) score = 0;
    if (path.match(/\.so(\.\d+)*$/)) score = 0;
    if (path.includes('/usr/lib')) score = 0;
    if (path.includes('/usr/share')) score = 0;
  }
  
  if (entity.type === 'cred') {
    score = 90; // Credentials always high value
    if (entity.attrs.valid === 'valid') score = 100;
    if (entity.attrs.valid === 'invalid') score = 30;
  }
  
  if (entity.type === 'service') {
    const service = entity.attrs.service?.toLowerCase() || '';
    const protocol = entity.attrs.protocol?.toLowerCase() || '';
    
    if (service.match(/ssh|rdp|smb|ldap|kerberos/)) score += 40;
    if (service.match(/http|https|ftp/)) score += 20;
    if (service.match(/mysql|postgresql|mssql|oracle|redis|mongodb/)) score += 30;
    if (entity.attrs.state === 'open') score += 20;
    if (entity.attrs.state === 'filtered') score += 10;
  }
  
  if (entity.type === 'host') {
    score = 30; // Hosts are moderately interesting
    const ip = entity.attrs.ip || '';
    
    // Private IPs are more interesting
    if (ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.168.')) {
      score += 10;
    }
  }
  
  if (entity.type === 'constraint') {
    score = 20; // Constraints are less interesting but still tracked
  }
  
  return Math.min(score, 100);
}
