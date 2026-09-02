// Scheduler & Timeline Service - Manages scheduled scans

export type ToolType = 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'metasploit';

export interface ScheduledScan {
  id: string;
  name: string;
  tool: ToolType; // Tool type for multi-tool support
  target: string;
  flags: string;
  schedule: string; // cron format: "0 2 * * *"
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
  createdBy: 'user' | 'ai';
  metadata?: {
    endHour?: number;
    endMinute?: number;
    duration?: string;
    [key: string]: any;
  };
}

export type ScheduledScanUpdates = Partial<Omit<ScheduledScan, 'id' | 'createdAt'>>;

export interface TimelineEvent {
  id: string;
  scanId: string;
  scanName?: string;
  tool?: ToolType;
  target?: string;
  timestamp: number;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  result?: any;
}

type CronField = number | '*';

interface ParsedCronSchedule {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface SchedulerToolExecution {
  processId: string;
  cancel: () => void;
}

interface CompletionListener {
  cleanup: () => void;
  cancel: () => void;
}

interface InFlightScheduledScan {
  runId: string;
  sessionId?: string;
  cancelled: boolean;
  event?: TimelineEvent;
  execution?: SchedulerToolExecution;
  cancel: () => void;
}

class SchedulerService {
  private scheduledScans: Map<string, ScheduledScan> = new Map();
  private timeline: TimelineEvent[] = [];
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private scanExecutor: ((target: string, flags: string[]) => Promise<string>) | null = null;
  private readonly MAX_SCHEDULED_SCANS = 100;
  private readonly MAX_TIMELINE_EVENTS = 1000;
  private readonly CANCEL_DRAIN_MS = 900;
  private executorInitialized = false;
  private completionListeners = new Map<string, CompletionListener>();
  private inFlightScans = new Map<string, InFlightScheduledScan>();

  // Add a scheduled scan
  addScheduledScan(scan: Omit<ScheduledScan, 'id' | 'createdAt'>): ScheduledScan {
    if (!this.isValidCronSchedule(scan.schedule)) {
      throw new Error(`Invalid cron schedule: ${String(scan.schedule)}`);
    }

    if (this.scheduledScans.size >= this.MAX_SCHEDULED_SCANS) {
      throw new Error(`Maximum scheduled scans (${this.MAX_SCHEDULED_SCANS}) reached. Delete old scans first.`);
    }
    
    const id = `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const scheduledScan: ScheduledScan = {
      ...scan,
      id,
      createdAt: Date.now(),
    };

    this.scheduledScans.set(id, scheduledScan);
    
    if (scan.enabled) {
      this.startSchedule(scheduledScan);
    }

    // Persist to localStorage
    this.persist();

    return scheduledScan;
  }

  // Remove a scheduled scan
  removeScheduledScan(id: string): boolean {
    this.stopSchedule(id);
    this.cancelInFlightScan(id, 'Scheduled scan was removed');
    const deleted = this.scheduledScans.delete(id);
    
    if (deleted) {
      this.persist();
    }

    return deleted;
  }

  // Update a scheduled scan. Identity fields are owned by the scheduler and
  // cannot be changed by a partial update, even if a stale caller includes
  // them at runtime.
  updateScheduledScan(id: string, updates: ScheduledScanUpdates): boolean {
    const scan = this.scheduledScans.get(id);
    if (!scan || !updates || typeof updates !== 'object') return false;

    const allowedKeys = new Set<keyof ScheduledScanUpdates>([
      'name', 'tool', 'target', 'flags', 'schedule', 'enabled',
      'lastRun', 'nextRun', 'createdBy', 'metadata',
    ]);
    const safeUpdates: ScheduledScanUpdates = {};
    for (const key of Object.keys(updates) as Array<keyof ScheduledScanUpdates>) {
      if (allowedKeys.has(key)) {
        (safeUpdates as any)[key] = (updates as any)[key];
      }
    }

    if (safeUpdates.schedule !== undefined && !this.isValidCronSchedule(safeUpdates.schedule)) {
      console.error('[Scheduler] Refusing invalid cron schedule:', safeUpdates.schedule);
      return false;
    }

    const executionChanged = safeUpdates.tool !== undefined ||
      safeUpdates.target !== undefined || safeUpdates.flags !== undefined;
    if (executionChanged) {
      this.cancelInFlightScan(id, 'Scheduled scan definition changed');
    }

    const updated: ScheduledScan = {
      ...scan,
      ...safeUpdates,
      id: scan.id,
      createdAt: scan.createdAt,
    };
    this.scheduledScans.set(id, updated);

    // Any schedule-defining change must restart the timer. Editing a target,
    // tool, or flags also retires the old in-flight process before the new
    // definition can run, preventing old output from being attributed to it.
    const scheduleChanged = safeUpdates.enabled !== undefined ||
      safeUpdates.schedule !== undefined || executionChanged;
    if (scheduleChanged) {
      if (updated.enabled) this.startSchedule(updated);
      else {
        this.stopSchedule(id);
        this.cancelInFlightScan(id, 'Scheduled scan was disabled');
      }
    }

    this.persist();
    return true;
  }

  // Get all scheduled scans
  getAllScheduledScans(): ScheduledScan[] {
    return Array.from(this.scheduledScans.values());
  }

  // Get timeline events
  getTimeline(limit?: number): TimelineEvent[] {
    const sorted = [...this.timeline].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // Manually trigger a scan now (for testing)
  async triggerScanNow(scanId: string): Promise<boolean> {
    const scan = this.scheduledScans.get(scanId);
    if (!scan) return false;
    return this.executeScan(scan);
  }

  // Start a schedule
  private startSchedule(scan: ScheduledScan) {
    // Stop existing schedule if any
    this.stopSchedule(scan.id);

    // Parse cron and calculate next run
    const nextRun = this.calculateNextRun(scan.schedule);
    
    if (!nextRun) {
      console.error('Invalid cron schedule:', scan.schedule);
      return;
    }

    // Update next run time
    scan.nextRun = nextRun;
    this.scheduledScans.set(scan.id, scan);

    // Set interval to check every 5 seconds for precise timing
    const interval = setInterval(() => {
      const now = Date.now();
      const currentScan = this.scheduledScans.get(scan.id);
      
      if (!currentScan || !currentScan.enabled) {
        this.stopSchedule(scan.id);
        return;
      }

      if (currentScan.nextRun && now >= currentScan.nextRun) {
        // Advance the occurrence before starting the job. If a manual or
        // previous timer run is still active, this skips the overlapping
        // occurrence instead of queueing an unbounded backlog.
        const newNextRun = this.calculateNextRun(currentScan.schedule);
        currentScan.nextRun = newNextRun || undefined;
        currentScan.lastRun = now;
        this.scheduledScans.set(scan.id, currentScan);
        this.persist();

        if (this.inFlightScans.has(scan.id)) {
          console.warn(`[Scheduler] Skipping overlapping scheduled run: ${scan.id}`);
          return;
        }

        void this.executeScan(currentScan);
      }
    }, 5000); // Check every 5 seconds for better precision

    this.intervals.set(scan.id, interval);
  }

  // Stop a schedule
  private stopSchedule(id: string) {
    const interval = this.intervals.get(id);
    
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }

  // Set scan executor (called from nmap context)
  setScanExecutor(executor: (target: string, flags: string[]) => Promise<string>) {
    this.scanExecutor = executor;
    this.executorInitialized = true;
  }

  // Initialize executor directly without scanner context dependency
  async initializeExecutor() {
    if (this.executorInitialized) {
      return;
    }

    if (typeof window === 'undefined' || !window.electron) {
      console.error('[Scheduler] Electron API not available');
      return;
    }

    // DEPRECATED: Legacy executor for backwards compatibility (nmap only)
    // This is kept for any code that still uses setScanExecutor()
    this.scanExecutor = async (target: string, flags: string[]): Promise<string> => {
      return this.executeToolScan('nmap', target, flags);
    };
    
    this.executorInitialized = true;
    console.log('[Scheduler] Standalone executor initialized');
  }

  // Universal tool executor supporting all 5 tools
  private async executeToolScan(
    tool: ToolType,
    target: string,
    flags: string[],
    onExecutionCreated?: (execution: SchedulerToolExecution) => void,
  ): Promise<string> {
    if (typeof window === 'undefined' || !window.electron) {
      throw new Error('Electron API not available');
    }
    if (tool !== 'nmap' && flags.length > 0) {
      throw new Error(`Custom flags are not supported for scheduled ${tool} scans`);
    }

    const electron = window.electron;
    return new Promise((resolve, reject) => {
      const scanId = `scheduled-${tool}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const electronScanId = tool === 'nmap' ? `scan-${scanId}` : scanId;

      console.log(`[Scheduler] Executing ${tool} scan: ${target} with flags: ${flags.join(' ')}`);

      // Capture output in a local buffer
      const outputChunks: string[] = [];
      let outputSize = 0;
      const appendOutput = (data: string) => {
        if (!data) return;
        outputChunks.push(data);
        outputSize += data.length;
        if (outputSize > 8 * 1024 * 1024) {
          const joined = outputChunks.join('');
          const head = joined.slice(0, 4 * 1024 * 1024);
          const tail = joined.slice(-3 * 1024 * 1024);
          outputChunks.length = 0;
          outputChunks.push(`${head}\n...[output truncated]...\n${tail}`);
          outputSize = outputChunks[0].length;
        }
      };
      const getOutput = () => outputChunks.join('');
      let outputCleanup: (() => void) | null = null;
      let completionCleanup: (() => void) | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let cancelDrainTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let cleaned = false;
      let processCancelRequested = false;

      const removeListenerEntry = () => {
        const entry = this.completionListeners.get(electronScanId);
        if (entry?.cleanup === cleanup) {
          this.completionListeners.delete(electronScanId);
        }
      };

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (cancelDrainTimer) {
          clearTimeout(cancelDrainTimer);
          cancelDrainTimer = null;
        }
        try {
          outputCleanup?.();
        } catch (error) {
          console.debug('[Scheduler] Output listener cleanup failed:', error);
        }
        try {
          completionCleanup?.();
        } catch (error) {
          console.debug('[Scheduler] Completion listener cleanup failed:', error);
        }
        outputCleanup = null;
        completionCleanup = null;
        removeListenerEntry();
      };

      const toError = (error: any, fallback: string): Error =>
        error instanceof Error
          ? error
          : new Error(error?.error || error?.message || String(error || fallback));

      const settleResolve = (result: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const settleReject = (error: unknown, partialOutput?: string, drainMs = 0) => {
        if (settled) return;
        settled = true;
        const normalizedError = error instanceof Error
          ? error
          : new Error(String(error));
        const finalizeRejection = () => {
          cancelDrainTimer = null;
          cleanup();
          const errorOutput = error && typeof error === 'object'
            ? String((error as any).partialOutput || (error as any).output || '')
            : '';
          const capturedOutput = partialOutput || errorOutput || getOutput();
          if (capturedOutput.trim()) {
            (normalizedError as Error & { partialOutput?: string }).partialOutput = capturedOutput;
          }
          reject(normalizedError);
        };

        if (drainMs > 0) {
          // Keep output listeners alive briefly after Ctrl+C/timeout. Electron
          // can deliver the terminating stderr and final tool tail after the
          // cancellation request resolves.
          cancelDrainTimer = setTimeout(finalizeRejection, drainMs);
        } else {
          finalizeRejection();
        }
      };

      const cancel = () => {
        if (settled) return;
        if (!processCancelRequested) {
          processCancelRequested = true;
          this.cancelElectronProcess(tool, electronScanId);
        }
        settleReject(new Error(`${tool} scan cancelled`), undefined, this.CANCEL_DRAIN_MS);
      };

      const registerExecution = () => {
        this.completionListeners.set(electronScanId, { cleanup, cancel });
        timeoutId = setTimeout(() => {
          if (settled) return;
          if (!processCancelRequested) {
            processCancelRequested = true;
            this.cancelElectronProcess(tool, electronScanId);
          }
          settleReject(new Error(`${tool} scan timeout after 10 minutes`), undefined, this.CANCEL_DRAIN_MS);
        }, 600000); // 10 minute timeout

        try {
          onExecutionCreated?.({ processId: electronScanId, cancel });
        } catch (error) {
          settleReject(error);
          return false;
        }
        return !settled;
      };

      const invoke = (
        operation: () => Promise<any>,
        failureMessage: string,
        onSuccess?: (result: any) => void,
        requireSuccess = false,
      ) => {
        if (settled) return;
        try {
          Promise.resolve(operation())
            .then((result: any) => {
              if (requireSuccess && !result?.success) {
                settleReject(new Error(result?.error || failureMessage), result?.output || result?.stderr);
                return;
              }
              if (result && result.success === false) {
                settleReject(new Error(result.error || failureMessage), result.output || result.stderr);
                return;
              }
              if (onSuccess) {
                if (result?.success) {
                  onSuccess(result);
                } else {
                  settleReject(new Error(result?.error || failureMessage));
                }
              }
            })
            .catch((error: any) => settleReject(toError(error, failureMessage)));
        } catch (error) {
          settleReject(toError(error, failureMessage));
        }
      };

      // Setup tool-specific output and completion handlers. Missing APIs are
      // rejected synchronously so a schedule cannot sit until the timeout.
      switch (tool) {
        case 'nmap':
          if (
            typeof electron.onNmapOutput !== 'function' ||
            typeof electron.onNmapComplete !== 'function' ||
            typeof electron.executeNmap !== 'function'
          ) {
            settleReject(new Error('Nmap scheduler APIs are unavailable'));
            return;
          }

          outputCleanup = electron.onNmapOutput((data: { scanId: string; data: string }) => {
            if (!cleaned && data.scanId === electronScanId) {
              appendOutput(data.data);
            }
          });

          completionCleanup = electron.onNmapComplete((data: { scanId: string; code: number }) => {
            if (settled || data.scanId !== electronScanId) return;
            if (data.code === 0) {
              settleResolve(getOutput() || 'Scan completed');
            } else {
              settleReject(new Error(`Nmap scan failed with exit code ${data.code}`));
            }
          });

          if (!registerExecution()) return;
          invoke(
            () => electron.executeNmap({ target, flags, scanId: electronScanId, captureOutput: false }),
            'Nmap execution failed',
            undefined,
            true,
          );
          break;

        case 'nikto':
          if (typeof electron.onNiktoOutput !== 'function' || typeof electron.executeNikto !== 'function') {
            settleReject(new Error('Nikto scheduler APIs are unavailable'));
            return;
          }

          outputCleanup = electron.onNiktoOutput((data: { toolId: string; data: string }) => {
            if (!cleaned && data.toolId === electronScanId) {
              appendOutput(data.data);
            }
          });
          if (!registerExecution()) return;
          invoke(
            () => electron.executeNikto({ target, toolId: electronScanId }),
            'Nikto execution failed',
            (result) => settleResolve(getOutput() || result.output || 'Nikto scan completed'),
          );
          break;

        case 'nuclei':
          if (typeof electron.onNucleiOutput !== 'function' || typeof electron.executeNuclei !== 'function') {
            settleReject(new Error('Nuclei scheduler APIs are unavailable'));
            return;
          }

          outputCleanup = electron.onNucleiOutput((data: { toolId: string; data: string }) => {
            if (!cleaned && data.toolId === electronScanId) {
              appendOutput(data.data);
            }
          });
          if (!registerExecution()) return;
          invoke(
            () => electron.executeNuclei({ target, toolId: electronScanId }),
            'Nuclei execution failed',
            (result) => settleResolve(getOutput() || result.output || 'Nuclei scan completed'),
          );
          break;

        case 'dirbuster':
          if (typeof electron.onGobusterOutput !== 'function' || typeof electron.executeGobuster !== 'function') {
            settleReject(new Error('Gobuster scheduler APIs are unavailable'));
            return;
          }

          outputCleanup = electron.onGobusterOutput((data: { toolId: string; data: string }) => {
            if (!cleaned && data.toolId === electronScanId) {
              appendOutput(data.data);
            }
          });
          if (!registerExecution()) return;
          invoke(
            () => electron.executeGobuster({ target, toolId: electronScanId }),
            'Gobuster execution failed',
            (result) => settleResolve(getOutput() || result.output || 'Gobuster scan completed'),
          );
          break;

        case 'metasploit':
          settleReject(new Error('Metasploit automation not yet supported - requires interactive session management'));
          break;

        default:
          settleReject(new Error(`Unknown tool type: ${tool}`));
      }
    });
  }

  // Request cancellation only for a known process ID and the matching tool API.
  private cancelElectronProcess(tool: ToolType, processId: string): void {
    if (!processId || typeof window === 'undefined' || !window.electron) return;

    try {
      const cancel = tool === 'nmap'
        ? window.electron.cancelScan
        : window.electron.cancelTool;
      if (typeof cancel !== 'function') return;

      Promise.resolve(cancel(processId)).catch((error: any) => {
        console.debug(`[Scheduler] Failed to cancel ${tool} process ${processId}:`, error);
      });
    } catch (error) {
      console.debug(`[Scheduler] Failed to request ${tool} cancellation:`, error);
    }
  }

  // Cleanup completion listener to prevent memory leaks
  private cleanupListener(scanId: string): void {
    this.completionListeners.get(scanId)?.cleanup();
  }

  private cancelListener(scanId: string): void {
    this.completionListeners.get(scanId)?.cancel();
  }

  private cancelInFlightScan(scanId: string, reason: string): void {
    const inFlight = this.inFlightScans.get(scanId);
    if (!inFlight) return;

    inFlight.cancel();
    if (inFlight.event && this.timeline.includes(inFlight.event)) {
      inFlight.event.status = 'failed';
      inFlight.event.result = { error: reason };
    }
    this.inFlightScans.delete(scanId);
  }

  private isCurrentRun(scanId: string, runId: string): boolean {
    const inFlight = this.inFlightScans.get(scanId);
    return Boolean(inFlight && !inFlight.cancelled && inFlight.runId === runId);
  }

  private async recordScheduledResult(
    scan: ScheduledScan,
    runId: string,
    output: string,
    expectedSessionId?: string,
    allowCancelled = false,
  ): Promise<boolean> {
    const boundedOutput = output.length <= 150_000
      ? output
      : `${output.slice(0, 24_000)}\n...[scheduled output bounded]...\n${output.slice(-120_000)}`;
    if (!boundedOutput.trim()) return false;

    try {
      const { useAttackState } = await import('./attack-state-store');
      const state = useAttackState.getState();
      const active = this.inFlightScans.get(scan.id);
      if (
        !expectedSessionId
        || !state.session
        || state.session.id !== expectedSessionId
        || (!allowCancelled && active && active.runId !== runId)
        || (!allowCancelled && !this.isCurrentRun(scan.id, runId))
      ) return false;

      const committed = await state.processScannerResults(scan.target, {
        scannerType: scan.tool,
        results: [],
        command: `${scan.tool} ${scan.target}${scan.flags ? ` ${scan.flags}` : ''}`,
        output: boundedOutput,
        timestamp: Date.now(),
        target: scan.target,
        sessionId: expectedSessionId,
        terminalId: `scheduled:${scan.id}`,
        tool: scan.tool,
        runId,
        scheduledScanId: scan.id,
      });
      return committed !== false;
    } catch (error) {
      // Scheduler completion must remain visibly unindexed rather than being
      // reported as a successful run when the AI evidence projection failed.
      console.warn('[Scheduler] Failed to record scheduled result in attack state:', error);
      return false;
    }
  }

  // Execute a scan
  private async executeScan(scan: ScheduledScan): Promise<boolean> {
    if (this.inFlightScans.has(scan.id)) {
      console.warn(`[Scheduler] Refusing overlapping scan run: ${scan.id}`);
      return false;
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const inFlight = {
      runId,
      cancelled: false,
      cancel: () => {
        if (inFlight.cancelled) return;
        inFlight.cancelled = true;
        inFlight.execution?.cancel();
      },
    } as InFlightScheduledScan;
    this.inFlightScans.set(scan.id, inFlight);

    const event: TimelineEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      scanId: scan.id,
      scanName: scan.name,
      tool: scan.tool,
      target: scan.target,
      timestamp: Date.now(),
      status: 'running',
    };
    inFlight.event = event;

    // FIX: Add to beginning of timeline (newest first), then trim old events
    this.timeline.unshift(event);
    if (this.timeline.length > this.MAX_TIMELINE_EVENTS) {
      this.timeline = this.timeline.slice(0, this.MAX_TIMELINE_EVENTS);
    }
    this.persist();

    // Show toast notification for scan start
    this.showToast(`Starting scheduled ${scan.tool} scan: ${scan.name}`, 'info');

    try {
      console.log(`🔍 Executing scheduled ${scan.tool} scan:`, scan.name, scan.target);

      // Capture session ownership before any async executor setup. A canceled
      // run may finish after its registry entry is removed, so the evidence
      // recorder needs an immutable session identity of its own.
      try {
        const { useAttackState } = await import('./attack-state-store');
        inFlight.sessionId = useAttackState.getState().session?.id;
      } catch (error) {
        console.debug('[Scheduler] Could not capture scheduled scan session:', error);
      }
      if (!this.isCurrentRun(scan.id, runId)) return false;

      // FIX: Initialize executor if not already initialized
      if (!this.scanExecutor) {
        await this.initializeExecutor();
      }
      if (!this.isCurrentRun(scan.id, runId)) return false;

      if (!this.scanExecutor) {
        throw new Error('Scan executor not initialized - Electron API may not be available');
      }

      // Preserve the existing space-delimited flag contract. The direct
      // non-Nmap APIs do not accept custom flags, so reject them explicitly.
      const flagsArray = String(scan.flags ?? '').split(' ').filter(f => f.length > 0);
      if (scan.tool !== 'nmap' && flagsArray.length > 0) {
        throw new Error(`Custom flags are not supported for scheduled ${scan.tool} scans`);
      }

      // Execute the scan using the tool-specific executor
      const result = await this.executeToolScan(
        scan.tool,
        scan.target,
        flagsArray,
        (execution) => {
          inFlight.execution = execution;
          if (!this.isCurrentRun(scan.id, runId)) {
            execution.cancel();
          }
        },
      );

      // A canceled/removed run cannot update a later run's event or persist
      // stale state after clear/remove has completed.
      if (!this.isCurrentRun(scan.id, runId)) return false;

      const evidenceCommitted = await this.recordScheduledResult(scan, runId, result, inFlight.sessionId);
      if (!this.isCurrentRun(scan.id, runId)) return false;
      if (!evidenceCommitted) {
        event.status = 'failed';
        event.result = { error: 'Scan completed but evidence was not indexed' };
        this.showToast(`Scheduled ${scan.tool} scan finished without indexed evidence: ${scan.name}`, 'error');
        return true;
      }

      // FIX: Validate result before marking as completed
      if (result && result.length > 0) {
        event.status = 'completed';
        event.result = { success: true, output: result };
        this.showToast(`Scheduled ${scan.tool} scan completed: ${scan.name}`, 'success');
      } else {
        event.status = 'failed';
        event.result = { error: 'Scan produced no output' };
        console.warn(`⚠️ Scheduled ${scan.tool} scan completed but produced no output:`, scan.name);
        this.showToast(`Scheduled ${scan.tool} scan completed with no output: ${scan.name}`, 'error');
      }
      return true;
    } catch (error: any) {
      console.error(`❌ Scheduled ${scan.tool} scan failed:`, error);
      const partialOutput = typeof error?.partialOutput === 'string'
        ? error.partialOutput
        : '';
      if (partialOutput.trim()) {
        // Allow a canceled run to retain its own partial evidence, but the
        // recorder still rejects a newer run or a replaced session.
        await this.recordScheduledResult(scan, runId, partialOutput, inFlight.sessionId, true);
      }
      if (!this.isCurrentRun(scan.id, runId)) return false;

      event.status = 'failed';
      event.result = { error: error?.message || String(error) };

      // Show error toast
      this.showToast(`Scheduled ${scan.tool} scan failed: ${scan.name} - ${event.result.error}`, 'error');
      return true;
    } finally {
      if (this.inFlightScans.get(scan.id)?.runId === runId) {
        this.inFlightScans.delete(scan.id);
      }
      this.persist();
    }
  }

  // Helper to show toast notifications
  private showToast(message: string, type: 'success' | 'error' | 'info') {
    // Access toast from window if available
    if (typeof window !== 'undefined') {
      // FIX: Use the actual notification store
      import('./notification-store').then(({ useNotificationStore }) => {
        const { addNotification } = useNotificationStore.getState();
        addNotification({
          title: type === 'success' ? 'Scheduled Scan' : type === 'error' ? 'Scan Failed' : 'Scan Started',
          message,
          type,
          duration: type === 'error' ? 8000 : 5000,
        });
      }).catch((error) => {
        console.error('[Scheduler] Failed to show toast:', error);
        // Fallback: log to console
        console.log(`[Scheduler Toast] ${type.toUpperCase()}: ${message}`);
      });
    }
  }

  private parseCronSchedule(cronSchedule: unknown): ParsedCronSchedule | null {
    if (typeof cronSchedule !== 'string' || cronSchedule.trim().length === 0) return null;

    const parts = cronSchedule.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const ranges: Array<[number, number]> = [
      [0, 59], // minute
      [0, 23], // hour
      [1, 31], // day of month
      [1, 12], // month
      [0, 6],  // JavaScript day of week (Sunday = 0)
    ];
    const fields: Array<CronField | null> = parts.map((part, index) => {
      if (part === '*') return '*';
      if (!/^\d+$/.test(part)) return null;

      const value = Number(part);
      const [minimum, maximum] = ranges[index];
      return Number.isSafeInteger(value) && value >= minimum && value <= maximum
        ? value
        : null;
    });

    if (fields.some(field => field === null)) return null;
    return {
      minute: fields[0] as CronField,
      hour: fields[1] as CronField,
      day: fields[2] as CronField,
      month: fields[3] as CronField,
      dayOfWeek: fields[4] as CronField,
    };
  }

  private isValidCronSchedule(cronSchedule: unknown): cronSchedule is string {
    return this.parseCronSchedule(cronSchedule) !== null;
  }

  // Calculate next run time from cron
  private calculateNextRun(cronSchedule: string): number | null {
    try {
      // Simple cron parser for common patterns
      // Format: "minute hour day month dayOfWeek"
      // Example: "0 2 * * *" = 2:00 AM daily
      // Example: "36 4 * * 1" = 4:36 AM every Monday
      const parsed = this.parseCronSchedule(cronSchedule);
      if (!parsed) return null;

      const { minute, hour, day, month, dayOfWeek } = parsed;
      const now = new Date();
      let next = new Date(now);

      // Set time precisely
      const targetHour = hour !== '*' ? hour : now.getHours();
      const targetMinute = minute !== '*' ? minute : now.getMinutes();

      next.setHours(targetHour);
      next.setMinutes(targetMinute);
      next.setSeconds(0);
      next.setMilliseconds(0);

      // FIX: Improved logic for finding next occurrence
      // If time has passed today, move to next valid occurrence
      if (next <= now) {
        // Move to next day first
        next.setDate(next.getDate() + 1);
      }

      // FIX: Handle day of week constraint
      if (dayOfWeek !== '*') {
        const targetDay = dayOfWeek;
        let attempts = 0;

        // Find next matching day of week (max 7 attempts)
        while (next.getDay() !== targetDay && attempts < 7) {
          next.setDate(next.getDate() + 1);
          attempts++;
        }

        if (attempts >= 7) {
          console.error('[Scheduler] Failed to find matching day of week');
          return null;
        }
      }

      // FIX: Handle day of month constraint
      if (day !== '*') {
        const targetDayOfMonth = day;
        let attempts = 0;

        // Find next matching day of month (max 31 attempts)
        while (next.getDate() !== targetDayOfMonth && attempts < 31) {
          next.setDate(next.getDate() + 1);
          attempts++;
        }

        if (attempts >= 31) {
          console.error('[Scheduler] Failed to find matching day of month');
          return null;
        }
      }

      // FIX: Handle month constraint
      if (month !== '*') {
        const targetMonth = month - 1; // JavaScript months are 0-indexed
        let attempts = 0;

        // Find next matching month (max 12 attempts)
        while (next.getMonth() !== targetMonth && attempts < 12) {
          next.setMonth(next.getMonth() + 1);
          attempts++;
        }

        if (attempts >= 12) {
          console.error('[Scheduler] Failed to find matching month');
          return null;
        }
      }

      console.log(`[Scheduler] Next run calculated: ${next.toLocaleString()} for cron: ${cronSchedule}`);
      return next.getTime();
    } catch (error) {
      console.error('Error parsing cron:', error);
      return null;
    }
  }

  // Persist to localStorage
  private persist() {
    try {
      const data = {
        scans: Array.from(this.scheduledScans.entries()),
        timeline: this.timeline,
      };
      localStorage.setItem('nmap-scheduler', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to persist scheduler data:', error);
    }
  }

  // Load from localStorage
  load() {
    try {
      const data = localStorage.getItem('nmap-scheduler');
      
      if (data) {
        const parsed = JSON.parse(data);
        
        // Restore scheduled scans, dropping entries that cannot be represented
        // by the supported strict five-field parser.
        if (Array.isArray(parsed.scans)) {
          const validEntries: Array<[string, ScheduledScan]> = [];
          for (const entry of parsed.scans) {
            if (!Array.isArray(entry) || entry.length !== 2) continue;
            const [id, scan] = entry;
            if (typeof id !== 'string' || !scan || !this.isValidCronSchedule(scan.schedule)) {
              console.warn('[Scheduler] Skipping invalid persisted schedule:', scan?.schedule);
              continue;
            }
            validEntries.push([id, scan as ScheduledScan]);
          }

          this.scheduledScans = new Map(validEntries);

          // Restart enabled schedules
          Array.from(this.scheduledScans.values()).forEach(scan => {
            if (scan.enabled) {
              this.startSchedule(scan);
            }
          });
        }

        // Restore timeline
        if (parsed.timeline) {
          this.timeline = parsed.timeline;
        }
      }
    } catch (error) {
      console.error('Failed to load scheduler data:', error);
    }
  }

  // Clear all
  clear() {
    // Stop all schedules
    Array.from(this.intervals.keys()).forEach(id => {
      this.stopSchedule(id);
    });

    // Cancel active scheduled jobs before dropping their bookkeeping. Each
    // job owns an idempotent listener/process cleanup path.
    Array.from(this.inFlightScans.keys()).forEach(id => {
      this.cancelInFlightScan(id, 'Scheduler was cleared');
    });
    Array.from(this.completionListeners.keys()).forEach(scanId => {
      this.cancelListener(scanId);
    });
    this.completionListeners.clear();
    this.inFlightScans.clear();

    this.scheduledScans.clear();
    this.timeline = [];
    localStorage.removeItem('nmap-scheduler');
  }
  
  // Cleanup method for proper shutdown
  destroy() {
    console.log('[Scheduler] Destroying scheduler service');
    this.clear();
    this.scanExecutor = null;
    this.executorInitialized = false;
  }
}

export const Scheduler = new SchedulerService();

// Auto-load scheduled scans from localStorage on app start
if (typeof window !== 'undefined') {
  // FIX: Initialize executor immediately when scheduler loads
  Scheduler.initializeExecutor().catch((error) => {
    console.error('[Scheduler] Failed to initialize executor:', error);
  });
  
  Scheduler.load();
}
