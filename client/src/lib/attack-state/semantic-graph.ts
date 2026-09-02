/**
 * Semantic Graph Engine
 * Builds intelligent relationships between entities for context-aware queries
 * 
 * Philosophy: The graph should understand WHAT entities can do, not just WHAT they are.
 */

import type { GraphEntity, GraphEdge } from './world-graph';

export type SemanticEdgeType = 
  // Direct relationships (from delta-engine)
  | 'exposes'           // host -> service
  | 'used_on'           // cred -> service
  | 'belongs_to'        // file -> host
  | 'pivots_to'         // host -> host
  
  // Semantic relationships (inferred)
  | 'might_work_on'     // cred -> service_type (e.g., SSH cred might work on all SSH services)
  | 'exploits'          // vuln -> service
  | 'grants_access_to'  // cred -> host (successful auth)
  | 'blocks_access_to'  // constraint -> service
  | 'contains'          // file -> cred (file contains credentials)
  | 'runs_on'           // service -> host (redundant with exposes, but useful for queries)
  | 'requires'          // service -> cred (service requires specific auth)
  | 'enables'           // service -> attack_vector (e.g., Docker -> container_escape)
  ;

export interface SemanticEdge extends GraphEdge {
  type: SemanticEdgeType;
  confidence: number; // 0-100, how confident are we in this relationship?
  reason: string; // Why was this edge created?
}

export interface QueryContext {
  focus_entities: string[]; // Entity IDs we're asking about
  keywords: string[]; // Keywords from the question
  intent: 'exploit' | 'enumerate' | 'access' | 'understand' | 'general';
}

export interface ContextResult {
  entities: GraphEntity[];
  edges: SemanticEdge[];
  reasoning: string; // Why these entities were selected
  confidence: number; // Overall confidence in this context
}

/**
 * Semantic Graph - builds intelligent relationships
 */
export class SemanticGraph {
  private entities: Map<string, GraphEntity> = new Map();
  private edges: Map<string, SemanticEdge> = new Map();
  
  /**
   * Add entity to semantic graph
   */
  addEntity(entity: GraphEntity): void {
    this.entities.set(entity.id, entity);
  }
  
  /**
   * Add direct edge (from delta-engine)
   */
  addDirectEdge(edge: GraphEdge): void {
    const semanticEdge: SemanticEdge = {
      ...edge,
      type: edge.type as SemanticEdgeType,
      confidence: 100, // Direct edges are 100% confident
      reason: 'Observed in terminal output'
    };
    this.edges.set(edge.id, semanticEdge);
  }
  
  /**
   * Infer semantic relationships from existing entities and edges
   * This is where the magic happens.
   */
  inferSemanticEdges(): void {
    // Rule 1: Credentials might work on services of the same type
    this.inferCredentialServiceMatches();
    
    // Rule 2: Files that contain credentials enable access
    this.inferFileCredentialRelationships();
    
    // Rule 3: Successful auth grants access to host
    this.inferAccessGrants();
    
    // Rule 4: Constraints block access to services
    this.inferAccessBlockers();
    
    // Rule 5: Services enable attack vectors
    this.inferAttackVectors();
    
    // Rule 6: Service runs on host (reverse of exposes)
    this.inferServiceHostRelationships();
  }
  
  /**
   * Rule 1: Credentials might work on services of the same type
   * Example: SSH cred found in logs might work on all SSH services
   */
  private inferCredentialServiceMatches(): void {
    const creds = Array.from(this.entities.values()).filter(e => e.type === 'cred');
    const services = Array.from(this.entities.values()).filter(e => e.type === 'service');
    
    for (const cred of creds) {
      // Determine credential type from context
      const credType = this.inferCredentialType(cred);
      
      if (!credType) continue;
      
      // Find all services that match this credential type
      for (const service of services) {
        const serviceType = service.attrs.service || service.attrs.protocol;
        
        if (this.credentialMatchesService(credType, serviceType)) {
          // Check if we already have a direct 'used_on' edge
          const directEdgeId = `${cred.id}|->|${service.id}|::|used_on`;
          const hasDirectEdge = this.edges.has(directEdgeId);
          
          if (!hasDirectEdge) {
            // Create semantic edge
            const edgeId = `${cred.id}|~>|${service.id}|::|might_work_on`;
            
            // Calculate confidence based on credential validity
            let confidence = 60; // Base confidence
            if (cred.attrs.valid === 'valid') confidence = 90;
            if (cred.attrs.valid === 'invalid') confidence = 20;
            
            this.edges.set(edgeId, {
              id: edgeId,
              from: cred.id,
              to: service.id,
              type: 'might_work_on',
              evidence: cred.evidence,
              first_seen: cred.first_seen,
              last_seen: cred.last_seen,
              confidence,
              reason: `${credType} credential might work on ${serviceType} service`
            });
          }
        }
      }
    }
  }
  
  /**
   * Rule 2: Files that contain credentials enable access
   */
  private inferFileCredentialRelationships(): void {
    const files = Array.from(this.entities.values()).filter(e => e.type === 'file');
    const creds = Array.from(this.entities.values()).filter(e => e.type === 'cred');
    
    for (const file of files) {
      const filePath = file.attrs.path;
      
      // Check if file path suggests it contains credentials
      const isCredFile = this.isCredentialFile(filePath);
      
      if (isCredFile) {
        // Find credentials discovered around the same time
        for (const cred of creds) {
          const timeDiff = Math.abs(cred.evidence.timestamp - file.evidence.timestamp);
          
          // If credential was found within 30 seconds of file, they're likely related
          if (timeDiff < 30000) {
            const edgeId = `${file.id}|~>|${cred.id}|::|contains`;
            
            this.edges.set(edgeId, {
              id: edgeId,
              from: file.id,
              to: cred.id,
              type: 'contains',
              evidence: file.evidence,
              first_seen: file.first_seen,
              last_seen: file.last_seen,
              confidence: 85,
              reason: `File ${filePath} likely contains credential`
            });
          }
        }
      }
    }
  }
  
  /**
   * Rule 3: Successful auth grants access to host
   */
  private inferAccessGrants(): void {
    const creds = Array.from(this.entities.values()).filter(e => e.type === 'cred');
    const hosts = Array.from(this.entities.values()).filter(e => e.type === 'host');
    
    for (const cred of creds) {
      if (cred.attrs.valid === 'valid') {
        // Find services this cred was used on
        const usedOnEdges = Array.from(this.edges.values()).filter(
          e => e.from === cred.id && (e.type === 'used_on' || e.type === 'might_work_on')
        );
        
        for (const edge of usedOnEdges) {
          // Find the host that exposes this service
          const serviceId = edge.to;
          const exposesEdges = Array.from(this.edges.values()).filter(
            e => e.to === serviceId && e.type === 'exposes'
          );
          
          for (const exposesEdge of exposesEdges) {
            const hostId = exposesEdge.from;
            const edgeId = `${cred.id}|~>|${hostId}|::|grants_access_to`;
            
            this.edges.set(edgeId, {
              id: edgeId,
              from: cred.id,
              to: hostId,
              type: 'grants_access_to',
              evidence: cred.evidence,
              first_seen: cred.first_seen,
              last_seen: cred.last_seen,
              confidence: 95,
              reason: 'Valid credential grants access to host'
            });
          }
        }
      }
    }
  }
  
  /**
   * Rule 4: Constraints block access to services
   */
  private inferAccessBlockers(): void {
    const constraints = Array.from(this.entities.values()).filter(e => e.type === 'constraint');
    const services = Array.from(this.entities.values()).filter(e => e.type === 'service');
    
    for (const constraint of constraints) {
      const message = constraint.attrs.message;
      
      // Find services discovered around the same time
      for (const service of services) {
        const timeDiff = Math.abs(service.evidence.timestamp - constraint.evidence.timestamp);
        
        // If constraint appeared within 10 seconds of service, they're likely related
        if (timeDiff < 10000) {
          const edgeId = `${constraint.id}|~>|${service.id}|::|blocks_access_to`;
          
          this.edges.set(edgeId, {
            id: edgeId,
            from: constraint.id,
            to: service.id,
            type: 'blocks_access_to',
            evidence: constraint.evidence,
            first_seen: constraint.first_seen,
            last_seen: constraint.last_seen,
            confidence: 75,
            reason: `Constraint "${message}" blocks access to service`
          });
        }
      }
    }
  }
  
  /**
   * Rule 5: Services enable attack vectors
   */
  private inferAttackVectors(): void {
    const services = Array.from(this.entities.values()).filter(e => e.type === 'service');
    
    for (const service of services) {
      const serviceType = service.attrs.service || service.attrs.protocol;
      const attackVectors = this.getAttackVectors(serviceType);
      
      // Store attack vectors as metadata on the service entity
      if (attackVectors.length > 0) {
        service.attrs.attack_vectors = attackVectors;
      }
    }
  }
  
  /**
   * Rule 6: Service runs on host (reverse of exposes)
   */
  private inferServiceHostRelationships(): void {
    const exposesEdges = Array.from(this.edges.values()).filter(e => e.type === 'exposes');
    
    for (const edge of exposesEdges) {
      const reverseEdgeId = `${edge.to}|~>|${edge.from}|::|runs_on`;
      
      this.edges.set(reverseEdgeId, {
        id: reverseEdgeId,
        from: edge.to,
        to: edge.from,
        type: 'runs_on',
        evidence: edge.evidence,
        first_seen: edge.first_seen,
        last_seen: edge.last_seen,
        confidence: 100,
        reason: 'Service runs on host'
      });
    }
  }
  
  /**
   * Query graph for relevant context
   * This is the main entry point for AI context building
   */
  queryContext(context: QueryContext): ContextResult {
    const relevantEntities = new Map<string, { entity: GraphEntity; score: number }>();
    const relevantEdges = new Set<SemanticEdge>();
    
    // Step 1: Find entities matching keywords
    const keywordMatches = this.findEntitiesByKeywords(context.keywords);
    for (const [entity, score] of keywordMatches) {
      relevantEntities.set(entity.id, { entity, score });
    }
    
    // Step 2: Add focus entities (explicitly mentioned)
    for (const entityId of context.focus_entities) {
      const entity = this.entities.get(entityId);
      if (entity) {
        relevantEntities.set(entityId, { entity, score: 100 });
      }
    }
    
    // Step 3: Expand context based on intent
    const expandedContext = this.expandContext(
      Array.from(relevantEntities.values()).map(r => r.entity),
      context.intent
    );
    
    for (const entity of expandedContext.entities) {
      if (!relevantEntities.has(entity.id)) {
        relevantEntities.set(entity.id, { entity, score: 50 });
      }
    }
    
    for (const edge of expandedContext.edges) {
      relevantEdges.add(edge);
    }
    
    // Step 4: Sort by score and take top N
    const sortedEntities = Array.from(relevantEntities.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => r.entity);
    
    // Step 5: Calculate overall confidence
    const avgConfidence = Array.from(relevantEdges).reduce((sum, e) => sum + e.confidence, 0) / 
                         Math.max(relevantEdges.size, 1);
    
    return {
      entities: sortedEntities,
      edges: Array.from(relevantEdges),
      reasoning: this.explainContext(sortedEntities, Array.from(relevantEdges), context),
      confidence: avgConfidence
    };
  }
  
  /**
   * Find entities by keywords
   */
  private findEntitiesByKeywords(keywords: string[]): Map<GraphEntity, number> {
    const matches = new Map<GraphEntity, number>();
    
    for (const entity of this.entities.values()) {
      let score = 0;
      
      // Check entity attributes
      const attrStr = JSON.stringify(entity.attrs).toLowerCase();
      
      for (const keyword of keywords) {
        const kw = keyword.toLowerCase();
        
        // Exact match in attributes
        if (attrStr.includes(kw)) {
          score += 20;
        }
        
        // Match in entity ID
        if (entity.id.toLowerCase().includes(kw)) {
          score += 15;
        }
        
        // Type match
        if (entity.type === kw) {
          score += 10;
        }
      }
      
      if (score > 0) {
        matches.set(entity, score);
      }
    }
    
    return matches;
  }
  
  /**
   * Expand context based on intent
   */
  private expandContext(
    seedEntities: GraphEntity[],
    intent: QueryContext['intent']
  ): { entities: GraphEntity[]; edges: SemanticEdge[] } {
    const entities = new Set<GraphEntity>(seedEntities);
    const edges = new Set<SemanticEdge>();
    
    // Different expansion strategies based on intent
    switch (intent) {
      case 'exploit':
        // Include: credentials, attack vectors, vulnerabilities
        this.expandForExploit(seedEntities, entities, edges);
        break;
        
      case 'access':
        // Include: credentials, footholds, paths to target
        this.expandForAccess(seedEntities, entities, edges);
        break;
        
      case 'enumerate':
        // Include: related services, files, hosts
        this.expandForEnumeration(seedEntities, entities, edges);
        break;
        
      case 'understand':
        // Include: all related entities (broad context)
        this.expandForUnderstanding(seedEntities, entities, edges);
        break;
        
      case 'general':
      default:
        // Include: 1-hop neighbors
        this.expandOneHop(seedEntities, entities, edges);
        break;
    }
    
    return {
      entities: Array.from(entities),
      edges: Array.from(edges)
    };
  }
  
  /**
   * Expand for exploit intent: find credentials and attack vectors
   */
  private expandForExploit(
    seeds: GraphEntity[],
    entities: Set<GraphEntity>,
    edges: Set<SemanticEdge>
  ): void {
    for (const seed of seeds) {
      // Find credentials that might work on this service
      const credEdges = Array.from(this.edges.values()).filter(
        e => e.to === seed.id && (e.type === 'might_work_on' || e.type === 'used_on')
      );
      
      for (const edge of credEdges) {
        edges.add(edge);
        const cred = this.entities.get(edge.from);
        if (cred) entities.add(cred);
      }
      
      // Find files that contain credentials
      const fileEdges = Array.from(this.edges.values()).filter(
        e => e.type === 'contains' && this.entities.get(e.to)?.type === 'cred'
      );
      
      for (const edge of fileEdges) {
        edges.add(edge);
        const file = this.entities.get(edge.from);
        if (file) entities.add(file);
      }
      
      // Find constraints that might block exploitation
      const blockEdges = Array.from(this.edges.values()).filter(
        e => e.to === seed.id && e.type === 'blocks_access_to'
      );
      
      for (const edge of blockEdges) {
        edges.add(edge);
        const constraint = this.entities.get(edge.from);
        if (constraint) entities.add(constraint);
      }
    }
  }
  
  /**
   * Expand for access intent: find paths to target
   */
  private expandForAccess(
    seeds: GraphEntity[],
    entities: Set<GraphEntity>,
    edges: Set<SemanticEdge>
  ): void {
    for (const seed of seeds) {
      // Find credentials that grant access
      const accessEdges = Array.from(this.edges.values()).filter(
        e => e.to === seed.id && e.type === 'grants_access_to'
      );
      
      for (const edge of accessEdges) {
        edges.add(edge);
        const cred = this.entities.get(edge.from);
        if (cred) entities.add(cred);
        
        // Also include the service the cred was used on
        const usedOnEdges = Array.from(this.edges.values()).filter(
          e => e.from === edge.from && e.type === 'used_on'
        );
        
        for (const usedEdge of usedOnEdges) {
          edges.add(usedEdge);
          const service = this.entities.get(usedEdge.to);
          if (service) entities.add(service);
        }
      }
      
      // Find pivot paths
      const pivotEdges = Array.from(this.edges.values()).filter(
        e => e.to === seed.id && e.type === 'pivots_to'
      );
      
      for (const edge of pivotEdges) {
        edges.add(edge);
        const pivotHost = this.entities.get(edge.from);
        if (pivotHost) entities.add(pivotHost);
      }
    }
  }
  
  /**
   * Expand for enumeration: find related infrastructure
   */
  private expandForEnumeration(
    seeds: GraphEntity[],
    entities: Set<GraphEntity>,
    edges: Set<SemanticEdge>
  ): void {
    for (const seed of seeds) {
      // If seed is a host, include all services
      if (seed.type === 'host') {
        const serviceEdges = Array.from(this.edges.values()).filter(
          e => e.from === seed.id && e.type === 'exposes'
        );
        
        for (const edge of serviceEdges) {
          edges.add(edge);
          const service = this.entities.get(edge.to);
          if (service) entities.add(service);
        }
      }
      
      // If seed is a service, include the host
      if (seed.type === 'service') {
        const hostEdges = Array.from(this.edges.values()).filter(
          e => e.from === seed.id && e.type === 'runs_on'
        );
        
        for (const edge of hostEdges) {
          edges.add(edge);
          const host = this.entities.get(edge.to);
          if (host) entities.add(host);
        }
      }
      
      // Include files on the same host
      const fileEdges = Array.from(this.edges.values()).filter(
        e => e.type === 'belongs_to' && e.to === seed.id
      );
      
      for (const edge of fileEdges) {
        edges.add(edge);
        const file = this.entities.get(edge.from);
        if (file) entities.add(file);
      }
    }
  }
  
  /**
   * Expand for understanding: broad context
   */
  private expandForUnderstanding(
    seeds: GraphEntity[],
    entities: Set<GraphEntity>,
    edges: Set<SemanticEdge>
  ): void {
    // Include 2-hop neighbors
    this.expandOneHop(seeds, entities, edges);
    
    const newSeeds = Array.from(entities);
    this.expandOneHop(newSeeds, entities, edges);
  }
  
  /**
   * Expand one hop: include all direct neighbors
   */
  private expandOneHop(
    seeds: GraphEntity[],
    entities: Set<GraphEntity>,
    edges: Set<SemanticEdge>
  ): void {
    for (const seed of seeds) {
      // Outgoing edges
      const outEdges = Array.from(this.edges.values()).filter(e => e.from === seed.id);
      for (const edge of outEdges) {
        edges.add(edge);
        const target = this.entities.get(edge.to);
        if (target) entities.add(target);
      }
      
      // Incoming edges
      const inEdges = Array.from(this.edges.values()).filter(e => e.to === seed.id);
      for (const edge of inEdges) {
        edges.add(edge);
        const source = this.entities.get(edge.from);
        if (source) entities.add(source);
      }
    }
  }
  
  /**
   * Explain why this context was selected
   */
  private explainContext(
    entities: GraphEntity[],
    edges: SemanticEdge[],
    context: QueryContext
  ): string {
    const parts: string[] = [];
    
    parts.push(`Found ${entities.length} relevant entities for ${context.intent} query.`);
    
    const byType = entities.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    parts.push(`Entities: ${Object.entries(byType).map(([t, c]) => `${c} ${t}`).join(', ')}`);
    
    const semanticEdges = edges.filter(e => !['exposes', 'used_on', 'belongs_to', 'pivots_to'].includes(e.type));
    if (semanticEdges.length > 0) {
      parts.push(`Inferred ${semanticEdges.length} semantic relationships.`);
    }
    
    return parts.join(' ');
  }
  
  // Helper methods
  
  private inferCredentialType(cred: GraphEntity): string | null {
    const attrs = cred.attrs;
    
    if (attrs.user && attrs.pass) return 'ssh'; // Assume SSH for user:pass
    if (attrs.token?.startsWith('eyJ')) return 'jwt';
    if (attrs.token?.startsWith('NTLM:')) return 'smb';
    if (attrs.token?.startsWith('MD5:') || attrs.token?.startsWith('SHA')) return 'hash';
    if (attrs.token === 'SSH_PRIVATE_KEY') return 'ssh';
    
    return null;
  }
  
  private credentialMatchesService(credType: string, serviceType: string): boolean {
    const matches: Record<string, string[]> = {
      'ssh': ['ssh', 'sftp'],
      'smb': ['smb', 'cifs', 'microsoft-ds'],
      'jwt': ['http', 'https'],
      'hash': ['smb', 'ldap', 'kerberos'],
    };
    
    return matches[credType]?.includes(serviceType) || false;
  }
  
  private isCredentialFile(path: string): boolean {
    const patterns = [
      /password/i, /passwd/i, /shadow/i, /cred/i, /secret/i,
      /\.key$/i, /\.pem$/i, /id_rsa/i, /id_dsa/i,
      /\.env$/i, /config/i, /\.conf$/i
    ];
    
    return patterns.some(p => p.test(path));
  }
  
  private getAttackVectors(serviceType: string): string[] {
    const vectors: Record<string, string[]> = {
      'ssh': ['bruteforce', 'key_reuse', 'weak_cipher'],
      'http': ['sqli', 'xss', 'lfi', 'rfi', 'file_upload'],
      'https': ['sqli', 'xss', 'lfi', 'rfi', 'file_upload', 'ssl_vuln'],
      'smb': ['eternalblue', 'null_session', 'relay'],
      'ftp': ['anonymous_login', 'bruteforce'],
      'mysql': ['sqli', 'weak_password', 'udf_exploit'],
      'postgresql': ['sqli', 'weak_password'],
      'rdp': ['bluekeep', 'bruteforce'],
      'docker': ['container_escape', 'exposed_socket'],
      'kubernetes': ['api_exploit', 'rbac_bypass'],
    };
    
    return vectors[serviceType] || [];
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
  getEdges(): SemanticEdge[] {
    return Array.from(this.edges.values());
  }
  
  /**
   * Clear graph
   */
  clear(): void {
    this.entities.clear();
    this.edges.clear();
  }
}
