/**
 * Session management
 */

import type { WorkingSession as Session, Phase, Host } from './types';
import { createHost } from './host';

export function createSession(goal?: string): Session {
  const localHost = createHost('local', '127.0.0.1', 'local');

  return {
    id: generateSessionId(),
    phase: 'recon',
    phase_changed_at: Date.now(),
    started_at: Date.now(),
    hosts: new Map([['local', localHost]]),
    edges: [],
    loot: new Map(),
    loot_cache: new Set(), // For deduplication
    goal,
    command_history: [], // Track last 100 commands
    time_in_phase: 0
  };
}

export function getOrCreateHost(session: Session, ip: string): Host {
  // Check if host exists
  for (const host of session.hosts.values()) {
    if (host.ip === ip) {
      return host;
    }
  }

  // Create new host
  const hostId = `host_${session.hosts.size}`;
  const host = createHost(hostId, ip);
  session.hosts.set(hostId, host);

  return host;
}

export function getCurrentHost(session: Session): Host {
  // For now, return local host
  // In future, track which host user is currently on
  return session.hosts.get('local')!;
}

export function detectPhaseChange(session: Session): void {
  const hosts = Array.from(session.hosts.values());

  // Update time in phase
  const now = Date.now();
  session.time_in_phase = now - session.phase_changed_at;

  // Recon → Foothold
  if (session.phase === 'recon' && hosts.some(h => h.footholds.size > 0)) {
    session.phase = 'foothold';
    session.phase_changed_at = now;
    session.time_in_phase = 0;
    return;
  }

  // Foothold → Lateral
  if (session.phase === 'foothold' && session.edges.length > 0) {
    session.phase = 'lateral';
    session.phase_changed_at = now;
    session.time_in_phase = 0;
    return;
  }

  // Lateral → Privesc
  if (
    session.phase === 'lateral' &&
    hosts.some(h => h.coverage.privilege > 50)
  ) {
    session.phase = 'privesc';
    session.phase_changed_at = now;
    session.time_in_phase = 0;
    return;
  }

  // Privesc → Exfil
  if (
    session.phase === 'privesc' &&
    hosts.some(h => h.quick_wins.some(w => w.includes('ROOT') || w.includes('ADMIN')))
  ) {
    session.phase = 'exfil';
    session.phase_changed_at = now;
    session.time_in_phase = 0;
    return;
  }
}

export function setPhase(session: Session, phase: Phase): void {
  session.phase = phase;
  session.phase_changed_at = Date.now();
}

export function getSessionDuration(session: Session): number {
  return Date.now() - session.started_at;
}

export function getPhaseDescription(phase: Phase): string {
  switch (phase) {
    case 'recon':
      return 'Reconnaissance - Gathering information about targets';
    case 'foothold':
      return 'Initial Access - Establishing first foothold';
    case 'lateral':
      return 'Lateral Movement - Pivoting to other hosts';
    case 'privesc':
      return 'Privilege Escalation - Gaining elevated access';
    case 'exfil':
      return 'Exfiltration - Mission complete, extracting data';
    case 'complete':
      return 'Complete - Session finished';
  }
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}
