/**
 * World Graph
 * Stores discovered entities from terminal output
 * Terminal-agnostic, tool-agnostic
 */

export interface GraphEntity {
  id: string; // Symbolic ID: h:10.10.11.247, svc:10.10.11.247:22, f:/etc/passwd
  type: 'host' | 'service' | 'file' | 'cred' | 'constraint';
  attrs: Record<string, any>;
  evidence: {
    command_id: number;
    timestamp: number;
  };
  first_seen: number;
  last_seen: number;
  
  // Exploration tracking
  exploration_state: {
    discovered: boolean;  // Always true (it's in graph)
    explored: boolean;    // User interacted with it (opened file, connected to service)
    exploited: boolean;   // Led to access/privesc
  };
  
  // Suspicion scoring
  suspicion_score: number;      // 0-100, how interesting
  suspicion_reason?: string;    // Why this score
  quick_score: number;          // Regex-based score (instant)
  gpt_score?: number;           // GPT-refined score (async)
  
  // Provenance (NEW - for semantic parsers)
  provenance?: {
    command_id: number;
    line: number;            // Line number in command output
    timestamp: number;
    source: string;          // Which parser created this (e.g., 'nmap-parser')
    file?: string;
    collector?: string;
  };
}

export interface GraphEdge {
  id: string; // Unique edge ID: from->to:type
  from: string; // Entity ID
  to: string; // Entity ID
  type: string;
  evidence: {
    command_id: number;
    timestamp: number;
  };
  first_seen: number;
  last_seen: number;
}

export interface GraphDelta {
  new_hosts: GraphEntity[];
  new_services: GraphEntity[];
  new_files: GraphEntity[];
  new_creds: GraphEntity[];
  new_constraints: GraphEntity[];
  new_edges: GraphEdge[]; // Relationship deltas
}

/**
 * World Graph - stores all discovered entities and relationships
 */
export class WorldGraph {
  private entities: Map<string, GraphEntity> = new Map();
  private edges: Map<string, GraphEdge> = new Map(); // Edge storage
  
  /**
   * Add or update entity
   */
  addEntity(entity: GraphEntity): boolean {
    const existing = this.entities.get(entity.id);
    
    if (existing) {
      // Update last_seen
      existing.last_seen = entity.last_seen;
      return false; // Not new
    } else {
      // New entity
      this.entities.set(entity.id, entity);
      return true; // Is new
    }
  }
  
  /**
   * Add or update edge
   */
  addEdge(edge: GraphEdge): boolean {
    const existing = this.edges.get(edge.id);
    
    if (existing) {
      // Update last_seen
      existing.last_seen = edge.last_seen;
      return false; // Not new
    } else {
      // New edge
      this.edges.set(edge.id, edge);
      return true; // Is new
    }
  }
  
  /**
   * Get entity by ID
   */
  getEntity(id: string): GraphEntity | undefined {
    return this.entities.get(id);
  }
  
  /**
   * Get all entities
   */
  getEntities(): GraphEntity[] {
    return Array.from(this.entities.values());
  }
  
  /**
   * Get all edges
   */
  getEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }
  
  /**
   * Get entities by type
   */
  getEntitiesByType(type: GraphEntity['type']): GraphEntity[] {
    return this.getEntities().filter(e => e.type === type);
  }
  
  /**
   * Check if entity exists
   */
  hasEntity(id: string): boolean {
    return this.entities.has(id);
  }
  
  /**
   * Check if edge exists
   */
  hasEdge(id: string): boolean {
    return this.edges.has(id);
  }
  
  /**
   * Compute delta (new entities and edges since previous graph)
   */
  computeDelta(previous: WorldGraph): GraphDelta {
    const delta: GraphDelta = {
      new_hosts: [],
      new_services: [],
      new_files: [],
      new_creds: [],
      new_constraints: [],
      new_edges: []
    };
    
    // Check for new entities
    for (const entity of this.getEntities()) {
      if (!previous.hasEntity(entity.id)) {
        // New entity
        switch (entity.type) {
          case 'host':
            delta.new_hosts.push(entity);
            break;
          case 'service':
            delta.new_services.push(entity);
            break;
          case 'file':
            delta.new_files.push(entity);
            break;
          case 'cred':
            delta.new_creds.push(entity);
            break;
          case 'constraint':
            delta.new_constraints.push(entity);
            break;
        }
      }
    }
    
    // Check for new edges
    for (const edge of this.getEdges()) {
      if (!previous.hasEdge(edge.id)) {
        delta.new_edges.push(edge);
      }
    }
    
    return delta;
  }
  
  /**
   * Get entity count
   */
  size(): number {
    return this.entities.size;
  }
  
  /**
   * Get edge count
   */
  edgeCount(): number {
    return this.edges.size;
  }
  
  /**
   * Clear all entities and edges
   */
  clear(): void {
    this.entities.clear();
    this.edges.clear();
  }
  
  /**
   * Clone graph (deep copy)
   */
  clone(): WorldGraph {
    const cloned = new WorldGraph();
    for (const [id, entity] of Array.from(this.entities.entries())) {
      cloned.entities.set(id, {
        ...entity,
        attrs: { ...entity.attrs },
        evidence: { ...entity.evidence },
        exploration_state: { ...entity.exploration_state }
      });
    }
    for (const [id, edge] of Array.from(this.edges.entries())) {
      cloned.edges.set(id, {
        ...edge,
        evidence: { ...edge.evidence }
      });
    }
    return cloned;
  }
}
