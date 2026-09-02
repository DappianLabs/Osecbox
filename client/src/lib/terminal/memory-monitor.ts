/**
 * Memory Monitor - Tracks terminal system resource usage
 */

import { logger } from '@/lib/utils/logger';
import { TERMINAL_CONSTANTS } from '@/lib/constants';

export interface MemoryStats {
  totalBufferMemory: number;
  estimatedScrollbackMemory: number;
  totalTrackedMemory: number;
  observedProcessMemory: number;
  pressureSource: 'tracked-terminal-memory' | 'electron-working-set';
  totalTerminals: number;
  totalPTYs: number;
  totalIPCHandlers: number;
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

export class MemoryMonitor {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL = 30000; // 30 seconds
  private readonly MEMORY_THRESHOLDS = {
    medium: 100 * 1024 * 1024, // 100MB
    high: 250 * 1024 * 1024,   // 250MB
    critical: 500 * 1024 * 1024, // 500MB
  };

  startMonitoring(getStats: () => any, getProcessMemory?: () => Promise<any>): void {
    if (this.monitoringInterval) {
      return;
    }

    logger.info('MemoryMonitor', 'Starting memory monitoring');

    let sampleInFlight = false;
    this.monitoringInterval = setInterval(() => {
      if (sampleInFlight) return;
      sampleInFlight = true;
      try {
        void (async () => {
          const processMemory = getProcessMemory ? await getProcessMemory().catch(() => null) : null;
          const stats = { ...getStats(), processMemory };
          const memoryStats = this.analyzeMemoryUsage(stats);
        
          if (memoryStats.memoryPressure !== 'low') {
            logger.warn('MemoryMonitor', `Memory pressure: ${memoryStats.memoryPressure}`, {
              totalMemory: memoryStats.totalTrackedMemory,
              observedProcessMemory: memoryStats.observedProcessMemory,
              terminals: memoryStats.totalTerminals,
              ptys: memoryStats.totalPTYs,
              recommendations: memoryStats.recommendations,
            });
          }

          // Log detailed stats every 5 minutes
          if (Date.now() % (5 * 60 * 1000) < this.MONITORING_INTERVAL) {
            this.logDetailedStats(stats);
          }
        })().catch((error) => {
          logger.error('MemoryMonitor', 'Monitoring error', error);
        }).finally(() => {
          sampleInFlight = false;
        });
      } catch (error) {
        logger.error('MemoryMonitor', 'Monitoring error', error);
        sampleInFlight = false;
      }
    }, this.MONITORING_INTERVAL);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('MemoryMonitor', 'Stopped memory monitoring');
    }
  }

  analyzeMemoryUsage(stats: any): MemoryStats {
    const bufferMemory = stats.bufferManager?.totalMemoryBytes || 0;
    const estimatedScrollbackMemory = stats.terminalRenderer?.estimatedScrollbackBytes || 0;
    const totalTrackedMemory = bufferMemory + estimatedScrollbackMemory;
    const observedProcessMemory = Math.max(0, Number(stats.processMemory?.totalWorkingSetBytes || 0));
    const pressureMemory = observedProcessMemory > 0 ? observedProcessMemory : totalTrackedMemory;
    const pressureSource = observedProcessMemory > 0
      ? 'electron-working-set'
      : 'tracked-terminal-memory';
    const terminals = stats.terminalRenderer?.totalTerminals || 0;
    const ptys = stats.ptyManager || 0;
    const handlers = stats.ipcHandler?.totalHandlers || 0;

    let memoryPressure: MemoryStats['memoryPressure'] = 'low';
    const recommendations: string[] = [];

    if (pressureMemory > this.MEMORY_THRESHOLDS.critical) {
      memoryPressure = 'critical';
      recommendations.push('CRITICAL: Tracked terminal memory exceeds 500MB - immediate cleanup required');
      recommendations.push('Consider reducing terminal buffer size in settings');
      recommendations.push('Close unused terminals and PTYs');
    } else if (pressureMemory > this.MEMORY_THRESHOLDS.high) {
      memoryPressure = 'high';
      recommendations.push('High tracked terminal memory - consider cleanup');
      recommendations.push('Review active terminals and close unused ones');
    } else if (pressureMemory > this.MEMORY_THRESHOLDS.medium) {
      memoryPressure = 'medium';
      recommendations.push('Moderate memory usage - monitor closely');
    }

    recommendations.push('Tracked memory excludes Electron and WSL child-process RSS');

    // Check for resource leaks
    if (terminals > TERMINAL_CONSTANTS.MAX_TERMINALS) {
      recommendations.push(`Too many terminals: ${terminals}/${TERMINAL_CONSTANTS.MAX_TERMINALS}`);
    }

    if (ptys > TERMINAL_CONSTANTS.MAX_PTYS) {
      recommendations.push(`Too many PTYs: ${ptys}/${TERMINAL_CONSTANTS.MAX_PTYS}`);
    }

    if (handlers > ptys + 5) {
      recommendations.push(`Potential IPC handler leak: ${handlers} handlers for ${ptys} PTYs`);
    }

    return {
      totalBufferMemory: bufferMemory,
      estimatedScrollbackMemory,
      totalTrackedMemory,
      observedProcessMemory,
      pressureSource,
      totalTerminals: terminals,
      totalPTYs: ptys,
      totalIPCHandlers: handlers,
      memoryPressure,
      recommendations,
    };
  }

  private logDetailedStats(stats: any): void {
    logger.info('MemoryMonitor', 'Detailed terminal system stats', {
      bufferManager: stats.bufferManager,
      terminalRenderer: stats.terminalRenderer,
      scrollManager: stats.scrollManager,
      ipcHandler: stats.ipcHandler,
      mappings: stats.mappings,
    });
  }

  formatMemorySize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }

  getMemoryReport(stats: any): string {
    const memoryStats = this.analyzeMemoryUsage(stats);
    
    let report = `Terminal Memory Report:\n`;
    report += `- Buffer Memory: ${this.formatMemorySize(memoryStats.totalBufferMemory)}\n`;
    report += `- Estimated xterm Scrollback: ${this.formatMemorySize(memoryStats.estimatedScrollbackMemory)}\n`;
    report += `- Total Tracked Memory: ${this.formatMemorySize(memoryStats.totalTrackedMemory)}\n`;
    report += `- Electron Working Set: ${this.formatMemorySize(memoryStats.observedProcessMemory)}\n`;
    report += `- Pressure Source: ${memoryStats.pressureSource}\n`;
    report += `- Terminals: ${memoryStats.totalTerminals}/${TERMINAL_CONSTANTS.MAX_TERMINALS}\n`;
    report += `- PTYs: ${memoryStats.totalPTYs}/${TERMINAL_CONSTANTS.MAX_PTYS}\n`;
    report += `- IPC Handlers: ${memoryStats.totalIPCHandlers}\n`;
    report += `- Memory Pressure: ${memoryStats.memoryPressure.toUpperCase()}\n`;
    
    if (memoryStats.recommendations.length > 0) {
      report += `\nRecommendations:\n`;
      memoryStats.recommendations.forEach(rec => {
        report += `- ${rec}\n`;
      });
    }
    
    return report;
  }
}
