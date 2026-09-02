/**
 * Core types for attack state tracking with provenance
 */

// Types used by the persisted attack-session model.

export type Phase = 'recon' | 'foothold' | 'privesc' | 'lateral' | 'exfil' | 'complete';
export type HostRole = 'local' | 'target' | 'pivot' | 'unknown';
export type MoveScope = 'filesystem' | 'network' | 'auth' | 'privilege' | 'execution';
export type MoveResult = 'success' | 'partial' | 'fail';
export type FootholdType = 'shell' | 'ssh' | 'ldap' | 'smb' | 'http' | 'rdp';
export type PivotMethod = 'proxy' | 'ssh' | 'tunnel' | 'reverse_shell' | 'smb' | 'rdp' | 'ligolo' | 'sshuttle' | 'socat';
export type LootType = 'credential' | 'suid' | 'sudo' | 'capability' | 'writable' | 'cve' | 'vulnerability' | 'token' | 'key' | 'hash' | 'config';

export interface Move {
  host: string;
  scope: MoveScope;
  target?: string;
  result: MoveResult;
  timestamp: number;
  exit_code: number;
  stderr_keywords: string[];
  stdout_size: number;
  duration: number;
}

export interface Constraint {
  blocked: boolean;
  attempts: number;
  last_try: number;
}

export interface Coverage {
  filesystem: number;
  network: number;
  auth: number;
  privilege: number;
  execution: number;
}

export interface Unexplored {
  filesystem: Array<{ path: string; priority: number }>;
  network: Array<{ service: string; priority: number }>;
  auth: Array<{ method: string; priority: number }>;
  privilege: Array<{ vector: string; priority: number }>;
}

export interface Host {
  id: string;
  ip: string;
  role: HostRole;
  footholds: Set<string>;
  foothold_details: Map<string, any>;
  constraints: Record<string, any>;
  coverage: Coverage;
  unexplored: Unexplored;
  writable_paths: string[];
  readable_paths: string[];
  blockers: string[];
  quick_wins: string[];
  time_in_scope: {
    filesystem: number;
    network: number;
    auth: number;
    privilege: number;
    execution: number;
  };
  last_activity: number;
  last_success?: {
    scope: MoveScope;
    timestamp: number;
    description: string;
  };
  ports?: Array<{ port: number; protocol: string; state: string; service?: string; version?: string }>;
  loot?: Loot[];
  vulnerabilities?: Array<{ cve?: string; description: string; severity: string }>;
}

export interface Loot {
  id: string;
  type: LootType;
  value: string;
  host: string;
  source: string;
  timestamp: number;
  confidence: number;
  used?: boolean;
  used_on?: string[];
}

export interface Edge {
  from_host: string;
  to_host: string;
  method: string;
  established_at: number;
}

// Extended Session type with actual working structure
export interface WorkingSession {
  id: string;
  phase: Phase;
  phase_changed_at: number;
  started_at: number;
  hosts: Map<string, Host>;
  edges: Edge[];
  loot: Map<string, Loot>;
  loot_cache: Set<string>;
  goal?: string;
  command_history: Array<{
    command: string;
    timestamp: number;
    host: string;
    scope: string;
    result: string;
    duration: number;
    output?: string;
    stderr?: string;
    exit_code?: number;
    session_id?: string;
    tab_id?: string;
    terminal_id?: string;
    target?: string;
    tool?: string;
    run_id?: string;
  }>;
  time_in_phase: number;
  target_ip?: string;
  current_phase?: Phase;
}

// ============================================================================
// PROVENANCE-BASED TYPES (For future fact-based system)
// ============================================================================

/**
 * Provenance: Where did this fact come from?
 * Every fact must be traceable to exact source
 */
export interface Provenance {
  command_id: number;      // Which command produced this fact
  line: number;            // Line number in command output
  timestamp: number;       // When was this fact created
  source: string;          // Which parser created this (e.g., 'nmap-parser', 'ps-parser')
  file?: string;           // Optional: file path if from file
  collector?: string;      // Optional: which agent/collector
}

/**
 * Fact: Immutable, provable piece of information
 * Facts are the atomic units of knowledge in the system
 */
export interface Fact {
  fact_id: string;         // Unique identifier (deterministic hash)
  type: FactType;          // Type of fact
  payload: any;            // Fact-specific data
  provenance: Provenance;  // Where this fact came from
  timestamp: number;       // When this fact was created
  confidence?: number;     // Optional: confidence score (0-100)
  tags?: string[];         // Optional: tags for categorization
}

/**
 * Fact types supported by the system
 */
export type FactType =
  // Network entities
  | 'host'
  | 'port'
  | 'service'
  | 'network'
  
  // Process entities
  | 'process'
  | 'socket'
  
  // Filesystem entities
  | 'file'
  | 'directory'
  
  // Credentials
  | 'credential'
  | 'token'
  | 'key'
  
  // Web entities
  | 'route'
  | 'endpoint'
  | 'cookie'
  
  // Container entities
  | 'container'
  | 'image'
  | 'volume'
  
  // Script outputs
  | 'script_output'
  | 'vulnerability'
  
  // Events
  | 'probe_event'
  | 'auth_event'
  | 'exploit_event'
  
  // Artifacts
  | 'leak'
  | 'sensitive_data'
  
  // Constraints
  | 'constraint'
  | 'blocker'
  
  // Relationships (edges)
  | 'relationship';

/**
 * Session: A pentest session with full provenance
 */
export interface Session {
  id: string;
  name: string;
  target: string;
  started_at: number;
  ended_at?: number;
  phase: 'recon' | 'foothold' | 'privesc' | 'lateral' | 'exfil' | 'complete';
  
  // Command history (for replay)
  command_history: Array<{
    command_id: number;
    command: string;
    output: string;
    timestamp: number;
    exit_code?: number;
  }>;
  
  // Facts discovered in this session
  facts: Fact[];
  
  // Session metadata
  metadata: {
    operator?: string;
    client?: string;
    engagement_type?: string;
    notes?: string;
  };
}

/**
 * Fact Delta: What changed between two states
 */
export interface FactDelta {
  delta_id: string;
  session_id: string;
  from_command_id: number;
  to_command_id: number;
  timestamp: number;
  
  added_facts: Fact[];
  removed_facts: Fact[];
  modified_facts: Array<{
    fact_id: string;
    old_payload: any;
    new_payload: any;
  }>;
}

/**
 * Projection: Human-readable narrative from facts
 */
export interface Projection {
  session_id: string;
  timestamp: number;
  narrative: string;  // Chronological text with fact citations
  facts_cited: string[];  // List of fact_ids referenced
}

/**
 * AI Response with fact citations
 */
export interface AIResponse {
  reasoning: string;
  suggestions: Array<{
    priority: number;
    host: string;
    scope: string;
    action: string;
    rationale: string;
    success_indicators: string[];
    facts_used: string[];  // Fact IDs that support this suggestion
  }>;
  facts_cited: string[];  // All fact IDs used in reasoning
  assumptions: string[];  // Explicit assumptions made
}
