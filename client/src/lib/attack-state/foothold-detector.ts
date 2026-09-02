/**
 * Foothold Detector
 * Identifies successful access points
 */

import type { Host, Move, FootholdType } from './types';

export function detectFoothold(host: Host, move: Move, stdout: string): void {
  if (move.result !== 'success') return;

  const stdoutLower = stdout.toLowerCase();

  // Shell access
  if (
    stdoutLower.includes('$ ') ||
    stdoutLower.includes('# ') ||
    stdoutLower.includes('bash-') ||
    stdoutLower.includes('sh-') ||
    stdoutLower.includes('welcome to') ||
    stdoutLower.includes('last login')
  ) {
    // Determine quality based on prompt
    const quality = stdoutLower.includes('# ') || stdoutLower.includes('root@') 
      ? 'high' 
      : 'medium';
    
    host.footholds.add('shell');
    host.foothold_details.set('shell', {
      type: 'shell',
      quality,
      established_at: Date.now()
    });
    
    addQuickWin(host, quality === 'high' ? 'ROOT shell access obtained' : 'Shell access obtained');
  }

  // SSH access
  if (
    move.scope === 'network' &&
    (stdoutLower.includes('welcome to') ||
      stdoutLower.includes('last login') ||
      stdoutLower.includes('ssh')) &&
    move.target?.includes('22')
  ) {
    const quality = stdoutLower.includes('root@') ? 'high' : 'medium';
    
    host.footholds.add('ssh');
    host.foothold_details.set('ssh', {
      type: 'ssh',
      quality,
      established_at: Date.now()
    });
    
    addQuickWin(host, quality === 'high' ? 'ROOT SSH access obtained' : 'SSH access obtained');
  }

  // LDAP bind
  if (
    stdoutLower.includes('bind successful') ||
    stdoutLower.includes('ldap_bind') ||
    (stdoutLower.includes('ldap') && stdoutLower.includes('success'))
  ) {
    host.footholds.add('ldap');
    host.foothold_details.set('ldap', {
      type: 'ldap',
      quality: 'high', // LDAP access is always high value
      established_at: Date.now()
    });
    
    addQuickWin(host, 'LDAP bind successful');
  }

  // SMB access
  if (
    stdoutLower.includes('smb:') ||
    stdoutLower.includes('disk|') ||
    stdoutLower.includes('shares available') ||
    (stdoutLower.includes('smb') && stdoutLower.includes('success'))
  ) {
    const quality = stdoutLower.includes('admin$') || stdoutLower.includes('c$') 
      ? 'high' 
      : 'medium';
    
    host.footholds.add('smb');
    host.foothold_details.set('smb', {
      type: 'smb',
      quality,
      established_at: Date.now()
    });
    
    addQuickWin(host, quality === 'high' ? 'ADMIN SMB access obtained' : 'SMB access obtained');
  }

  // HTTP/Web access
  if (
    move.scope === 'network' &&
    (stdoutLower.includes('200 ok') ||
      stdoutLower.includes('http/1.1 200') ||
      stdoutLower.includes('http/2 200')) &&
    (move.target?.includes('80') || move.target?.includes('443'))
  ) {
    host.footholds.add('http');
    host.foothold_details.set('http', {
      type: 'http',
      quality: 'low', // HTTP is low value
      established_at: Date.now()
    });
  }

  // RDP access
  if (
    stdoutLower.includes('rdp') ||
    stdoutLower.includes('remote desktop') ||
    (stdoutLower.includes('3389') && move.result === 'success')
  ) {
    const quality = stdoutLower.includes('administrator') ? 'high' : 'medium';
    
    host.footholds.add('rdp');
    host.foothold_details.set('rdp', {
      type: 'rdp',
      quality,
      established_at: Date.now()
    });
    
    addQuickWin(host, quality === 'high' ? 'ADMIN RDP access obtained' : 'RDP access obtained');
  }

  // Root/admin shell
  if (
    stdoutLower.includes('# ') ||
    stdoutLower.includes('root@') ||
    stdoutLower.includes('administrator@')
  ) {
    addQuickWin(host, 'ROOT/ADMIN SHELL - GAME OVER');
  }

  // Writable /etc/passwd
  if (
    move.scope === 'filesystem' &&
    move.target?.includes('/etc/passwd') &&
    !move.stderr_keywords?.includes('permission denied')
  ) {
    addQuickWin(host, 'Writable /etc/passwd - instant root');
  }

  // Sudo ALL
  if (
    stdoutLower.includes('(all) all') ||
    stdoutLower.includes('(all : all) all')
  ) {
    addQuickWin(host, 'Sudo ALL privileges - instant root');
  }
}

function addQuickWin(host: Host, win: string): void {
  if (!host.quick_wins.includes(win)) {
    host.quick_wins.push(win);
  }
}

export function hasFoothold(host: Host): boolean {
  return host.footholds.size > 0;
}

export function getFootholds(host: Host): FootholdType[] {
  return Array.from(host.footholds) as FootholdType[];
}

export function hasPrivilegedFoothold(host: Host): boolean {
  // Check for high-value footholds
  return (
    host.footholds.has('ldap') ||
    host.footholds.has('smb') ||
    host.quick_wins.some(win => win.includes('ROOT') || win.includes('ADMIN'))
  );
}
