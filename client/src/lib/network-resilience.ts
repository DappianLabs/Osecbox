/**
 * Network Resilience Manager
 * Handles network failures, reconnections, and offline mode
 */

export type NetworkStatus = 'online' | 'degraded' | 'offline' | 'reconnecting';

export interface NetworkHealth {
  status: NetworkStatus;
  lastCheck: number;
  latency: number; // ms
  packetLoss: number; // percentage
  vpnConnected: boolean;
  labConnected: boolean;
  retryCount: number;
  lastError?: string;
}

class NetworkResilienceManager {
  private health: NetworkHealth = {
    status: 'online',
    lastCheck: Date.now(),
    latency: 0,
    packetLoss: 0,
    vpnConnected: false,
    labConnected: false,
    retryCount: 0,
  };
  
  private checkInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private listeners: Set<(health: NetworkHealth) => void> = new Set();
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  
  // Configuration
  private readonly CHECK_INTERVAL = 10000; // 10s
  private readonly PING_TIMEOUT = 5000; // 5s
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff
  
  constructor() {
    // Electron already owns connectivity for the features that need it
    // (AI, updates, and tool execution). The browser-style 10s monitor is a
    // no-op in desktop mode and only adds timer/event-loop work.
    if (!(typeof window !== 'undefined' && (window as any).electron)) {
      this.startMonitoring();
    }
    this.setupEventListeners();
  }
  
  /**
   * Start network monitoring
   */
  private startMonitoring(): void {
    if (this.checkInterval) return;
    
    // Initial check
    this.checkNetwork();
    
    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkNetwork();
    }, this.CHECK_INTERVAL);
  }
  
  /**
   * Setup browser event listeners
   */
  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;
    
    // Create bound handlers
    this.onlineHandler = () => {
      console.log('[NetworkResilience] Browser online event');
      this.handleOnline();
    };
    
    this.offlineHandler = () => {
      console.log('[NetworkResilience] Browser offline event');
      this.handleOffline();
    };
    
    this.visibilityHandler = () => {
      if (!document.hidden) {
        console.log('[NetworkResilience] Tab became visible, checking network');
        this.checkNetwork();
      }
    };
    
    // Add listeners
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }
  
  /**
   * Check network connectivity
   */
  private async checkNetwork(): Promise<void> {
    // ELECTRON: Skip network checks - desktop app doesn't need internet connectivity
    // The app works offline and only needs network for specific features (AI, updates)
    this.health.status = 'online';
    this.health.latency = 0;
    this.health.retryCount = 0;
    this.health.lastError = undefined;
    this.health.lastCheck = Date.now();
    this.notifyListeners();
  }
  
  /**
   * Ping check using fetch with timeout
   */
  private async pingCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.PING_TIMEOUT);
      
      // Try to fetch a small resource
      const response = await fetch('https://1.1.1.1', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      return true;
    } catch (error) {
      // Offline or timeout
      return false;
    }
  }
  
  /**
   * Handle online event
   */
  private handleOnline(): void {
    this.health.status = 'online';
    this.health.retryCount = 0;
    this.checkNetwork();
  }
  
  /**
   * Handle offline event
   */
  private handleOffline(): void {
    this.health.status = 'offline';
    this.health.lastError = 'Network disconnected';
    this.notifyListeners();
    
    // Start reconnection attempts
    this.attemptReconnect();
  }
  
  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.health.status === 'online') return;
    if (this.health.retryCount >= this.MAX_RETRIES) {
      console.log('[NetworkResilience] Max retries reached, giving up');
      return;
    }
    
    const delay = this.RETRY_DELAYS[this.health.retryCount] || 30000;
    this.health.status = 'reconnecting';
    this.health.retryCount++;
    this.notifyListeners();
    
    console.log(`[NetworkResilience] Reconnect attempt ${this.health.retryCount}/${this.MAX_RETRIES} in ${delay}ms`);
    
    this.reconnectTimeout = setTimeout(async () => {
      await this.checkNetwork();
      
      if (this.health.status !== 'online') {
        this.attemptReconnect();
      }
    }, delay);
  }
  
  /**
   * Check VPN connection
   */
  async checkVPN(): Promise<boolean> {
    if (typeof window === 'undefined' || !(window as any).electron) {
      return false;
    }
    
    try {
      const isWindows = (window as any).electron.platform === 'win32';
      // executeCommand is intentionally shell-free. Probe fallback interfaces
      // as separate argv commands rather than relying on `||` shell syntax.
      const commands = isWindows
        ? ['ipconfig']
        : ['ip addr show tun0', 'ip addr show tap0', 'ifconfig tun0', 'ifconfig tap0'];
      let output = '';
      for (const command of commands) {
        const result = await (window as any).electron.executeCommand(command);
        output += `${result?.output || ''}\n${result?.error || ''}\n`;
      }

      const connected = /(?:tun0|tap0|openvpn|\bVPN\b|TAP-Windows|TUN)/i.test(output);
      this.health.vpnConnected = connected;
      this.notifyListeners();

      return connected;
    } catch (error) {
      this.health.vpnConnected = false;
      return false;
    }
  }
  
  /**
   * Check HTB lab connection
   */
  async checkLabConnection(targetIP: string): Promise<boolean> {
    if (typeof window === 'undefined' || !(window as any).electron) {
      return false;
    }
    
    try {
      const normalizedTarget = typeof targetIP === 'string' ? targetIP.trim() : '';
      // Keep the target a single hostname/IP token; the backend parser rejects
      // shell syntax, but rejecting flag-like or whitespace-containing values
      // here gives callers a deterministic false result.
      if (!normalizedTarget
        || normalizedTarget.startsWith('-')
        || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(normalizedTarget)) {
        this.health.labConnected = false;
        this.notifyListeners();
        return false;
      }

      const isWindows = (window as any).electron.platform === 'win32';
      const command = isWindows
        ? `ping -n 1 -w 2000 ${normalizedTarget}`
        : `ping -c 1 -W 2 ${normalizedTarget}`;
      const result = await (window as any).electron.executeCommand(command);

      const connected = result?.success === true && result?.exitCode === 0;
      this.health.labConnected = connected;
      this.notifyListeners();

      return connected;
    } catch (error) {
      this.health.labConnected = false;
      return false;
    }
  }
  
  /**
   * Subscribe to network health changes
   */
  subscribe(listener: (health: NetworkHealth) => void): () => void {
    this.listeners.add(listener);
    
    // Immediately notify with current state
    listener(this.health);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }
  
  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener({ ...this.health });
      } catch (error) {
        console.error('[NetworkResilience] Listener error:', error);
      }
    });
  }
  
  /**
   * Get current network health
   */
  getHealth(): NetworkHealth {
    return { ...this.health };
  }
  
  /**
   * Force network check
   */
  async forceCheck(): Promise<void> {
    await this.checkNetwork();
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Remove event listeners
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) {
        window.removeEventListener('online', this.onlineHandler);
        this.onlineHandler = null;
      }
      if (this.offlineHandler) {
        window.removeEventListener('offline', this.offlineHandler);
        this.offlineHandler = null;
      }
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
      }
    }
  }
}

// Singleton instance
export const networkResilience = new NetworkResilienceManager();
