/**
 * Session Persistence Handlers
 * Handles saving/loading attack state sessions
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { rateLimiters } from './rate-limiter';
import { logSecurityEvent } from '../utils/security-logger';
import {
  isValidJson,
  readTextFileWithRecovery,
  writeTextFileAtomic,
} from '../utils/atomic-json';

// Keep application data under Electron's per-user writable directory. Using
// the home directory directly caused permission and backup surprises on
// Windows, macOS sandboxed setups, and managed Linux desktops.
const SESSION_DIR = path.join(app.getPath('userData'), 'sessions');
const LEGACY_SESSION_DIR = path.join(app.getPath('home'), '.osecbox', 'sessions');
const MAX_SESSION_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_ARTIFACT_BYTES = 128 * 1024 * 1024;

function getSessionArtifactPath(sessionId: string, key: string, revision: string): string | null {
  if (
    typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId) ||
    typeof key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(key) ||
    typeof revision !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(revision)
  ) {
    return null;
  }

  const sessionDir = path.resolve(SESSION_DIR);
  const candidate = path.resolve(sessionDir, `${sessionId}.artifact.${key}.${revision}.json`);
  const relative = path.relative(sessionDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

function getSessionPath(sessionId: string): string | null {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return null;
  }

  const sessionDir = path.resolve(SESSION_DIR);
  const candidate = path.resolve(sessionDir, `${sessionId}.json`);
  const relative = path.relative(sessionDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

// Ensure session directory exists once per app lifetime. Concurrent startup,
// Save, and Load requests share the same promise instead of racing migration.
let sessionDirReady: Promise<void> | null = null;
function ensureSessionDir(): Promise<void> {
  if (!sessionDirReady) {
    sessionDirReady = (async () => {
      await fs.mkdir(SESSION_DIR, { recursive: true });
      await migrateLegacySessions();
    })().catch((error) => {
      sessionDirReady = null;
      console.error('[Session] Failed to create session directory:', error);
      throw error;
    });
  }
  return sessionDirReady;
}

async function migrateLegacySessions(): Promise<void> {
  // A best-effort, copy-only migration preserves old sessions without making
  // a failed upgrade destructive. The new directory remains authoritative.
  if (path.resolve(LEGACY_SESSION_DIR) === path.resolve(SESSION_DIR)) return;

  let entries: string[];
  try {
    entries = await fs.readdir(LEGACY_SESSION_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(entry)) continue;
    const source = path.join(LEGACY_SESSION_DIR, entry);
    const destination = path.join(SESSION_DIR, entry);
    try {
      await fs.access(destination);
      continue;
    } catch {
      // Destination does not exist; copy below.
    }

    try {
      await fs.copyFile(source, destination);
      if (process.platform !== 'win32') await fs.chmod(destination, 0o600);
      console.log(`[Session] Migrated legacy session ${entry} to Electron userData`);
    } catch (error) {
      console.warn(`[Session] Could not migrate legacy session ${entry}:`, error);
    }
  }
}

export function registerSessionHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void
) {
  // Initialize session directory
  ensureSessionDir().catch(err => {
    console.error('[Session] Failed to initialize session directory:', err);
  });

  // Save session state
  registerIPCHandler('save-session-state', async (_event, sessionId: string, data: string) => {
    try {
      // SECURITY: Rate limiting
      const rateLimitCheck = rateLimiters.sessionSave.check('session-save');
      if (!rateLimitCheck.allowed) {
        console.error('[SECURITY] Rate limit exceeded for session save');
        return false;
      }

      // The startup migration is intentionally best-effort and runs in the
      // background. Await the same initialization here so an immediate Save
      // after launch cannot race directory creation.
      await ensureSessionDir();
      
      const filePath = getSessionPath(sessionId);
      if (!filePath) {
        console.error('[Session] Invalid session ID:', sessionId);
        return false;
      }
      
      // Keep the primary record bounded. Large evidence collections use the
      // artifact handlers below so one JSON.stringify/IPC payload cannot make
      // the rest of a session unsaveable.
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_SESSION_BYTES) {
        console.error('[Session] Data too large or invalid:', typeof data === 'string' ? data.length : typeof data);
        return false;
      }
      let validSessionJson = false;
      try {
        JSON.parse(data);
        validSessionJson = true;
      } catch {
        validSessionJson = false;
      }
      if (!validSessionJson) {
        console.error('[Session] Refusing to save invalid JSON');
        return false;
      }

      await writeTextFileAtomic(filePath, data);

      logSecurityEvent.sessionOperation('save', sessionId, true);
      return true;
    } catch (error) {
      console.error('[Session] Failed to save session:', error);
      return false;
    }
  });

  // Large state is stored beside the primary session record. Each artifact is
  // revisioned so a crash between writing evidence and committing the session
  // metadata can never make the previous session point at partially replaced
  // data. The renderer supplies a random revision per save.
  registerIPCHandler('save-session-artifact', async (
    _event,
    args: { sessionId: string; key: string; revision: string; data: string },
  ) => {
    try {
      const rateLimitCheck = rateLimiters.sessionSave.check('session-artifact-save');
      if (!rateLimitCheck.allowed) return { success: false, error: 'Save rate limit exceeded' };
      await ensureSessionDir();

      const filePath = getSessionArtifactPath(args?.sessionId, args?.key, args?.revision);
      if (!filePath) return { success: false, error: 'Invalid artifact identity' };
      if (typeof args?.data !== 'string' || Buffer.byteLength(args.data, 'utf8') > MAX_SESSION_ARTIFACT_BYTES) {
        return { success: false, error: 'Session artifact is too large or invalid' };
      }
      if (!isValidJson(args.data)) return { success: false, error: 'Session artifact is not valid JSON' };

      await writeTextFileAtomic(filePath, args.data);
      return { success: true, bytes: Buffer.byteLength(args.data, 'utf8') };
    } catch (error) {
      console.error('[Session] Failed to save session artifact:', error);
      return { success: false, error: 'Failed to save session artifact' };
    }
  });

  registerIPCHandler('load-session-artifact', async (
    _event,
    args: { sessionId: string; key: string; revision: string },
  ) => {
    try {
      const rateLimitCheck = rateLimiters.sessionLoad.check('session-artifact-load');
      if (!rateLimitCheck.allowed) return null;
      await ensureSessionDir();
      const filePath = getSessionArtifactPath(args?.sessionId, args?.key, args?.revision);
      if (!filePath) return null;
      return await readTextFileWithRecovery(filePath, isValidJson);
    } catch (error) {
      console.error('[Session] Failed to load session artifact:', error);
      return null;
    }
  });

  // Load session state
  registerIPCHandler('load-session-state', async (_event, sessionId: string) => {
    try {
      // SECURITY: Rate limiting
      const rateLimitCheck = rateLimiters.sessionLoad.check('session-load');
      if (!rateLimitCheck.allowed) {
        console.error('[SECURITY] Rate limit exceeded for session load');
        return null;
      }

      await ensureSessionDir();
      
      const filePath = getSessionPath(sessionId);
      if (!filePath) {
        console.error('[Session] Invalid session ID:', sessionId);
        logSecurityEvent.invalidInput('sessionId', sessionId, 'Contains invalid characters');
        return null;
      }

      const data = await readTextFileWithRecovery(filePath, isValidJson);
      if (data === null) throw new Error('Session file is missing or corrupt');
      logSecurityEvent.sessionOperation('load', sessionId, true);
      return data;
    } catch (error) {
      console.error('[Session] Failed to load session:', error);
      return null;
    }
  });

  // List all sessions
  registerIPCHandler('list-sessions', async () => {
    try {
      // Ensure the directory exists and any legacy sessions are migrated before
      // the renderer builds its session index.
      await ensureSessionDir();
      
      const files = await fs.readdir(SESSION_DIR);
      return files
        .filter((f: string) => /^[a-zA-Z0-9_-]+\.json$/.test(f))
        .map((f: string) => f.replace('.json', ''))
        .sort()
        .reverse(); // Most recent first
    } catch (error) {
      console.error('[Session] Failed to list sessions:', error);
      return [];
    }
  });

  // Delete session
  registerIPCHandler('delete-session', async (_event, sessionId: string) => {
    try {
      const filePath = getSessionPath(sessionId);
      if (!filePath) {
        console.error('[Session] Invalid session ID:', sessionId);
        return false;
      }

      await fs.rm(filePath, { force: true });
      const prefix = `${sessionId}.artifact.`;
      const entries = await fs.readdir(SESSION_DIR).catch(() => [] as string[]);
      await Promise.all(entries
        .filter(entry => entry.startsWith(prefix) && entry.endsWith('.json'))
        .map(entry => fs.rm(path.join(SESSION_DIR, entry), { force: true })));
      return true;
    } catch (error) {
      console.error('[Session] Failed to delete session:', error);
      return false;
    }
  });
}
