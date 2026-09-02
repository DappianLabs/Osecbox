/**
 * License-aware delta-engine facade.
 * Uses the protected implementation when available and a bounded local implementation otherwise.
 */

import { loadEncryptedModule, isEncryptedModuleAvailable } from '../encrypted-loader';
import { isMonetizationEnabled } from '../feature-flags';

// Lite version interface
interface DeltaEngineLite {
  processCommandOutput(commandId: number, command: string, output: string): any;
  getGraph(): any;
  getLastDelta(): any;
  getRecentDeltas(count?: number): any[];
  getAllDeltas(): any[];
  getEntityCount(): number;
  getEdgeCount(): number;
  getEntitiesByType(type: string): any[];
  getMissedExtractions(): any[];
  clearMissedExtractions(): void;
  getSemanticGraph(): any;
  getFactStore(): any;
  getFactsByCommand(commandId: number): any[];
  getFact(factId: string): any;
  markExplored(entityId: string): void;
  markExploited(entityId: string): void;
  getLastCommandId(): number;
  getDelta(commandId: number): any;
  reset(): void;
}

// Lite implementation (basic functionality)
class DeltaEngineLiteImpl implements DeltaEngineLite {
  private commandCount = 0;

  processCommandOutput(commandId: number, command: string, output: string): any {
    this.commandCount++;
    
    // Delta engine is always free - no upgrade prompts
    const message = 'Delta engine is available. All attack state tracking features are unlocked.';
    
    return {
      entities: [],
      edges: [],
      timestamp: Date.now(),
      commandId,
      message
    };
  }

  getGraph(): any {
    return {
      entities: new Map(),
      edges: new Map(),
      size: () => 0,
      edgeCount: () => 0,
      getEntity: () => null,
      getEntitiesByType: () => [],
      serialize: () => ({ entities: [], edges: [] }),
      clone: () => this.getGraph(),
      clear: () => {},
      computeDelta: () => ({ entities: [], edges: [] })
    };
  }

  getLastDelta(): any {
    return null;
  }

  getRecentDeltas(count = 10): any[] {
    return [];
  }

  getAllDeltas(): any[] {
    return [];
  }

  getEntityCount(): number {
    return 0;
  }

  getEdgeCount(): number {
    return 0;
  }

  getEntitiesByType(type: string): any[] {
    return [];
  }

  getMissedExtractions(): any[] {
    return [];
  }

  clearMissedExtractions(): void {
    // No-op
  }

  getSemanticGraph(): any {
    return {
      entities: new Map(),
      edges: new Map(),
      addEntity: () => {},
      addDirectEdge: () => {},
      inferSemanticEdges: () => {},
      clear: () => {}
    };
  }

  getFactStore(): any {
    return {
      facts: new Map(),
      addFacts: () => {},
      getFactsByCommand: () => [],
      getFact: () => undefined,
      clear: () => {}
    };
  }

  getFactsByCommand(commandId: number): any[] {
    return [];
  }

  getFact(factId: string): any {
    return undefined;
  }

  markExplored(entityId: string): void {
    // No-op
  }

  markExploited(entityId: string): void {
    // No-op
  }

  getLastCommandId(): number {
    return this.commandCount;
  }

  getDelta(commandId: number): any {
    return null;
  }

  reset(): void {
    this.commandCount = 0;
  }
}

// Factory function that loads appropriate version
async function createDeltaEngine(): Promise<DeltaEngineLite> {
  try {
    const encryptedModulesAvailable = await isEncryptedModuleAvailable();
    
    if (encryptedModulesAvailable) {
      // Load encrypted Pro version
      console.log('[DeltaEngine] Loading encrypted Pro version');
      const encryptedModule = await loadEncryptedModule('delta-engine');
      const DeltaEngineClass = encryptedModule.DeltaEngine || encryptedModule.default;
      return new DeltaEngineClass();
    } else {
      // Use the local implementation when no encrypted module is available.
      console.log('[DeltaEngine] Using local attack-state implementation');
      return new DeltaEngineLiteImpl();
    }
  } catch (error) {
    console.warn('[DeltaEngine] Failed to load Pro version, using lite:', error);
    return new DeltaEngineLiteImpl();
  }
}

// Export class that creates appropriate version
export class DeltaEngine {
  private instance: Promise<DeltaEngineLite>;

  constructor() {
    this.instance = createDeltaEngine();
  }

  async processCommandOutput(commandId: number, command: string, output: string): Promise<any> {
    const engine = await this.instance;
    return engine.processCommandOutput(commandId, command, output);
  }

  async getGraph(): Promise<any> {
    const engine = await this.instance;
    return engine.getGraph();
  }

  async getLastDelta(): Promise<any> {
    const engine = await this.instance;
    return engine.getLastDelta();
  }

  async getRecentDeltas(count = 10): Promise<any[]> {
    const engine = await this.instance;
    return engine.getRecentDeltas(count);
  }

  async getAllDeltas(): Promise<any[]> {
    const engine = await this.instance;
    return engine.getAllDeltas();
  }

  async getEntityCount(): Promise<number> {
    const engine = await this.instance;
    return engine.getEntityCount();
  }

  async getEdgeCount(): Promise<number> {
    const engine = await this.instance;
    return engine.getEdgeCount();
  }

  async getEntitiesByType(type: string): Promise<any[]> {
    const engine = await this.instance;
    return engine.getEntitiesByType(type);
  }

  async getMissedExtractions(): Promise<any[]> {
    const engine = await this.instance;
    return engine.getMissedExtractions();
  }

  async clearMissedExtractions(): Promise<void> {
    const engine = await this.instance;
    return engine.clearMissedExtractions();
  }

  async getSemanticGraph(): Promise<any> {
    const engine = await this.instance;
    return engine.getSemanticGraph();
  }

  async getFactStore(): Promise<any> {
    const engine = await this.instance;
    return engine.getFactStore();
  }

  async getFactsByCommand(commandId: number): Promise<any[]> {
    const engine = await this.instance;
    return engine.getFactsByCommand(commandId);
  }

  async getFact(factId: string): Promise<any> {
    const engine = await this.instance;
    return engine.getFact(factId);
  }

  async markExplored(entityId: string): Promise<void> {
    const engine = await this.instance;
    return engine.markExplored(entityId);
  }

  async markExploited(entityId: string): Promise<void> {
    const engine = await this.instance;
    return engine.markExploited(entityId);
  }

  async getLastCommandId(): Promise<number> {
    const engine = await this.instance;
    return engine.getLastCommandId();
  }

  async getDelta(commandId: number): Promise<any> {
    const engine = await this.instance;
    return engine.getDelta(commandId);
  }

  async reset(): Promise<void> {
    const engine = await this.instance;
    return engine.reset();
  }
}
