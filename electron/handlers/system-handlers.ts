/**
 * System Information Handlers
 * Handles system detection
 */

import { app } from 'electron';

export function registerSystemHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  getSystemInfo: () => Promise<any>
) {
  // Get system information
  registerIPCHandler('get-system-info', async () => {
    return await getSystemInfo();
  });

  // Electron owns the renderer/utility process boundaries, so the renderer
  // terminal monitor cannot infer real RSS from JavaScript buffers alone.
  // Expose a sanitized working-set snapshot for health reporting.
  registerIPCHandler('get-app-memory', async () => {
    try {
      const metrics = app.getAppMetrics();
      const processes = metrics.map((metric: any) => ({
        pid: metric.pid,
        type: metric.type,
        workingSetBytes: Math.max(0, Number(metric.memory?.workingSetSize || 0) * 1024),
        privateBytes: Math.max(0, Number(metric.memory?.privateBytes || 0) * 1024),
        cpuPercent: Number(metric.cpu?.percentCPUUsage || 0),
      }));

      return {
        success: true,
        totalWorkingSetBytes: processes.reduce((total, process) => total + process.workingSetBytes, 0),
        processes,
      };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Process memory metrics unavailable' };
    }
  });
}
