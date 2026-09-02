/**
 * Session Persistence
 * Save and restore sessions from disk
 */

import type { WorkingSession as Session, Host } from './types';
import { deserializeHost, serializeHost } from './host';

export interface SerializedSession {
  session: {
    id: string;
    phase: string;
    phase_changed_at: number;
    started_at: number;
    hosts: Record<string, any>;
    edges: any[];
    loot: Record<string, any>;
    loot_cache: string[]; // Serialized Set
    goal?: string;
    target_ip?: string;
    current_phase?: string;
    command_history: any[];
    time_in_phase: number;
  };
  version: number;
  last_updated: number;
}

export function serializeSession(session: Session): SerializedSession {
  const hostsObj: Record<string, any> = {};
  for (const [id, host] of session.hosts.entries()) {
    hostsObj[id] = serializeHost(host);
  }

  const lootObj: Record<string, any> = {};
  for (const [id, loot] of session.loot.entries()) {
    lootObj[id] = loot;
  }

  return {
    session: {
      id: session.id,
      phase: session.phase,
      phase_changed_at: session.phase_changed_at,
      started_at: session.started_at,
      hosts: hostsObj,
      edges: session.edges,
      loot: lootObj,
      loot_cache: Array.from(session.loot_cache), // Serialize Set
      goal: session.goal,
      target_ip: session.target_ip,
      current_phase: session.current_phase,
      command_history: session.command_history,
      time_in_phase: session.time_in_phase
    },
    version: 3, // Bump version
    last_updated: Date.now()
  };
}

export function deserializeSession(data: SerializedSession): Session {
  // FIX: Validate data structure before deserializing
  if (!data || !data.session) {
    throw new Error('Invalid session data: missing session object');
  }
  
  if (!data.session.hosts || typeof data.session.hosts !== 'object') {
    throw new Error('Invalid session data: missing or invalid hosts');
  }
  
  const hosts = new Map<string, Host>();
  for (const [id, hostData] of Object.entries(data.session.hosts)) {
    try {
      hosts.set(id, deserializeHost(hostData));
    } catch (error) {
      console.warn(`Failed to deserialize host ${id}:`, error);
      // Skip corrupted host data
    }
  }

  const loot = new Map();
  for (const [id, lootData] of Object.entries(data.session.loot || {})) {
    loot.set(id, lootData);
  }

  return {
    id: data.session.id,
    phase: data.session.phase as any,
    phase_changed_at: data.session.phase_changed_at,
    started_at: data.session.started_at,
    hosts,
    edges: data.session.edges || [],
    loot,
    loot_cache: new Set(data.session.loot_cache || []), // Deserialize Set
    goal: data.session.goal,
    target_ip: data.session.target_ip,
    current_phase: data.session.current_phase as any,
    command_history: data.session.command_history || [],
    time_in_phase: data.session.time_in_phase || 0
  };
}

export async function saveSession(session: Session): Promise<void> {
  const serialized = serializeSession(session);
  const json = JSON.stringify(serialized, null, 2);

  // Use electron IPC to save to disk
  if (window.electron?.saveSessionState) {
    await window.electron.saveSessionState(session.id, json);
  } else {
    // Fallback to localStorage for web
    localStorage.setItem(`osecbox_session_${session.id}`, json);
  }
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  let json: string | null = null;

  // Try electron IPC first
  if (window.electron?.loadSessionState) {
    json = await window.electron.loadSessionState(sessionId);
  } else {
    // Fallback to localStorage
    json = localStorage.getItem(`osecbox_session_${sessionId}`);
  }

  if (!json) return null;

  try {
    const parsed = JSON.parse(json);

    // FORMAT-TOLERANT: Two persistence systems write to the same directory.
    //  1. session-persistence (this file):   { session: {...}, version, last_updated }
    //  2. UI SessionManager wrapper:          { id, name, data: { attackSession: {...} } }
    // Detect and normalize so startup auto-load can restore either one instead of
    // throwing and silently resetting to an empty session.
    let serialized: SerializedSession | null = null;

    if (parsed && parsed.session) {
      // Raw serialized session
      serialized = parsed as SerializedSession;
    } else if (parsed && parsed.data && parsed.data.attackSession) {
      // UI SessionManager wrapper — unwrap the embedded attack session
      serialized = parsed.data.attackSession as SerializedSession;
    }

    if (!serialized) {
      // Not an attack-state session file (e.g. legacy UI-only snapshot). Don't crash.
      console.warn('[SessionPersistence] No attack-state data in session file, skipping deserialize');
      return null;
    }

    return deserializeSession(serialized);
  } catch (error) {
    console.error('Failed to deserialize session:', error);
    return null;
  }
}

export async function listSessions(): Promise<string[]> {
  if (window.electron?.listSessions) {
    return await window.electron.listSessions();
  } else {
    // Fallback to localStorage
    const keys = Object.keys(localStorage);
    return keys
      .filter(k => k.startsWith('osecbox_session_'))
      .map(k => k.replace('osecbox_session_', ''));
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (window.electron?.deleteSession) {
    await window.electron.deleteSession(sessionId);
  } else {
    localStorage.removeItem(`osecbox_session_${sessionId}`);
  }
}

export function getSessionStoragePath(sessionId: string): string {
  return `Electron userData/sessions/${sessionId}.json`;
}
