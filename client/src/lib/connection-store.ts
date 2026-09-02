import { create } from 'zustand';

export type ConnectionRole = 'local' | 'vpn' | 'foothold' | 'pivot' | 'listener';
export type ConnectionMethod = 'ssh' | 'reverse' | 'msf' | 'nc' | 'socat' | 'chisel' | 'ligolo' | 'sshuttle' | 'ngrok';

export interface ConnectionNode {
  id: string;
  ip?: string;
  port?: string;
  role: ConnectionRole;
  method?: ConnectionMethod;
  terminalId: string;
  parentId?: string;
  createdAt: number;
  metadata?: {
    user?: string;
    hostname?: string;
    interface?: string;
    subnet?: string;
  };
}

interface ConnectionStore {
  // Record of terminalId -> ConnectionNode[]
  connections: Record<string, ConnectionNode[]>;
  
  // Add connection
  addConnection: (connection: ConnectionNode) => void;
  
  // Remove connection
  removeConnection: (terminalId: string, connectionId: string) => void;
  
  // Get all connections for a terminal
  getTerminalConnections: (terminalId: string) => ConnectionNode[];
  
  // Get latest connection for a terminal
  getLatestConnection: (terminalId: string) => ConnectionNode | null;
  
  // Get all active connections (latest per terminal)
  getAllActiveConnections: () => ConnectionNode[];
  
  // Clear all connections for a terminal
  clearTerminalConnections: (terminalId: string) => void;
  
  // Clear all connections
  clearAll: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: {},
  
  addConnection: (connection) => {
    set((state) => {
      const terminalConnections = state.connections[connection.terminalId] || [];
      
      // Check for duplicate (same IP/port/method in last 5 seconds)
      const isDuplicate = terminalConnections.some(
        (c) =>
          c.ip === connection.ip &&
          c.port === connection.port &&
          c.method === connection.method &&
          Date.now() - c.createdAt < 5000
      );
      
      if (!isDuplicate) {
        console.log('[ConnectionStore] Added connection:', connection);
        return {
          connections: {
            ...state.connections,
            [connection.terminalId]: [...terminalConnections, connection],
          },
        };
      }
      
      return state;
    });
  },
  
  removeConnection: (terminalId, connectionId) => {
    set((state) => {
      const terminalConnections = state.connections[terminalId] || [];
      return {
        connections: {
          ...state.connections,
          [terminalId]: terminalConnections.filter((c) => c.id !== connectionId),
        },
      };
    });
  },
  
  getTerminalConnections: (terminalId) => {
    return get().connections[terminalId] || [];
  },
  
  getLatestConnection: (terminalId) => {
    const connections = get().connections[terminalId] || [];
    if (connections.length === 0) return null;
    return connections[connections.length - 1];
  },
  
  getAllActiveConnections: () => {
    const { connections } = get();
    const activeConnections: ConnectionNode[] = [];
    
    Object.values(connections).forEach((terminalConnections) => {
      if (terminalConnections.length > 0) {
        activeConnections.push(terminalConnections[terminalConnections.length - 1]);
      }
    });
    
    // Sort by creation time (most recent first)
    return activeConnections.sort((a, b) => b.createdAt - a.createdAt);
  },
  
  clearTerminalConnections: (terminalId) => {
    set((state) => {
      const newConnections = { ...state.connections };
      delete newConnections[terminalId];
      return { connections: newConnections };
    });
  },
  
  clearAll: () => {
    set({ connections: {} });
  },
}));
