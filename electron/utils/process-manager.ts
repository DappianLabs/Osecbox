/**
 * Robust process management with zombie prevention
 * Ensures all child processes are properly cleaned up
 */

import { ChildProcess } from 'child_process';
import type { IPty } from 'node-pty';

interface ProcessEntry {
  process: ChildProcess | IPty;
  type: 'pty' | 'regular';
  createdAt: number;
  lastActivity: number;
  pid?: number;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Register a process for tracking
   */
  register(id: string, process: ChildProcess | IPty, type: 'pty' | 'regular' = 'regular'): void {
    const now = Date.now();
    const pid = 'pid' in process ? process.pid : undefined;
    
    this.processes.set(id, {
      process,
      type,
      createdAt: now,
      lastActivity: now,
      pid
    });

    // Remove naturally exited children from the registry. PTYs expose an
    // onExit callback instead of ChildProcess's exit event. The identity check
    // prevents a late event from an older process generation removing a newer
    // process that reused the same id.
    const removeIfCurrent = () => {
      if (this.processes.get(id)?.process === process) {
        this.processes.delete(id);
      }
    };
    if (type === 'pty' && typeof (process as any).onExit === 'function') {
      (process as any).onExit(removeIfCurrent);
    } else if (typeof (process as any).once === 'function') {
      (process as any).once('exit', removeIfCurrent);
    }
    
    console.log(`[ProcessManager] Registered ${type} process: ${id} (PID: ${pid})`);
  }

  /**
   * Remove a process from tracking without terminating it. This is used by
   * owners that receive the process completion event themselves.
   */
  unregister(id: string, process?: ChildProcess | IPty): void {
    const entry = this.processes.get(id);
    if (!entry || (process && entry.process !== process)) return;
    this.processes.delete(id);
  }

  /**
   * Update activity timestamp
   */
  updateActivity(id: string): void {
    const entry = this.processes.get(id);
    if (entry) {
      entry.lastActivity = Date.now();
    }
  }

  /**
   * Kill a specific process
   */
  async kill(id: string): Promise<boolean> {
    const entry = this.processes.get(id);
    if (!entry) return false;

    try {
      await this.killProcess(entry);
      this.processes.delete(id);
      console.log(`[ProcessManager] Killed process: ${id}`);
      return true;
    } catch (error) {
      console.error(`[ProcessManager] Failed to kill ${id}:`, error);
      return false;
    }
  }

  /**
   * Kill all processes
   */
  async killAll(): Promise<void> {
    console.log(`[ProcessManager] Killing ${this.processes.size} processes`);
    
    const killPromises = Array.from(this.processes.entries()).map(([id, entry]) =>
      this.killProcess(entry).catch(err => {
        console.error(`[ProcessManager] Failed to kill ${id}:`, err);
      })
    );
    
    await Promise.all(killPromises);
    this.processes.clear();
    console.log('[ProcessManager] All processes killed');
  }

  /**
   * Kill a single process with verification
   */
  private async killProcess(entry: ProcessEntry): Promise<void> {
    const { process, type, pid } = entry;
    
    if (type === 'pty' && 'kill' in process) {
      // PTY process - IPty has different API
      try {
        (process as IPty).kill();
      } catch (error) {
        console.error('[ProcessManager] Error killing PTY:', error);
      }
      return;
    }
    
    // Regular child process
    if (!('kill' in process)) return;
    
    const childProcess = process as ChildProcess;
    
    // Try graceful termination
    childProcess.kill('SIGTERM');
    
    // Wait for process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still alive
        if (pid && this.isProcessAlive(pid)) {
          console.warn(`[ProcessManager] Force killing PID ${pid}`);
          try {
            childProcess.kill('SIGKILL');
            // Final fallback: system kill
            setTimeout(() => {
              if (this.isProcessAlive(pid)) {
                this.systemKill(pid);
              }
            }, 500);
          } catch {}
        }
        resolve();
      }, 2000);
      
      childProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Check if process is still alive
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // Signal 0 checks existence
      return true;
    } catch {
      return false;
    }
  }

  /**
   * System-level kill (last resort)
   */
  private systemKill(pid: number): void {
    if (process.platform === 'win32') return; // No kill command on Windows
    
    try {
      require('child_process').execSync(`kill -9 ${pid}`, { timeout: 1000 });
    } catch {}
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactive();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Cleanup inactive processes
   */
  private cleanupInactive(): void {
    const now = Date.now();
    const toCleanup: string[] = [];
    
    for (const [id, entry] of this.processes.entries()) {
      const age = now - entry.lastActivity;
      if (age > this.TTL) {
        toCleanup.push(id);
      }
    }
    
    if (toCleanup.length > 0) {
      console.log(`[ProcessManager] Cleaning up ${toCleanup.length} inactive processes`);
      toCleanup.forEach(id => this.kill(id));
    }
  }

  /**
   * Stop cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get process count
   */
  getCount(): number {
    return this.processes.size;
  }

  /**
   * Get all process IDs
   */
  getProcessIds(): string[] {
    return Array.from(this.processes.keys());
  }
}

// Singleton instance
export const processManager = new ProcessManager();
