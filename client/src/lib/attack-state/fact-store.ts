/**
 * Fact Store
 * 
 * Immutable storage for facts with provenance.
 * Facts are never mutated, only added.
 * Supports queries by type, command_id, timestamp, etc.
 */

import type { Fact, FactDelta } from './types';

export class FactStore {
  private facts: Map<string, Fact> = new Map();
  private factsByCommand: Map<number, Fact[]> = new Map();
  private factsByType: Map<string, Fact[]> = new Map();
  private deltas: FactDelta[] = [];

  constructor(private readonly sessionId = 'current') {}
  
  /**
   * Add facts to store (immutable)
   */
  addFacts(facts: Fact[]): void {
    for (const fact of facts) {
      // Store by fact_id
      this.facts.set(fact.fact_id, fact);
      
      // Index by command_id
      const commandFacts = this.factsByCommand.get(fact.provenance.command_id) || [];
      commandFacts.push(fact);
      this.factsByCommand.set(fact.provenance.command_id, commandFacts);
      
      // Index by type
      const typeFacts = this.factsByType.get(fact.type) || [];
      typeFacts.push(fact);
      this.factsByType.set(fact.type, typeFacts);
    }
  }
  
  /**
   * Get fact by ID
   */
  getFact(fact_id: string): Fact | undefined {
    return this.facts.get(fact_id);
  }
  
  /**
   * Get all facts
   */
  getAllFacts(): Fact[] {
    return Array.from(this.facts.values());
  }
  
  /**
   * Get facts by command ID
   */
  getFactsByCommand(command_id: number): Fact[] {
    return this.factsByCommand.get(command_id) || [];
  }
  
  /**
   * Get facts by type
   */
  getFactsByType(type: string): Fact[] {
    return this.factsByType.get(type) || [];
  }
  
  /**
   * Get recent facts (last N)
   */
  getRecentFacts(limit: number = 100): Fact[] {
    const allFacts = this.getAllFacts();
    return allFacts.slice(-limit);
  }
  
  /**
   * Query facts with filter
   */
  queryFacts(filter: (fact: Fact) => boolean): Fact[] {
    return this.getAllFacts().filter(filter);
  }
  
  /**
   * Query facts by keywords (for semantic search across 1000+ commands)
   */
  queryByKeywords(keywords: string[]): Fact[] {
    if (keywords.length === 0) return [];
    
    return this.getAllFacts().filter(fact => {
      const factText = JSON.stringify(fact.payload).toLowerCase();
      return keywords.some(kw => factText.includes(kw.toLowerCase()));
    });
  }
  
  /**
   * Query facts by command range (for timeline queries)
   */
  queryByCommandRange(from_command_id: number, to_command_id: number): Fact[] {
    const facts: Fact[] = [];
    for (let cmd_id = from_command_id; cmd_id <= to_command_id; cmd_id++) {
      const cmdFacts = this.getFactsByCommand(cmd_id);
      facts.push(...cmdFacts);
    }
    return facts;
  }
  
  /**
   * Compute delta between two command IDs
   */
  computeDelta(from_command_id: number, to_command_id: number): FactDelta {
    const fromFacts = new Set(
      Array.from(this.factsByCommand.entries())
        .filter(([cmd_id]) => cmd_id <= from_command_id)
        .flatMap(([_, facts]) => facts)
        .map(f => f.fact_id)
    );
    
    const toFacts = Array.from(this.factsByCommand.entries())
      .filter(([cmd_id]) => cmd_id > from_command_id && cmd_id <= to_command_id)
      .flatMap(([_, facts]) => facts);
    
    const addedFacts = toFacts.filter(f => !fromFacts.has(f.fact_id));
    
    return {
      delta_id: `delta:${from_command_id}:${to_command_id}`,
      session_id: this.sessionId,
      from_command_id,
      to_command_id,
      timestamp: Date.now(),
      added_facts: addedFacts,
      removed_facts: [], // Facts are immutable, never removed
      modified_facts: [] // Facts are immutable, never modified
    };
  }
  
  /**
   * Add delta to history
   */
  addDelta(delta: FactDelta): void {
    this.deltas.push(delta);
  }
  
  /**
   * Get all deltas
   */
  getAllDeltas(): FactDelta[] {
    return this.deltas;
  }
  
  /**
   * Get recent deltas
   */
  getRecentDeltas(limit: number = 10): FactDelta[] {
    return this.deltas.slice(-limit);
  }
  
  /**
   * Clear all facts (for session reset)
   */
  clear(): void {
    this.facts.clear();
    this.factsByCommand.clear();
    this.factsByType.clear();
    this.deltas = [];
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    total_facts: number;
    facts_by_type: Record<string, number>;
    commands_tracked: number;
    deltas_computed: number;
  } {
    const factsByType: Record<string, number> = {};
    for (const [type, facts] of this.factsByType.entries()) {
      factsByType[type] = facts.length;
    }
    
    return {
      total_facts: this.facts.size,
      facts_by_type: factsByType,
      commands_tracked: this.factsByCommand.size,
      deltas_computed: this.deltas.length
    };
  }
}
