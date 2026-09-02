/**
 * Parser Router
 * 
 * Routes commands to appropriate semantic parsers.
 * Falls back to regex-based token harvester for unsupported commands.
 * 
 * Philosophy: Gradual migration - add parsers one at a time.
 */

import { parseNmap } from './parsers/nmap-parser';
import { harvestTokens } from './token-harvester';
import type { Fact } from './types';
import type { GraphEntity } from './world-graph';

export interface ParserResult {
  facts: Fact[];           // Semantic facts (from parser)
  entities: GraphEntity[]; // Legacy entities (from regex)
  source: 'semantic' | 'regex' | 'hybrid';
}

function createGraphEntity(
  entity: Omit<GraphEntity, 'exploration_state' | 'suspicion_score' | 'quick_score'>
): GraphEntity {
  return {
    ...entity,
    exploration_state: {
      discovered: true,
      explored: false,
      exploited: false,
    },
    suspicion_score: 0,
    quick_score: 0,
  };
}

/**
 * Route command to appropriate parser
 */
export function parseCommand(
  command: string,
  output: string,
  command_id: number,
  timestamp: number
): ParserResult {
  // Detect command type
  const commandType = detectCommandType(command);
  
  // Route to semantic parser if available
  if (commandType === 'nmap') {
    const facts = parseNmap(command, output, command_id, timestamp);
    const entities = factsToEntities(facts, command_id, timestamp);
    
    return {
      facts,
      entities,
      source: 'semantic'
    };
  }
  
  // Unsupported command types use the token harvester until a semantic parser
  // is available for that tool.
  const tokens = harvestTokens(output);
  const entities = tokensToEntities(tokens, command_id, timestamp);
  const facts = entitiesToFacts(entities, command_id, timestamp);
  
  return {
    facts,
    entities,
    source: 'regex'
  };
}

/**
 * Detect command type from command string
 */
function detectCommandType(command: string): string {
  const cmd = command.trim().toLowerCase();
  
  // Nmap detection
  if (cmd.startsWith('nmap') || cmd.includes('/nmap')) {
    return 'nmap';
  }
  
  // Masscan detection
  if (cmd.startsWith('masscan') || cmd.includes('/masscan')) {
    return 'masscan';
  }
  
  // Process list detection
  if (cmd.startsWith('ps ') || cmd === 'ps' || cmd.startsWith('ps aux')) {
    return 'ps';
  }
  
  // Socket stats detection
  if (cmd.startsWith('ss ') || cmd === 'ss' || cmd.startsWith('netstat')) {
    return 'ss';
  }
  
  // File listing detection
  if (cmd.startsWith('ls ') || cmd === 'ls' || cmd.startsWith('find ')) {
    return 'find';
  }
  
  // File content detection
  if (cmd.startsWith('cat ') || cmd.startsWith('less ') || cmd.startsWith('more ')) {
    return 'cat';
  }
  
  // Docker detection
  if (cmd.startsWith('docker ')) {
    return 'docker';
  }
  
  // Default: unknown
  return 'unknown';
}

/**
 * Convert facts to legacy entities (for backward compatibility)
 */
function factsToEntities(
  facts: Fact[],
  command_id: number,
  timestamp: number
): GraphEntity[] {
  const entities: GraphEntity[] = [];
  
  for (const fact of facts) {
    if (fact.type === 'host') {
      entities.push(createGraphEntity({
        id: `h:${fact.payload.ip}`,
        type: 'host',
        attrs: {
          ip: fact.payload.ip,
          hostname: fact.payload.hostname,
          state: fact.payload.state,
          os: fact.payload.os,
          mac: fact.payload.mac
        },
        evidence: {
          command_id: fact.provenance.command_id,
          timestamp: fact.provenance.timestamp
        },
        first_seen: timestamp,
        last_seen: timestamp,
        // Add provenance
        provenance: fact.provenance
      }));
    } else if (fact.type === 'port') {
      entities.push(createGraphEntity({
        id: `svc:${fact.payload.ip}:${fact.payload.port}`,
        type: 'service',
        attrs: {
          ip: fact.payload.ip,
          port: fact.payload.port,
          protocol: fact.payload.protocol,
          state: fact.payload.state,
          service: fact.payload.service,
          version: fact.payload.version,
          product: fact.payload.product
        },
        evidence: {
          command_id: fact.provenance.command_id,
          timestamp: fact.provenance.timestamp
        },
        first_seen: timestamp,
        last_seen: timestamp,
        // Add provenance
        provenance: fact.provenance
      }));
    }
    // Fact types without a graph representation remain available in `facts`.
  }
  
  return entities;
}

/**
 * Convert tokens to legacy entities (existing logic)
 */
function tokensToEntities(
  tokens: any,
  command_id: number,
  timestamp: number
): GraphEntity[] {
  const entities: GraphEntity[] = [];
  
  // Convert IPs to host entities
  for (const ip of tokens.ips) {
    entities.push(createGraphEntity({
      id: `h:${ip}`,
      type: 'host',
      attrs: { ip },
      evidence: { command_id, timestamp },
      first_seen: timestamp,
      last_seen: timestamp
    }));
  }
  
  // Convert services to service entities
  for (const svc of tokens.services || []) {
    for (const ip of tokens.ips) {
      entities.push(createGraphEntity({
        id: `svc:${ip}:${svc.port}`,
        type: 'service',
        attrs: {
          ip,
          port: svc.port,
          protocol: svc.protocol,
          state: svc.state,
          service: svc.service
        },
        evidence: { command_id, timestamp },
        first_seen: timestamp,
        last_seen: timestamp
      }));
    }
  }
  
  // Convert paths to file entities
  for (const pathObj of tokens.paths) {
    const path = typeof pathObj === 'string' ? pathObj : pathObj.path;
    entities.push(createGraphEntity({
      id: `f:${path}`,
      type: 'file',
      attrs: {
        path,
        access: typeof pathObj === 'object' ? pathObj.access : 'unknown'
      },
      evidence: { command_id, timestamp },
      first_seen: timestamp,
      last_seen: timestamp
    }));
  }
  
  // Convert credentials to cred entities
  for (let i = 0; i < tokens.credentials.length; i++) {
    const cred = tokens.credentials[i];
    const id = cred.user 
      ? `cred:${cred.user}:${cred.pass || cred.token || 'unknown'}`
      : `cred:token:${cred.token || `${command_id}:${i}`}`;
    
    entities.push(createGraphEntity({
      id,
      type: 'cred',
      attrs: {
        user: cred.user,
        pass: cred.pass,
        token: cred.token,
        valid: cred.valid || 'unknown'
      },
      evidence: { command_id, timestamp },
      first_seen: timestamp,
      last_seen: timestamp
    }));
  }
  
  // Convert constraints to constraint entities
  for (const constraint of tokens.constraints) {
    entities.push(createGraphEntity({
      id: `constraint:${constraint}`,
      type: 'constraint',
      attrs: { message: constraint },
      evidence: { command_id, timestamp },
      first_seen: timestamp,
      last_seen: timestamp
    }));
  }
  
  return entities;
}

/**
 * Convert entities to facts (for backward compatibility)
 */
function entitiesToFacts(
  entities: GraphEntity[],
  command_id: number,
  timestamp: number
): Fact[] {
  return entities.map(entity => ({
    fact_id: `${entity.id}:${command_id}`,
    type: entity.type as any,
    payload: entity.attrs,
    provenance: entity.provenance || {
      command_id,
      line: -1, // Unknown line (regex doesn't track)
      timestamp,
      source: 'token-harvester'
    },
    timestamp
  }));
}
