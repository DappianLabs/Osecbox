/**
 * Interaction Tracker
 * Detects when user explores entities
 */

import type { DeltaEngine } from './delta-engine';

export class InteractionTracker {
  constructor(private deltaEngine: DeltaEngine) {}
  
  /**
   * Track command execution
   * Detect if command explores an entity
   */
  async trackCommand(command: string, output: string): Promise<void> {
    // File opened - handle flags and quoted paths
    const fileMatch = command.match(/^(cat|less|more|head|tail|vim|nano|vi|emacs)(?:\s+-\S+)*\s+(.+)$/);
    if (fileMatch) {
      let filePath = fileMatch[2].trim();
      // Remove quotes
      filePath = filePath.replace(/^["']|["']$/g, '');
      if (filePath) {
        const entityId = `f:${filePath}`;
        await this.deltaEngine.markExplored(entityId);
      }
    }
    
    // Service connected
    const serviceMatch = command.match(/^(ssh|telnet|nc|netcat|curl|wget)\s+.*?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (serviceMatch) {
      const ip = serviceMatch[2];
      // Mark all services on this host as explored
      const services = (await this.deltaEngine.getEntitiesByType('service'))
        .filter(s => s.attrs.ip === ip);
      await Promise.all(services.map(s => this.deltaEngine.markExplored(s.id)));
    }
    
    // Credential used successfully
    if (output.match(/authentication successful|login successful|logged in|access granted|welcome|last login/i)) {
      // Mark recent credentials as exploited
      const recentCreds = (await this.deltaEngine.getEntitiesByType('cred'))
        .filter(c => {
          const timeDiff = Date.now() - c.last_seen;
          return timeDiff < 60000; // Within last minute
        });
      await Promise.all(recentCreds.map(c => this.deltaEngine.markExploited(c.id)));
    }
    
    // Docker exec (exploring container)
    const dockerMatch = command.match(/^docker\s+exec\s+(?:-it\s+)?(\S+)/);
    if (dockerMatch) {
      const containerName = dockerMatch[1];
      // Mark files/services in this container as explored
      const semanticGraph = await this.deltaEngine.getSemanticGraph();
      const entities = (semanticGraph.getEntities?.() ?? []) as Array<{
        id: string;
        attrs: Record<string, unknown>;
      }>;
      const containerEntities = entities.filter(entity => entity.attrs.container === containerName);
      await Promise.all(containerEntities.map(entity => this.deltaEngine.markExplored(entity.id)));
    }
  }
}
