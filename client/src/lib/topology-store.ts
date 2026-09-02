// Topology Store - Manages network topology diagrams

export type NodeType = 'server' | 'desktop' | 'firewall' | 'router' | 'switch' | 'unknown';

export interface TopologyNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  name: string;
  ip?: string;
  os?: string;
  ports?: string;
  services?: string;
  user?: string;
  model?: string;
  rules?: string;
  routes?: string;
  vlans?: string;
  notes?: string;
  status?: 'up' | 'down' | 'unknown';
}

export interface TopologyConnection {
  id: string;
  from: string;
  to: string;
  type?: string;
  latency?: string;
  protocol?: string;
  notes?: string;
}

export interface TopologyDiagram {
  id: string;
  name: string;
  mode: 'auto' | 'custom';
  sourceTabId?: string;
  nodes: TopologyNode[];
  connections: TopologyConnection[];
  createdAt: number;
  updatedAt: number;
}

export const TOPOLOGY_LIMITS = {
  maxJsonChars: 4 * 1024 * 1024,
  maxDiagrams: 100,
  maxNodes: 10_000,
  maxConnections: 20_000,
  maxFieldChars: 4_096,
} as const;

type UnknownRecord = Record<string, unknown>;
type TopologyListener = () => void;

const NODE_TYPES = new Set<NodeType>(['server', 'desktop', 'firewall', 'router', 'switch', 'unknown']);
const NODE_STATUSES = new Set(['up', 'down', 'unknown']);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text ? text.slice(0, TOPOLOGY_LIMITS.maxFieldChars) : fallback;
}

function requiredId(value: unknown): string | undefined {
  const id = safeText(value);
  return id && id.length <= TOPOLOGY_LIMITS.maxFieldChars ? id : undefined;
}

function finiteCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, value));
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeNode(value: unknown): TopologyNode | null {
  if (!isRecord(value)) return null;
  const id = requiredId(value.id);
  if (!id) return null;

  const node: TopologyNode = {
    id,
    type: NODE_TYPES.has(value.type as NodeType) ? value.type as NodeType : 'unknown',
    x: finiteCoordinate(value.x),
    y: finiteCoordinate(value.y),
    name: safeText(value.name, 'Unnamed node') || 'Unnamed node',
  };

  for (const field of ['ip', 'os', 'ports', 'services', 'user', 'model', 'rules', 'routes', 'vlans', 'notes'] as const) {
    const text = safeText(value[field]);
    if (text !== undefined) node[field] = text;
  }
  node.status = NODE_STATUSES.has(value.status as string) ? value.status as TopologyNode['status'] : 'unknown';
  return node;
}

function normalizeConnection(value: unknown): TopologyConnection | null {
  if (!isRecord(value)) return null;
  const id = requiredId(value.id);
  const from = requiredId(value.from);
  const to = requiredId(value.to);
  if (!id || !from || !to) return null;

  const connection: TopologyConnection = { id, from, to };
  for (const field of ['type', 'latency', 'protocol', 'notes'] as const) {
    const text = safeText(value[field]);
    if (text !== undefined) connection[field] = text;
  }
  return connection;
}

function normalizeNodes(value: unknown): TopologyNode[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, TopologyNode>();
  for (const entry of value.slice(0, TOPOLOGY_LIMITS.maxNodes)) {
    const node = normalizeNode(entry);
    if (node) byId.set(node.id, node);
  }
  return Array.from(byId.values());
}

function normalizeConnections(value: unknown, nodes: TopologyNode[]): TopologyConnection[] {
  if (!Array.isArray(value)) return [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const byId = new Map<string, TopologyConnection>();
  for (const entry of value.slice(0, TOPOLOGY_LIMITS.maxConnections)) {
    const connection = normalizeConnection(entry);
    if (!connection || !nodeIds.has(connection.from) || !nodeIds.has(connection.to)) continue;
    byId.set(connection.id, connection);
  }
  return Array.from(byId.values());
}

function normalizeDiagram(value: unknown, now = Date.now()): TopologyDiagram | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.connections)) return null;
  const id = requiredId(value.id);
  if (!id) return null;

  const nodes = normalizeNodes(value.nodes);
  return {
    id,
    name: safeText(value.name, 'Imported Topology') || 'Imported Topology',
    mode: value.mode === 'auto' ? 'auto' : 'custom',
    sourceTabId: safeText(value.sourceTabId),
    nodes,
    connections: normalizeConnections(value.connections, nodes),
    createdAt: finiteTimestamp(value.createdAt, now),
    updatedAt: finiteTimestamp(value.updatedAt, now),
  };
}

function cloneDiagram(diagram: TopologyDiagram): TopologyDiagram {
  return {
    ...diagram,
    nodes: diagram.nodes.map(node => ({ ...node })),
    connections: diagram.connections.map(connection => ({ ...connection })),
  };
}

function contentSnapshot(diagram: TopologyDiagram): string {
  return JSON.stringify({
    id: diagram.id,
    name: diagram.name,
    mode: diagram.mode,
    sourceTabId: diagram.sourceTabId,
    nodes: diagram.nodes,
    connections: diagram.connections,
  });
}

class TopologyStoreClass {
  private diagrams = new Map<string, TopologyDiagram>();
  private activeDiagramId: string | null = null;
  private revision = 0;
  private listeners = new Set<TopologyListener>();

  private notify(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[TopologyStore] Subscriber failed:', error);
      }
    }
  }

  subscribe(listener: TopologyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  createDiagram(name: string, mode: 'auto' | 'custom', sourceTabId?: string): TopologyDiagram {
    const now = Date.now();
    const diagram: TopologyDiagram = {
      id: `diagram-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: safeText(name, 'Network Topology') || 'Network Topology',
      mode: mode === 'auto' ? 'auto' : 'custom',
      sourceTabId: safeText(sourceTabId),
      nodes: [],
      connections: [],
      createdAt: now,
      updatedAt: now,
    };
    this.diagrams.set(diagram.id, diagram);
    this.activeDiagramId = diagram.id;
    this.notify();
    return cloneDiagram(diagram);
  }

  getDiagram(id: string): TopologyDiagram | null {
    const diagram = this.diagrams.get(id);
    return diagram ? cloneDiagram(diagram) : null;
  }

  getActiveDiagram(): TopologyDiagram | null {
    return this.activeDiagramId ? this.getDiagram(this.activeDiagramId) : null;
  }

  setActiveDiagram(id: string): boolean {
    if (!this.diagrams.has(id) || this.activeDiagramId === id) return this.diagrams.has(id);
    this.activeDiagramId = id;
    this.notify();
    return true;
  }

  updateDiagram(id: string, updates: Partial<TopologyDiagram>): TopologyDiagram | null {
    const current = this.diagrams.get(id);
    if (!current || !isRecord(updates)) return null;
    const rawUpdates = updates as UnknownRecord;
    if (Object.prototype.hasOwnProperty.call(rawUpdates, 'nodes') && !Array.isArray(rawUpdates.nodes)) return null;
    if (Object.prototype.hasOwnProperty.call(rawUpdates, 'connections') && !Array.isArray(rawUpdates.connections)) return null;

    const candidate: UnknownRecord = {
      ...current,
      ...rawUpdates,
      id: current.id,
      nodes: rawUpdates.nodes === undefined ? current.nodes : rawUpdates.nodes,
      connections: rawUpdates.connections === undefined ? current.connections : rawUpdates.connections,
      updatedAt: Date.now(),
    };
    const normalized = normalizeDiagram(candidate, Date.now());
    if (!normalized) return null;
    normalized.id = current.id;
    normalized.updatedAt = Date.now();
    this.diagrams.set(id, normalized);
    this.notify();
    return cloneDiagram(normalized);
  }

  addNode(diagramId: string, node: TopologyNode): boolean {
    const diagram = this.diagrams.get(diagramId);
    const normalized = normalizeNode(node);
    if (!diagram || !normalized || diagram.nodes.some(existing => existing.id === normalized.id)) return false;
    const next = normalizeDiagram({
      ...diagram,
      nodes: [...diagram.nodes, normalized],
      connections: diagram.connections,
      updatedAt: Date.now(),
    });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  updateNode(diagramId: string, nodeId: string, updates: Partial<TopologyNode>): boolean {
    const diagram = this.diagrams.get(diagramId);
    const currentNode = diagram?.nodes.find(node => node.id === nodeId);
    if (!diagram || !currentNode || !isRecord(updates)) return false;
    const normalized = normalizeNode({ ...currentNode, ...(updates as UnknownRecord), id: nodeId });
    if (!normalized) return false;
    const next = normalizeDiagram({
      ...diagram,
      nodes: diagram.nodes.map(node => node.id === nodeId ? normalized : node),
      connections: diagram.connections,
      updatedAt: Date.now(),
    });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  deleteNode(diagramId: string, nodeId: string): boolean {
    const diagram = this.diagrams.get(diagramId);
    if (!diagram || !diagram.nodes.some(node => node.id === nodeId)) return false;
    const nodes = diagram.nodes.filter(node => node.id !== nodeId);
    const connections = diagram.connections.filter(connection => connection.from !== nodeId && connection.to !== nodeId);
    const next = normalizeDiagram({ ...diagram, nodes, connections, updatedAt: Date.now() });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  addConnection(diagramId: string, connection: TopologyConnection): boolean {
    const diagram = this.diagrams.get(diagramId);
    const normalized = normalizeConnection(connection);
    if (!diagram || !normalized || diagram.connections.some(existing => existing.id === normalized.id)) return false;
    if (!diagram.nodes.some(node => node.id === normalized.from) || !diagram.nodes.some(node => node.id === normalized.to)) return false;
    const next = normalizeDiagram({
      ...diagram,
      nodes: diagram.nodes,
      connections: [...diagram.connections, normalized],
      updatedAt: Date.now(),
    });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  updateConnection(diagramId: string, connectionId: string, updates: Partial<TopologyConnection>): boolean {
    const diagram = this.diagrams.get(diagramId);
    const currentConnection = diagram?.connections.find(connection => connection.id === connectionId);
    if (!diagram || !currentConnection || !isRecord(updates)) return false;
    const normalized = normalizeConnection({ ...currentConnection, ...(updates as UnknownRecord), id: connectionId });
    if (!normalized || !diagram.nodes.some(node => node.id === normalized.from) || !diagram.nodes.some(node => node.id === normalized.to)) return false;
    const next = normalizeDiagram({
      ...diagram,
      nodes: diagram.nodes,
      connections: diagram.connections.map(connection => connection.id === connectionId ? normalized : connection),
      updatedAt: Date.now(),
    });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  deleteConnection(diagramId: string, connectionId: string): boolean {
    const diagram = this.diagrams.get(diagramId);
    if (!diagram || !diagram.connections.some(connection => connection.id === connectionId)) return false;
    const next = normalizeDiagram({
      ...diagram,
      nodes: diagram.nodes,
      connections: diagram.connections.filter(connection => connection.id !== connectionId),
      updatedAt: Date.now(),
    });
    if (!next) return false;
    this.diagrams.set(diagramId, next);
    this.notify();
    return true;
  }

  exportDiagram(id: string): string {
    const diagram = this.diagrams.get(id);
    if (!diagram) return '';
    const json = JSON.stringify(cloneDiagram(diagram), null, 2);
    return json.length <= TOPOLOGY_LIMITS.maxJsonChars ? json : '';
  }

  importDiagram(json: unknown): TopologyDiagram | null {
    if (typeof json !== 'string' || json.length > TOPOLOGY_LIMITS.maxJsonChars) return null;
    try {
      const parsed = JSON.parse(json);
      const diagram = normalizeDiagram(parsed);
      if (!diagram) return null;
      this.diagrams.set(diagram.id, diagram);
      this.activeDiagramId = diagram.id;
      this.notify();
      return cloneDiagram(diagram);
    } catch {
      return null;
    }
  }

  getAllDiagrams(): TopologyDiagram[] {
    return Array.from(this.diagrams.values()).map(cloneDiagram);
  }

  restore(diagrams: unknown, activeDiagramId?: unknown): boolean {
    if (!Array.isArray(diagrams)) return false;

    const normalizedById = new Map<string, TopologyDiagram>();
    for (const value of diagrams.slice(0, TOPOLOGY_LIMITS.maxDiagrams)) {
      const diagram = normalizeDiagram(value);
      if (diagram) normalizedById.set(diagram.id, diagram);
    }
    // An empty array is an intentional clear. A non-empty array containing no
    // valid diagrams is rejected so corrupt restore data cannot erase a good
    // workspace.
    if (diagrams.length > 0 && normalizedById.size === 0) return false;

    this.diagrams = normalizedById;
    this.activeDiagramId = typeof activeDiagramId === 'string' && normalizedById.has(activeDiagramId)
      ? activeDiagramId
      : (normalizedById.keys().next().value || null);
    this.notify();
    return true;
  }

  /** Exposed for focused callers that need to compare snapshots without mutating them. */
  static contentSnapshot(diagram: TopologyDiagram): string {
    return contentSnapshot(diagram);
  }
}

export const TopologyStore = new TopologyStoreClass();
