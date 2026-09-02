/**
 * Shared cleanup for terminal-backed listener and tunnel sessions.
 *
 * Section stores can outlive their React views, so cleanup must happen at the
 * lifecycle boundary (close/reset/remove), not only from a mounted view.
 */
import { terminalService } from '@/lib/terminal-service';

export function cleanupTerminalSession(sessionId: string): void {
  if (!sessionId) return;

  terminalService.cancelPendingWrites(sessionId);
  // TerminalService owns backend termination and renderer cleanup together.
  // Keeping this as one call prevents the old double-stop race.
  terminalService.destroyTerminal(sessionId);
  terminalService.destroyPTY(sessionId);
}

export function cleanupTerminalSessions(sessionIds: string[]): void {
  for (const sessionId of new Set(sessionIds)) {
    cleanupTerminalSession(sessionId);
  }
}
