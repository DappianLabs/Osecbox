/**
 * GPT Scorer
 * Async, batched, optional scoring refinement
 * 
 * RULES:
 * - Never blocks
 * - Never required
 * - Batches 100 entities
 * - Caches results
 */

import type { GraphEntity } from './world-graph';

interface ScoringBatch {
  entities: Array<{ id: string; type: string; path?: string; context: string }>;
  timestamp: number;
}

interface ScoringResult {
  id: string;
  type: string;
  path?: string;
  score: number;
  reason: string;
}

export class GPTScorer {
  private batch: ScoringBatch['entities'] = [];
  private batchSize = 100;
  private cache = new Map<string, { score: number; reason: string }>();
  private processing = false;
  private lastFlushTime = 0;
  private minFlushInterval = 5000; // 5 seconds between batches
  
  /**
   * Queue entity for scoring (non-blocking)
   */
  async queueEntity(entity: GraphEntity, context: string): Promise<void> {
    // Check cache first
    const cacheKey = `${entity.type}:${entity.attrs.path || entity.id}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      entity.gpt_score = cached.score;
      entity.suspicion_reason = cached.reason;
      return;
    }
    
    // Add to batch
    this.batch.push({
      id: entity.id,
      type: entity.type,
      path: entity.attrs.path,
      context: context.substring(0, 200) // Limit context
    });
    
    // Flush if batch full
    if (this.batch.length >= this.batchSize && !this.processing) {
      this.flushBatch(); // Fire and forget
    }
  }
  
  /**
   * Flush batch to GPT (async, non-blocking, rate-limited)
   */
  private async flushBatch(): Promise<void> {
    if (this.processing || this.batch.length === 0) return;
    
    // Rate limit: ensure minimum interval between batches
    const now = Date.now();
    if (now - this.lastFlushTime < this.minFlushInterval) {
      console.log(`[GPTScorer] Rate limiting: waiting ${this.minFlushInterval}ms between batches`);
      setTimeout(() => this.flushBatch(), this.minFlushInterval - (now - this.lastFlushTime));
      return;
    }
    this.lastFlushTime = now;
    
    this.processing = true;
    const currentBatch = [...this.batch];
    this.batch = [];
    
    try {
      const scores = await this.callGPT(currentBatch);
      
      // Update cache and entities
      for (const score of scores) {
        const cacheKey = `${score.type}:${score.path || score.id}`;
        this.cache.set(cacheKey, { score: score.score, reason: score.reason });
        
        // Update entity in graph (if still exists)
        this.updateEntityScore(score.id, score.score, score.reason);
      }
    } catch (error) {
      console.warn('[GPTScorer] Batch failed, using quick scores:', error);
      // System continues with quick_score
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Reserved for an optional remote scoring provider. Local scoring remains
   * the deterministic fallback so analysis never depends on network access.
   */
  private async callGPT(batch: ScoringBatch['entities']): Promise<ScoringResult[]> {
    void batch;
    return [];
  }
  
  /**
   * Update entity score in graph
   */
  private updateEntityScore(entityId: string, score: number, reason: string): void {
    // Emit event for graph to update
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('entity-score-update', {
        detail: { entityId, score, reason }
      }));
    }
  }
  
  /**
   * Force flush (called on session end)
   */
  async flush(): Promise<void> {
    if (this.batch.length > 0) {
      await this.flushBatch();
    }
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const gptScorer = new GPTScorer();
