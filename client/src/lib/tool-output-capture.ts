/**
 * Tool Output Capture
 *
 * Universal bridge that makes "listener"-based tool output visible to the AI.
 *
 * Subdomain tools (subfinder, amass, ffuf, assetfinder, sublist3r) and any other
 * long-running listener process stream their output to the renderer via the
 * `listener-output` IPC event instead of through a PTY. That means the normal
 * terminal-service command tracking never sees them, and they never reach the
 * attack-state command store the AI reads from.
 *
 * This module taps `listener-output` (plus `listener-exit` / `listener-closed`),
 * accumulates each run per listenerId, and on completion records a single,
 * ANSI-stripped entry into the attack-state command store. The store + AI
 * context builder handle truncation/compression, so this stays efficient even
 * for huge enumerations.
 */

import { terminalService } from './terminal-service';
import { cleanANSIForDisplay } from './utils/ansi-cleaner';

let isInitialized = false;

interface ListenerBuffer {
  chunks: string[];
  size: number;
  truncated: boolean;
  command: string | null;
  persistent: boolean;
  flushed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  generation: number;
  sessionId?: string;
  sessionTarget?: string;
  tabId?: string;
  terminalId?: string;
  target?: string;
  tool?: string;
  runId?: string;
  provenanceReady?: Promise<void>;
}

const buffers = new Map<string, ListenerBuffer>();
const invalidatedListenerIds = new Set<string>();
const flushedListenerIds = new Set<string>();
let captureGeneration = 0;

// Keep memory bounded; the store truncates further but cap here too.
const MAX_BUFFER_CHARS = 500_000;
const MAX_ACTIVE_BUFFERS = 128;
// If a listener goes quiet this long, assume the run finished even without an
// explicit exit/closed event so nothing is lost.
const IDLE_FLUSH_MS = 30_000;
// Ignore trivial output (banners, a couple of blank lines).
const MIN_MEANINGFUL_CHARS = 8;

function isAlreadyTrackedByTerminalService(listenerId: string): boolean {
  // All shell-backed terminals (scans, foothold listeners, and tunnels) are
  // already parsed by TerminalService's command tracker. Capturing their
  // listener-output stream here would duplicate every command and keep a
  // persistent listener buffer alive until app shutdown. Non-PTY child tools
  // such as subdomain enumerators use their own process id and remain covered.
  return listenerId === 'msf-console-persistent' || terminalService.hasPTY(listenerId);
}

function stripANSI(text: string): string {
  return cleanANSIForDisplay(text);
}

/**
 * Pull the echoed command (subdomain tools emit `\r\n$ <command>\r\n` first).
 */
function extractCommand(text: string): string | null {
  const match = text.match(/(?:^|\n)\s*\$\s+(.+)/);
  if (match && match[1]) {
    const cmd = match[1].trim();
    if (cmd.length > 1) return cmd;
  }
  return null;
}

function extractTargetFromCommand(command: string): string | undefined {
  const flagged = command.match(/(?:^|\s)(?:-h|-u|--url|--target|--domain)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const value = flagged?.[1] || flagged?.[2] || flagged?.[3];
  if (value && !value.startsWith('-')) return value.replace(/[;,]$/, '').toLowerCase();
  return undefined;
}

function isPersistentListener(listenerId: string, command: string | null): boolean {
  const normalizedId = listenerId.toLowerCase();
  const normalizedCommand = String(command || '').toLowerCase();

  // These processes are expected to remain quiet while waiting for a client.
  // They must be flushed by an explicit exit/close event, not by the evidence
  // batching timer. Subdomain sessions intentionally do not match this list.
  return /(?:^|[-_:])(listener|tunnel)(?:[-_:]|$)/i.test(normalizedId)
    || /\b(?:nc|ncat|netcat|pwncat(?:-cs)?|socat|chisel|ligolo(?:-ng)?|ngrok|sshuttle|msfconsole|meterpreter|sliver)\b/i.test(normalizedCommand)
    || /\b(?:python(?:3)?|php|ruby)\b[^\n]*\b(?:http\.server|-S)\b/i.test(normalizedCommand);
}

async function captureListenerProvenance(listenerId: string, generation: number, buffer: ListenerBuffer): Promise<void> {
  try {
    const [{ useAttackState }, { useFootholdStore }, { useTunnelingStore }] = await Promise.all([
      import('./attack-state-store'),
      import('./foothold-store'),
      import('./tunneling-store'),
    ]);
    if (generation !== captureGeneration || buffers.get(listenerId) !== buffer) return;

    const session = useAttackState.getState().session;
    buffer.sessionId = session?.id;
    buffer.sessionTarget = session?.target_ip;
    const routedTerminalId = terminalService.getExternalOutputRoute(listenerId);
    buffer.terminalId = buffer.terminalId || routedTerminalId;
    buffer.tabId = buffer.tabId
      || (routedTerminalId && !routedTerminalId.includes('::') ? routedTerminalId : undefined)
      || useFootholdStore.getState().tabs.find((tab: any) => tab.listeners?.some((item: any) => item.id === listenerId))?.id
      || useTunnelingStore.getState().tabs.find((tab: any) => tab.sessions?.some((item: any) => item.id === listenerId))?.id;
  } catch {
    // Provenance is enrichment; the immutable listener generation still keeps
    // a stale buffer from being assigned to a later session.
  }
}

function getBuffer(listenerId: string): ListenerBuffer {
  let buf = buffers.get(listenerId);
  if (!buf) {
    if (buffers.size >= MAX_ACTIVE_BUFFERS) {
      const oldest = Array.from(buffers.entries())
        .sort(([, left], [, right]) => left.lastActivity - right.lastActivity)[0];
      if (oldest) void flush(oldest[0], 1);
    }
    buf = {
      chunks: [],
      size: 0,
      truncated: false,
      command: null,
      persistent: isPersistentListener(listenerId, null),
      flushed: false,
      idleTimer: null,
      lastActivity: Date.now(),
      generation: captureGeneration,
      tabId: listenerId.includes('::') ? listenerId.split('::')[0] || undefined : undefined,
      terminalId: terminalService.getExternalOutputRoute(listenerId),
      runId: listenerId,
    };
    buffers.set(listenerId, buf);
    buf.provenanceReady = captureListenerProvenance(listenerId, buf.generation, buf);
  }
  return buf;
}

function appendOutput(listenerId: string, data: string): void {
  if (!data || isAlreadyTrackedByTerminalService(listenerId)) return;
  if (invalidatedListenerIds.has(listenerId) || terminalService.isExternalOutputRouteInvalidated(listenerId)) return;
  const buf = getBuffer(listenerId);

  buf.chunks.push(data);
  buf.size += data.length;
  buf.lastActivity = Date.now();

  if (!buf.command) {
    const cmd = extractCommand(stripANSI(data));
    if (cmd) {
      buf.command = cmd;
      buf.persistent = isPersistentListener(listenerId, cmd);
      buf.target = extractTargetFromCommand(cmd);
      buf.tool = cmd.match(/(?:^|\s)(?:sudo\s+)?([a-z][a-z0-9._-]*)/i)?.[1];
    }
  }

  // Bound memory: keep head + tail, drop the middle.
  if (buf.size > MAX_BUFFER_CHARS && (!buf.truncated || buf.size > MAX_BUFFER_CHARS * 1.25)) {
    const joined = buf.chunks.join('');
    const head = joined.slice(0, Math.floor(MAX_BUFFER_CHARS * 0.4));
    const tail = joined.slice(-Math.floor(MAX_BUFFER_CHARS * 0.5));
    const trimmed = `${head}\n...[middle truncated]...\n${tail}`;
    buf.chunks = [trimmed];
    buf.size = trimmed.length;
    buf.truncated = true;
  }

  // A completed enumeration can be missing an exit event, so retain the idle
  // fallback for ordinary tools. Persistent listeners intentionally stay open
  // until the process emits an explicit exit/close event.
  if (buf.idleTimer) clearTimeout(buf.idleTimer);
  buf.idleTimer = buf.persistent
    ? null
    : setTimeout(() => {
      void flush(listenerId, 0);
    }, IDLE_FLUSH_MS);
}

async function flush(listenerId: string, exitCode: number): Promise<boolean> {
  if (isAlreadyTrackedByTerminalService(listenerId)) return false;
  const buf = buffers.get(listenerId);
  if (!buf) return flushedListenerIds.has(listenerId);
  if (buf.flushed) return flushedListenerIds.has(listenerId);
  buf.flushed = true;

  if (buf.idleTimer) {
    clearTimeout(buf.idleTimer);
    buf.idleTimer = null;
  }

  await buf.provenanceReady;
  if (buf.generation !== captureGeneration) {
    buffers.delete(listenerId);
    return false;
  }

  const raw = buf.chunks.join('');
  const clean = stripANSI(raw).trim();

  // Done with this listener regardless of outcome.
  buffers.delete(listenerId);

  if (clean.length < MIN_MEANINGFUL_CHARS) return false;

  const command = buf.command || `tool output (${listenerId})`;

  try {
    const { useAttackState } = await import('./attack-state-store');
    const state = useAttackState.getState();
    const manager = state.manager;
    if (!manager || !buf.sessionId || manager.getSession?.().id !== buf.sessionId) return false;
    const provenance = await resolveListenerProvenance(listenerId, command, manager, buf);
    // Route through the store action so readiness/revision fencing covers
    // listener evidence just like scanner and terminal evidence.
    await state.processCommand(command, exitCode || 0, clean, '', 0, provenance);
    console.log(
      `[ToolOutputCapture] 📥 Recorded "${command.substring(0, 50)}" (${clean.length} bytes) from listener ${listenerId}`
    );
    flushedListenerIds.add(listenerId);
    while (flushedListenerIds.size > 512) {
      const oldest = flushedListenerIds.values().next().value;
      if (!oldest) break;
      flushedListenerIds.delete(oldest);
    }
    return true;
  } catch (error) {
    console.debug('[ToolOutputCapture] Failed to record tool output:', error);
    return false;
  }
}

export async function flushToolOutputCapture(listenerId: string, exitCode = 0): Promise<boolean> {
  return flush(listenerId, exitCode);
}

async function resolveListenerProvenance(
  listenerId: string,
  command: string,
  _manager: any,
  snapshot: ListenerBuffer,
): Promise<{
  sessionId?: string;
  tabId?: string;
  terminalId?: string;
  target?: string;
  tool?: string;
  runId?: string;
}> {
  const tool = snapshot.tool || command.match(/(?:^|\s)(?:sudo\s+)?([a-z][a-z0-9._-]*)/i)?.[1];
  const commandTarget = snapshot.target || extractTargetFromCommand(command);
  const routedTerminalId = terminalService.getExternalOutputRoute(listenerId);
  const terminalId = routedTerminalId || snapshot.terminalId || listenerId;
  return {
    // These values were captured when the listener buffer was created, not
    // resolved against whatever session happens to be active at flush time.
    sessionId: snapshot.sessionId,
    tabId: snapshot.tabId || (terminalId.includes('::') ? terminalId.split('::')[0] : terminalId),
    terminalId,
    target: commandTarget || snapshot.sessionTarget,
    tool,
    runId: snapshot.runId || listenerId,
  };
}

/** Invalidate listener buffers when the workspace/session identity changes. */
export function invalidateToolOutputCapture(): void {
  captureGeneration += 1;
  for (const [listenerId, buffer] of buffers) {
    invalidatedListenerIds.add(listenerId);
    if (buffer.idleTimer) clearTimeout(buffer.idleTimer);
  }
  buffers.clear();
  flushedListenerIds.clear();
  while (invalidatedListenerIds.size > 512) {
    const oldest = invalidatedListenerIds.values().next().value;
    if (!oldest) break;
    invalidatedListenerIds.delete(oldest);
  }
}

/**
 * Initialize the capture. Safe to call once; returns a cleanup function.
 */
export function initializeToolOutputCapture(): (() => void) | undefined {
  if (isInitialized) {
    console.log('[ToolOutputCapture] Already initialized');
    return;
  }

  // Access through an any-alias so this never depends on the renderer-side
  // Window.electron typing (web mode -> undefined; guarded below).
  const api = (window as any)?.electron;
  if (!api?.onListenerOutput) {
    console.warn('[ToolOutputCapture] Electron API not available');
    return;
  }

  isInitialized = true;
  console.log('[ToolOutputCapture] Initializing listener-output capture...');

  const cleanups: Array<() => void> = [];

  const offOutput = api.onListenerOutput((data: { listenerId: string; data: string; type: string }) => {
    if (data && typeof data.data === 'string') {
      appendOutput(data.listenerId, data.data);
    }
  });
  if (typeof offOutput === 'function') cleanups.push(offOutput);

  if (typeof api.onListenerExit === 'function') {
    const offExit = api.onListenerExit((data: { listenerId: string; exitCode?: number }) => {
      void flush(data.listenerId, data.exitCode ?? 0);
    });
    if (typeof offExit === 'function') cleanups.push(offExit);
  }

  if (typeof api.onListenerClosed === 'function') {
    const offClosed = api.onListenerClosed((data: { listenerId: string; code?: number }) => {
      void flush(data.listenerId, data.code ?? 0);
    });
    if (typeof offClosed === 'function') cleanups.push(offClosed);
  }

  if (typeof api.onListenerError === 'function') {
    const offError = api.onListenerError((data: { listenerId: string; error?: string }) => {
      const message = String(data?.error || 'listener process reported an error');
      appendOutput(data.listenerId, `[listener-error] ${message}\n`);
      void flush(data.listenerId, 1);
    });
    if (typeof offError === 'function') cleanups.push(offError);
  }

  console.log('[ToolOutputCapture] Initialized successfully');

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    invalidateToolOutputCapture();
    isInitialized = false;
  };
}
