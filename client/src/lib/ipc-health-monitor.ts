/**
 * IPC Health Monitor
 * 
 * Detects when Electron IPC channel dies (especially common with WSL2 + heavy PTY output).
 * Provides auto-reconnect and degraded state detection.
 */

import { IPC_HEALTH_CONSTANTS } from './constants';

export interface IPCHealth {
  status: 'online' | 'degraded' | 'offline';
  lastPing: number;
  lastPong: number;
  latency: number;
  failedPings: number;
  reconnectAttempts: number;
}

type IPCHealthCallback = (health: IPCHealth) => void;

class IPCHealthMonitor {
  private health: IPCHealth = {
    status: 'online',
    lastPing: Date.now(),
    lastPong: Date.now(),
    latency: 0,
    failedPings: 0,
    reconnectAttempts: 0,
  };
  
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private subscribers: Set<IPCHealthCallback> = new Set();
  private readonly MAX_SUBSCRIBERS = 100;
  
  constructor() {
    this.startMonitoring();
  }
  
  /**
   * Start health monitoring
   */
  private startMonitoring(): void {
    if (this.pingInterval) return;
    
    console.log('[IPCHealth] Starting IPC health monitoring');
    
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, IPC_HEALTH_CONSTANTS.PING_INTERVAL);
    
    // Send first ping immediately
    this.sendPing();
  }
  
  /**
   * Send ping to main process
   */
  private async sendPing(): Promise<void> {
    if (!window.electron) {
      this.markOffline('Electron API not available');
      return;
    }
    
    const pingTime = Date.now();
    this.health.lastPing = pingTime;
    
    // Set timeout for pong
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
    }
    
    this.pongTimeout = setTimeout(() => {
      this.handlePongTimeout();
    }, IPC_HEALTH_CONSTANTS.PONG_TIMEOUT);
    
    try {
      // Use a simple IPC call as ping
      await window.electron.invoke('ipc-health-ping');
      
      // Pong received
      const pongTime = Date.now();
      this.health.lastPong = pongTime;
      this.health.latency = pongTime - pingTime;
      this.health.failedPings = 0;
      
      // Clear timeout
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
      
      // Update status based on latency
      if (this.health.latency > IPC_HEALTH_CONSTANTS.DEGRADED_LATENCY) {
        this.updateStatus('degraded');
        console.warn(`[IPCHealth] Degraded: ${this.health.latency}ms latency`);
      } else {
        this.updateStatus('online');
        // Only log success in dev mode or on recovery
        if (this.health.status !== 'online' || this.health.reconnectAttempts > 0) {
          console.log(`[IPCHealth] ✅ Recovered: ${this.health.latency}ms`);
        }
      }
    } catch (error) {
      console.error('[IPCHealth] Ping failed:', error);
      this.health.failedPings++;
      
      if (this.health.failedPings >= IPC_HEALTH_CONSTANTS.MAX_FAILED_PINGS) {
        this.markOffline('Too many failed pings');
      } else {
        this.updateStatus('degraded');
      }
    }
  }
  
  /**
   * Handle pong timeout
   */
  private handlePongTimeout(): void {
    console.warn('[IPCHealth] Pong timeout - IPC channel may be dead');
    this.health.failedPings++;
    
    if (this.health.failedPings >= IPC_HEALTH_CONSTANTS.MAX_FAILED_PINGS) {
      this.markOffline('Pong timeout');
    } else {
      this.updateStatus('degraded');
    }
  }
  
  /**
   * Mark IPC as offline
   */
  private markOffline(reason: string): void {
    console.error(`[IPCHealth] IPC offline: ${reason}`);
    this.updateStatus('offline');
    
    // Attempt reconnect
    this.attemptReconnect();
  }
  
  /**
   * Attempt to reconnect
   */
  private async attemptReconnect(): Promise<void> {
    this.health.reconnectAttempts++;
    
    console.log(`[IPCHealth] Reconnect attempt ${this.health.reconnectAttempts}`);
    
    // Wait before retry (exponential backoff)
    const delay = Math.min(1000 * Math.pow(2, this.health.reconnectAttempts - 1), 30000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Try ping again
    this.sendPing();
  }
  
  /**
   * Update status and notify subscribers
   */
  private updateStatus(newStatus: IPCHealth['status']): void {
    if (newStatus !== this.health.status) {
      console.log(`[IPCHealth] Status change: ${this.health.status} -> ${newStatus}`);
      this.health.status = newStatus;
      
      // Reset reconnect attempts on recovery
      if (newStatus === 'online') {
        this.health.reconnectAttempts = 0;
      }
      
      this.notifySubscribers();
    }
  }
  
  /**
   * Subscribe to health changes
   */
  subscribe(callback: IPCHealthCallback): () => void {
    if (this.subscribers.size >= this.MAX_SUBSCRIBERS) {
      console.warn('[IPCHealth] Max subscribers reached, rejecting new subscription');
      return () => {};
    }
    
    this.subscribers.add(callback);
    
    // Send current health immediately
    callback(this.getHealth());
    
    return () => {
      this.subscribers.delete(callback);
    };
  }
  
  /**
   * Notify all subscribers
   */
  private notifySubscribers(): void {
    const health = this.getHealth();
    this.subscribers.forEach(callback => {
      try {
        callback(health);
      } catch (error) {
        console.error('[IPCHealth] Subscriber error:', error);
      }
    });
  }
  
  /**
   * Get current health
   */
  getHealth(): IPCHealth {
    return { ...this.health };
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    console.log('[IPCHealth] Stopped monitoring');
  }
  
  /**
   * Force reconnect
   */
  forceReconnect(): void {
    console.log('[IPCHealth] Force reconnect requested');
    this.health.failedPings = 0;
    this.health.reconnectAttempts = 0;
    this.sendPing();
  }
}

// Singleton instance
export const ipcHealthMonitor = new IPCHealthMonitor();

// Cleanup on unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    ipcHealthMonitor.stopMonitoring();
  });
}
