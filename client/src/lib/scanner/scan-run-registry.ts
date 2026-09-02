/**
 * Coordinates the lifecycle of scanner runs.
 *
 * A tab keeps one terminal per scanner, so a rerun can replace an older run
 * without replacing the terminal itself. Keeping the monitor handle outside
 * React state prevents stale intervals from surviving tab switches or being
 * serialized into a saved session.
 */

interface ActiveScanRun {
  runId: string;
  workspaceGeneration: number;
  sessionId?: string;
  target?: string;
  cleanup?: () => void;
  /**
   * Boundary of the transcript that belongs to this run. Scanner terminals are
   * intentionally reusable, so a new run must not parse completion markers or
   * findings left by an earlier run.
   */
  outputOffset?: number;
  outputMarker?: string;
}

const activeRuns = new Map<string, ActiveScanRun>();
const latestRunIds = new Map<string, string>();
const latestRunGenerations = new Map<string, number>();
let workspaceGeneration = 0;

function createRunId(terminalId: string): string {
  return `${terminalId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

/** Start (or replace) the run associated with a scanner terminal. */
export function beginScanRun(
  terminalId: string,
  metadata: { sessionId?: string; target?: string } = {},
): string {
  cancelScanRun(terminalId);

  const runId = createRunId(terminalId);
  latestRunIds.set(terminalId, runId);
  latestRunGenerations.set(terminalId, workspaceGeneration);
  activeRuns.set(terminalId, {
    runId,
    workspaceGeneration,
    sessionId: metadata.sessionId,
    target: metadata.target,
  });
  return runId;
}

/** Return the run currently owning a scanner terminal, if any. */
export function getScanRunId(terminalId: string): string | undefined {
  return activeRuns.get(terminalId)?.runId;
}

/** Return the session captured when the current run was started. */
export function getScanRunSessionId(terminalId: string): string | undefined {
  return activeRuns.get(terminalId)?.sessionId;
}

/** Return the target captured when the current run was started. */
export function getScanRunTarget(terminalId: string): string | undefined {
  return activeRuns.get(terminalId)?.target;
}

/** Attach monitor cleanup after the monitor has created its timers. */
export function registerScanRunCleanup(
  terminalId: string,
  runId: string,
  cleanup: () => void
): boolean {
  const active = activeRuns.get(terminalId);
  if (!active || active.runId !== runId) return false;

  active.cleanup = cleanup;
  return true;
}

/** Record the retained-transcript boundary for the current run. */
export function setScanRunOutputBoundary(
  terminalId: string,
  runId: string,
  outputOffset: number,
  outputMarker?: string,
): boolean {
  const active = activeRuns.get(terminalId);
  if (!active || active.runId !== runId) return false;

  active.outputOffset = Math.max(0, Math.floor(outputOffset));
  active.outputMarker = outputMarker;
  return true;
}

export function getScanRunOutputOffset(terminalId: string): number | undefined {
  return activeRuns.get(terminalId)?.outputOffset;
}

export function getScanRunOutputMarker(terminalId: string): string | undefined {
  return activeRuns.get(terminalId)?.outputMarker;
}

export function isLatestScanRun(terminalId: string, runId: string): boolean {
  return latestRunIds.get(terminalId) === runId &&
    latestRunGenerations.get(terminalId) === workspaceGeneration;
}

export function isScanRunCurrent(terminalId: string, runId: string): boolean {
  const active = activeRuns.get(terminalId);
  return active?.runId === runId && active.workspaceGeneration === workspaceGeneration;
}

/** Return whether a run currently owns this terminal. */
export function hasActiveScanRun(terminalId: string): boolean {
  return activeRuns.has(terminalId);
}

/** Finish a run only if it is still the current run for this terminal. */
export function finishScanRun(terminalId: string, runId: string): void {
  const active = activeRuns.get(terminalId);
  if (!active || active.runId !== runId) return;

  active.cleanup?.();
  activeRuns.delete(terminalId);
}

/** Cancel a run and its monitor without touching the terminal/PTY itself. */
export function cancelScanRun(terminalId: string): void {
  const active = activeRuns.get(terminalId);
  if (!active) return;

  active.cleanup?.();
  activeRuns.delete(terminalId);
}

/** Cancel all scanner runs belonging to a tab. */
export function cancelScanRunsForTab(tabId: string): void {
  for (const terminalId of activeRuns.keys()) {
    if (terminalId.startsWith(`${tabId}::`)) {
      cancelScanRun(terminalId);
    }
  }
}

/** Current scanner workspace generation. A new provider/session must not
 * publish results from a prior generation even if a promise resolves late. */
export function getScanWorkspaceGeneration(): number {
  return workspaceGeneration;
}

/** Invalidate every scanner run during a workspace/provider transition. */
export function invalidateScanWorkspace(): void {
  workspaceGeneration += 1;
  for (const terminalId of Array.from(activeRuns.keys())) {
    cancelScanRun(terminalId);
  }
  latestRunIds.clear();
  latestRunGenerations.clear();
}

/** Test/diagnostic helper; intentionally returns a small count only. */
export function getActiveScanRunCount(): number {
  return activeRuns.size;
}
