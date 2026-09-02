/**
 * Topology Auto-Mapper
 *
 * Converts active listeners, tunnels, tracked connections, and scan results
 * into a validated transient topology. Store IDs are independent namespaces;
 * the scanner tab is therefore only a requested scope, not a key that can be
 * looked up blindly in foothold/tunneling stores.
 */

import { useFootholdStore, Listener } from './foothold-store';
import { useTunnelingStore, TunnelingSession } from './tunneling-store';
import { useConnectionStore, ConnectionNode } from './connection-store';

export interface TopologyNode {
  id: string;
  type: 'attacker' | 'target' | 'pivot' | 'listener' | 'tunnel';
  label: string;
  ip?: string;
  port?: string;
  status: 'active' | 'inactive' | 'unknown';
  metadata: {
    tool?: string;
    command?: string;
    terminalId?: string;
    createdAt: number;
    customName?: string;
  };
  position?: { x: number; y: number };
}

export interface TopologyConnection {
  id: string;
  from: string;
  to: string;
  type: 'listener' | 'tunnel' | 'ssh' | 'reverse-shell' | 'pivot' | 'scan';
  label?: string;
  bidirectional?: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, 4096) : undefined;
}

function safeId(value: unknown): string | undefined {
  if (typeof value === 'string') return safeText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function safePort(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return safeText(value);
}

function sourceArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueNodes(nodes: TopologyNode[]): TopologyNode[] {
  const byId = new Map<string, TopologyNode>();
  for (const node of nodes) {
    if (node.id) byId.set(node.id, node);
  }
  return Array.from(byId.values());
}

function uniqueConnections(connections: TopologyConnection[], nodeIds: Set<string>): TopologyConnection[] {
  const byId = new Map<string, TopologyConnection>();
  for (const connection of connections) {
    if (!connection.id || !nodeIds.has(connection.from) || !nodeIds.has(connection.to)) continue;
    byId.set(connection.id, connection);
  }
  return Array.from(byId.values());
}

export class TopologyAutoMapper {
  /** Generate topology nodes from running listeners in the selected infrastructure scope. */
  static generateListenerNodes(listeners: Listener[], _tabId?: string): TopologyNode[] {
    const seenIds = new Set<string>();
    return sourceArray(listeners).flatMap(listener => {
      const id = safeId(listener.id);
      if (!id || listener.status !== 'running') return [];
      const nodeId = `listener-${id}`;
      if (seenIds.has(nodeId)) return [];
      seenIds.add(nodeId);
      const type = safeText(listener.type) || 'listener';
      const port = safePort(listener.port);
      return [{
        id: nodeId,
        type: 'listener' as const,
        label: safeText(listener.name) || `${type} :${port || 'unknown'}`,
        port,
        status: 'active' as const,
        metadata: {
          tool: type,
          command: safeText(listener.command),
          terminalId: id,
          createdAt: Date.now(),
          customName: safeText(listener.name),
        },
      }];
    });
  }

  /** Generate topology nodes from running tunnels in the selected infrastructure scope. */
  static generateTunnelNodes(sessions: TunnelingSession[], _tabId?: string): TopologyNode[] {
    const seenIds = new Set<string>();
    return sourceArray(sessions).flatMap(session => {
      const id = safeId(session.id);
      if (!id || session.status !== 'running') return [];
      const nodeId = `tunnel-${id}`;
      if (seenIds.has(nodeId)) return [];
      seenIds.add(nodeId);
      const tool = safeText(session.tool) || 'tunnel';
      const mode = safeText(session.mode) || 'unknown';
      return [{
        id: nodeId,
        type: 'tunnel' as const,
        label: safeText(session.name) || `${tool} ${mode}`,
        ip: safeText(session.remoteHost),
        port: safePort(session.port),
        status: 'active' as const,
        metadata: {
          tool,
          command: safeText(session.command),
          terminalId: id,
          createdAt: Date.now(),
          customName: safeText(session.name),
        },
      }];
    });
  }

  /** Generate topology nodes from validated connection tracking data. */
  static generateConnectionNodes(connections: ConnectionNode[]): TopologyNode[] {
    const seenIds = new Set<string>();
    return sourceArray(connections).flatMap(connection => {
      const id = safeId(connection.id);
      const terminalId = safeId(connection.terminalId);
      if (!id || !terminalId) return [];
      const nodeId = `connection-${id}`;
      if (seenIds.has(nodeId)) return [];
      seenIds.add(nodeId);
      const role = safeText(connection.role);
      const method = safeText(connection.method);
      const metadata = isRecord(connection.metadata) ? connection.metadata : {};
      return [{
        id: nodeId,
        type: role === 'listener' ? 'listener' : role === 'pivot' ? 'pivot' : 'target',
        label: safeText(metadata.hostname) || safeText(connection.ip) || 'Unknown',
        ip: safeText(connection.ip),
        port: safePort(connection.port),
        status: 'active' as const,
        metadata: {
          tool: method,
          terminalId,
          createdAt: typeof connection.createdAt === 'number' && Number.isFinite(connection.createdAt)
            ? connection.createdAt
            : Date.now(),
        },
      }];
    });
  }

  /** Generate validated target nodes from scan results. */
  static generateScanNodes(scanResults: unknown[]): TopologyNode[] {
    const seenIPs = new Set<string>();
    return sourceArray(scanResults).flatMap(result => {
      const ip = safeText(result.ip);
      if (!ip) return [];
      const key = ip.toLowerCase();
      if (seenIPs.has(key)) return [];
      seenIPs.add(key);
      const status = result.status === 'up' ? 'active' : result.status === 'down' ? 'inactive' : 'unknown';
      return [{
        id: `scan-${ip}`,
        type: 'target' as const,
        label: safeText(result.hostname) || ip,
        ip,
        status,
        metadata: { createdAt: Date.now() },
      }];
    });
  }

  /** Connect the attacker scope to each host represented by a scan result. */
  static generateScanConnections(scanResults: unknown[], nodeIds?: Set<string>): TopologyConnection[] {
    const generated: TopologyConnection[] = [];
    const seenIds = new Set<string>();
    for (const node of this.generateScanNodes(scanResults)) {
      if ((nodeIds && !nodeIds.has(node.id)) || seenIds.has(node.id)) continue;
      seenIds.add(node.id);
      generated.push({
        id: `conn-scan-${encodeURIComponent(node.id).slice(0, 240)}`,
        from: 'attacker',
        to: node.id,
        type: 'scan',
        label: `Scanned ${node.ip || node.label}`,
      });
    }
    return generated;
  }

  /** Generate deduplicated edges whose endpoints are in the generated node namespace. */
  static generateConnections(
    listeners: Listener[],
    tunnels: TunnelingSession[],
    connections: ConnectionNode[],
  ): TopologyConnection[] {
    const runningListeners = sourceArray(listeners).filter(listener => listener.status === 'running' && safeId(listener.id));
    const runningTunnels = sourceArray(tunnels).filter(tunnel => tunnel.status === 'running' && safeId(tunnel.id));
    const validConnections = sourceArray(connections).filter(connection => safeId(connection.id) && safeId(connection.terminalId));
    const knownNodeIds = new Set<string>(['attacker']);
    for (const listener of runningListeners) knownNodeIds.add(`listener-${safeId(listener.id)}`);
    for (const tunnel of runningTunnels) knownNodeIds.add(`tunnel-${safeId(tunnel.id)}`);
    for (const connection of validConnections) knownNodeIds.add(`connection-${safeId(connection.id)}`);

    const generated: TopologyConnection[] = [];
    const seenIds = new Set<string>();
    const add = (connection: TopologyConnection): void => {
      if (seenIds.has(connection.id) || !knownNodeIds.has(connection.from) || !knownNodeIds.has(connection.to)) return;
      seenIds.add(connection.id);
      generated.push(connection);
    };

    for (const listener of runningListeners) {
      const id = safeId(listener.id);
      if (!id) continue;
      add({
        id: `conn-listener-${id}`,
        from: 'attacker',
        to: `listener-${id}`,
        type: 'listener',
        label: `Listening on :${safePort(listener.port) || 'unknown'}`,
      });
    }

    for (const tunnel of runningTunnels) {
      const id = safeId(tunnel.id);
      if (!id) continue;
      const tool = safeText(tunnel.tool) || 'tunnel';
      const port = safePort(tunnel.port) || 'unknown';
      if (tunnel.mode === 'server') {
        add({ id: `conn-tunnel-${id}`, from: 'attacker', to: `tunnel-${id}`, type: 'tunnel', label: `${tool} server :${port}` });
      } else if (tunnel.mode === 'client' && safeText(tunnel.remoteHost)) {
        add({
          id: `conn-tunnel-${id}`,
          from: 'attacker',
          to: `tunnel-${id}`,
          type: 'tunnel',
          label: `${tool} → ${safeText(tunnel.remoteHost)}:${safePort(tunnel.remotePort) || 'unknown'}`,
          bidirectional: true,
        });
      }
    }

    for (const connection of validConnections) {
      const id = safeId(connection.id);
      const method = safeText(connection.method);
      if (!id) continue;
      const childId = `connection-${id}`;
      const rawParent = safeId(connection.parentId);
      const parentId = rawParent && knownNodeIds.has(rawParent)
        ? rawParent
        : rawParent && knownNodeIds.has(`connection-${rawParent}`)
          ? `connection-${rawParent}`
          : undefined;
      const type = method === 'ssh' ? 'ssh' : method === 'reverse' ? 'reverse-shell' : 'pivot';
      if (parentId) {
        add({ id: `conn-chain-${id}`, from: parentId, to: childId, type, label: method || 'connection' });
      } else if (!rawParent) {
        add({
          id: `conn-root-${id}`,
          from: 'attacker',
          to: childId,
          type: method === 'reverse' ? 'reverse-shell' : 'ssh',
          label: `${safeText(connection.ip) || 'unknown'}:${safePort(connection.port) || 'unknown'}`,
        });
      }
    }

    return generated;
  }

  /** Auto-layout without mutating the caller's node objects. */
  static autoLayout(nodes: TopologyNode[]): TopologyNode[] {
    const centerX = 500;
    const centerY = 300;
    const radius = 200;
    const positions = new Map<string, { x: number; y: number }>();
    const place = (items: TopologyNode[], scale: number, offset: number): void => {
      items.forEach((node, index) => {
        const angle = (index / Math.max(items.length, 1)) * 2 * Math.PI + offset;
        positions.set(node.id, {
          x: centerX + radius * scale * Math.cos(angle),
          y: centerY + radius * scale * Math.sin(angle),
        });
      });
    };

    const attacker = nodes.find(node => node.type === 'attacker');
    if (attacker) positions.set(attacker.id, { x: centerX, y: centerY });
    place(nodes.filter(node => node.type === 'listener'), 1, 0);
    place(nodes.filter(node => node.type === 'tunnel'), 1.5, Math.PI / 4);
    place(nodes.filter(node => node.type === 'target'), 2, 0);
    place(nodes.filter(node => node.type === 'pivot'), 2.5, Math.PI / 8);

    return nodes.map(node => ({
      ...node,
      metadata: { ...node.metadata },
      position: positions.get(node.id) || (node.position ? { ...node.position } : undefined),
    }));
  }

  /** Get full topology from the active infrastructure scopes. */
  static getFullTopology(activeTabId: string): {
    nodes: TopologyNode[];
    connections: TopologyConnection[];
  } {
    const footholdStore = useFootholdStore.getState();
    const tunnelingStore = useTunnelingStore.getState();
    const connectionStore = useConnectionStore.getState();
    const requestedTabId = safeId(activeTabId);

    const footholdTabs = Array.isArray(footholdStore.tabs) ? footholdStore.tabs : [];
    const tunnelingTabs = Array.isArray(tunnelingStore.tabs) ? tunnelingStore.tabs : [];
    const footholdTab = footholdTabs.find(tab => tab.id === requestedTabId)
      || footholdTabs.find(tab => tab.id === footholdStore.activeTabId)
      || footholdTabs[0]
      || { listeners: [] };
    const tunnelingTab = tunnelingTabs.find(tab => tab.id === requestedTabId)
      || tunnelingTabs.find(tab => tab.id === tunnelingStore.activeTabId)
      || tunnelingTabs[0]
      || { sessions: [] };
    const listeners = Array.isArray(footholdTab.listeners) ? footholdTab.listeners : [];
    const tunnels = Array.isArray(tunnelingTab.sessions) ? tunnelingTab.sessions : [];
    const scopedTerminalIds = new Set<string>([
      ...listeners.map(listener => safeId(listener.id)).filter(Boolean) as string[],
      ...tunnels.map(tunnel => safeId(tunnel.id)).filter(Boolean) as string[],
    ]);
    const activeConnections = scopedTerminalIds.size > 0 && typeof connectionStore.getAllActiveConnections === 'function'
      ? connectionStore.getAllActiveConnections().filter(connection => scopedTerminalIds.has(safeId(connection.terminalId) || ''))
      : [];

    const baseNodes: TopologyNode[] = [{
      id: 'attacker',
      type: 'attacker',
      label: 'Attacker Machine',
      status: 'active',
      metadata: { createdAt: Date.now() },
      position: { x: 500, y: 300 },
    }];
    const nodes = uniqueNodes([
      ...baseNodes,
      ...this.generateListenerNodes(listeners, requestedTabId),
      ...this.generateTunnelNodes(tunnels, requestedTabId),
      ...this.generateConnectionNodes(activeConnections),
    ]);
    const connections = uniqueConnections(this.generateConnections(listeners, tunnels, activeConnections), new Set(nodes.map(node => node.id)));
    return { nodes: this.autoLayout(nodes), connections };
  }

  /** Get full topology including validated scan results. */
  static getFullTopologyWithScans(activeTabId: string, scanResults: unknown[]): {
    nodes: TopologyNode[];
    connections: TopologyConnection[];
  } {
    const base = this.getFullTopology(activeTabId);
    const scanNodes = this.generateScanNodes(Array.isArray(scanResults) ? scanResults : []);
    const nodes = uniqueNodes([...base.nodes, ...scanNodes]);
    const nodeIds = new Set(nodes.map(node => node.id));
    return {
      nodes: this.autoLayout(nodes),
      connections: uniqueConnections(
        [...base.connections, ...this.generateScanConnections(scanResults, nodeIds)],
        nodeIds,
      ),
    };
  }
}
