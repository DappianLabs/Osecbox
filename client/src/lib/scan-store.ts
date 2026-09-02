// ScanStore - Holds full parsed scan data per tab
export interface ScanData {
  tabId: string;
  target: string;
  command: string;
  timestamp: number;
  total: number;
  live: number;
  dead: number;
  hosts: HostData[];
  commonPorts: string[];
  osTypes: string[];
}

export interface HostData {
  ip: string;
  hostname?: string;
  status: string;
  ports: string; // "22/ssh,80/http,443/https"
  os: string;
  services?: Record<string, string>;
  vulnerabilities?: string[];
}

class ScanStoreClass {
  private scans = new Map<string, ScanData>();
  private readonly STORAGE_KEY = 'osecbox-scan-data';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        Object.entries(data).forEach(([tabId, scanData]) => {
          this.scans.set(tabId, scanData as ScanData);
        });
      }
    } catch (error) {
      console.error('Failed to load scan data from storage:', error);
    }
  }

  private saveToStorage() {
    try {
      const data: Record<string, ScanData> = {};
      this.scans.forEach((scanData, tabId) => {
        data[tabId] = scanData;
      });
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save scan data to storage:', error);
    }
  }

  storeScan(tabId: string, scanData: ScanData) {
    this.scans.set(tabId, scanData);
    this.saveToStorage();
  }

  getScan(tabId: string): ScanData | null {
    return this.scans.get(tabId) || null;
  }

  getAll(): Record<string, ScanData> {
    return Object.fromEntries(this.scans.entries());
  }

  restore(data: unknown): void {
    this.scans.clear();
    if (!data || typeof data !== 'object') return;

    for (const [tabId, value] of Object.entries(data as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || !Array.isArray((value as ScanData).hosts)) continue;
      this.scans.set(tabId, value as ScanData);
    }
    this.saveToStorage();
  }

  getHost(tabId: string, ip: string): HostData | null {
    const scan = this.getScan(tabId);
    if (!scan) return null;
    return scan.hosts.find(h => h.ip === ip) || null;
  }

  filterHosts(tabId: string, predicate: (host: HostData) => boolean): HostData[] {
    const scan = this.getScan(tabId);
    if (!scan) return [];
    return scan.hosts.filter(predicate);
  }

  summarize(tabId: string): string {
    const scan = this.getScan(tabId);
    if (!scan) return 'No scan data available.';

    return JSON.stringify({
      target: scan.target,
      total: scan.total,
      live: scan.live,
      dead: scan.dead,
      commonPorts: scan.commonPorts,
      osTypes: scan.osTypes
    }, null, 2);
  }

  // Build compact summary (all hosts in pipe-delimited format)
  buildCompactSummary(tabId: string): string {
    const scan = this.getScan(tabId);
    if (!scan) return 'No scan data available.';

    const header = `SCAN: ${scan.target} | ${scan.live}/${scan.total} live | Common ports: ${scan.commonPorts.join(', ')}\n\n`;
    
    const hosts = scan.hosts
      .map(h => `${h.ip}|${h.hostname || 'unknown'}|p:${h.ports}|os:${h.os}|${h.status}`)
      .join('\n');
    
    return header + hosts;
  }

  // Get detailed host info (for AI follow-up requests)
  getHostDetails(tabId: string, ips: string[]): HostData[] {
    const scan = this.getScan(tabId);
    if (!scan) return [];
    
    return scan.hosts.filter(h => ips.includes(h.ip));
  }

  // Filter hosts by criteria (for AI follow-up requests)
  filterHostsByQuery(tabId: string, query: string): HostData[] {
    const scan = this.getScan(tabId);
    if (!scan) return [];

    const lowerQuery = query.toLowerCase();
    
    return scan.hosts.filter(h => {
      // Port filters
      if (lowerQuery.includes('rdp') || lowerQuery.includes('3389')) {
        return h.ports.includes('3389');
      }
      if (lowerQuery.includes('ssh') || lowerQuery.includes('22')) {
        return h.ports.includes('22');
      }
      if (lowerQuery.includes('http') || lowerQuery.includes('80')) {
        return h.ports.includes('80') || h.ports.includes('443');
      }
      
      // OS filters
      if (lowerQuery.includes('windows')) {
        return h.os.toLowerCase().includes('windows');
      }
      if (lowerQuery.includes('linux')) {
        return h.os.toLowerCase().includes('linux');
      }
      
      return false;
    });
  }

  chunk(tabId: string, predicate: (host: HostData) => boolean, chunkSize: number): HostData[][] {
    const hosts = this.filterHosts(tabId, predicate);
    const chunks: HostData[][] = [];
    
    for (let i = 0; i < hosts.length; i += chunkSize) {
      chunks.push(hosts.slice(i, i + chunkSize));
    }
    
    return chunks;
  }

  clear(tabId: string) {
    this.scans.delete(tabId);
    this.saveToStorage();
  }
}

export const ScanStore = new ScanStoreClass();
