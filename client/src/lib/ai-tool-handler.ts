/**
 * AI Tool Handler
 * Handles AI function calling for context expansion
 */

import { terminalService } from './terminal-service';
import { useAttackState } from './attack-state-store';
import { useSettingsStore } from './settings-store';
import { redactSensitiveText } from './ai-data-policy';
import { targetsMatch } from './attack-state/command-output-store';

let isInitialized = false;

/**
 * Initialize AI tool handler
 */
export function initializeAIToolHandler() {
  if (isInitialized) {
    console.log('[AIToolHandler] Already initialized');
    return;
  }

  if (!window.electron?.onAIToolRequest) {
    console.warn('[AIToolHandler] Electron API not available');
    return;
  }

  console.log('[AIToolHandler] Initializing tool handler...');

  const cleanup = window.electron.onAIToolRequest(async (data) => {
    const { requestId, toolName, args, scope } = data;
    console.log(`[AIToolHandler] Executing tool: ${toolName} (request: ${requestId})`);

    try {
      let result: any;

      switch (toolName) {
        case 'get_more_terminal_output':
          result = await handleGetMoreTerminalOutput(args, scope);
          break;

        case 'get_file_content':
          result = await handleGetFileContent(args, scope);
          break;

        case 'get_findings_by_type':
          result = await handleGetFindingsByType(args, scope);
          break;

        case 'enable_heavy_context':
          result = await handleEnableHeavyContext();
          break;

        case 'get_attack_paths':
          result = await handleGetAttackPaths(args, scope);
          break;

        case 'search_knowledge_graph':
          result = await handleSearchKnowledgeGraph(args, scope);
          break;

        default:
          result = { error: `Unknown tool: ${toolName}` };
      }

      // Send response to unique channel using requestId
      if (window.electron) {
        window.electron.sendAIToolResponse(requestId, result);
      }
    } catch (error: any) {
      console.error(`[AIToolHandler] Tool execution failed:`, error);
      if (window.electron) {
        window.electron.sendAIToolResponse(requestId, {
          error: error.message || 'Tool execution failed',
        });
      }
    }
  });

  isInitialized = true;
  console.log('[AIToolHandler] Initialized successfully');

  // Return cleanup function
  return cleanup;
}

/**
 * Get more terminal output
 */
async function handleGetMoreTerminalOutput(args: any, scope: any = {}): Promise<any> {
  const terminalId = typeof args?.terminalId === 'string' ? args.terminalId : 'current';
  const requestedLines = Number(args?.maxLines);
  const maxLines = Number.isFinite(requestedLines)
    ? Math.min(1200, Math.max(40, Math.floor(requestedLines)))
    : 1000;

  try {
    const activeId = scope?.terminalId || (typeof window !== 'undefined' && (window as any).__activeAiTerminalId) || null;
    // Resolve the terminal to read: explicit id (unless the model said 'current'), else the active AI terminal.
    let resolvedId: string | null =
      (terminalId && terminalId !== 'current') ? terminalId : activeId;
    if (scope?.tabId && resolvedId && !resolvedId.startsWith(`${scope.tabId}::`) && resolvedId !== scope.tabId) {
      return { error: 'Requested terminal is outside the active AI tab scope' };
    }
    if (scope?.terminalId && resolvedId && resolvedId !== scope.terminalId) {
      return { error: 'Requested terminal is outside the active AI terminal scope' };
    }
    if (resolvedId && !isTerminalAllowedForTarget(resolvedId, scope)) {
      return { error: 'Requested terminal is outside the active AI target scope' };
    }
    let output = resolvedId ? terminalService.getOutput(resolvedId) : '';
    // Fallback: if still empty and we have a base tab id, probe known scanner terminals.
    if ((!output || output.length === 0) && activeId) {
      const baseTab = activeId.split('::')[0];
      for (const st of ['nmap', 'nikto', 'nuclei', 'dirbuster']) {
        const alt = terminalService.getOutput(`${baseTab}::${st}`);
        if (alt && alt.length > 0) { output = alt; resolvedId = `${baseTab}::${st}`; break; }
      }
    }
    
    if (!output) {
      return { 
        output: '',
        lines: 0,
        message: 'No output available for this terminal'
      };
    }

    const lines = output.split('\n');
    const limitedLines = lines.slice(-maxLines).map(line => redactSensitiveText(line));

    return {
      output: limitedLines.join('\n'),
      lines: limitedLines.length,
      totalLines: lines.length,
      truncated: lines.length > maxLines,
    };
  } catch (error: any) {
    return { error: error.message || 'Failed to get terminal output' };
  }
}

/**
 * Search captured terminal output for a requested file/config path. This is
 * intentionally not a filesystem read: the model can expand evidence already
 * collected by the operator, but it cannot turn a context request into an
 * arbitrary local file exfiltration primitive.
 */
async function handleGetFileContent(args: any, scope: any = {}): Promise<any> {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!path) return { error: 'path is required' };

  const terminalId = typeof args?.terminalId === 'string' ? args.terminalId : 'current';
  const requestedLines = Number(args?.maxLines);
  const maxLines = Number.isFinite(requestedLines) ? Math.min(400, Math.max(20, Math.floor(requestedLines))) : 160;
  const activeId = scope?.terminalId || (typeof window !== 'undefined' && (window as any).__activeAiTerminalId) || null;
  const resolvedId = terminalId === 'current' ? activeId : terminalId;
  if (scope?.tabId && resolvedId && !resolvedId.startsWith(`${scope.tabId}::`) && resolvedId !== scope.tabId) {
    return { error: 'Requested terminal is outside the active AI tab scope' };
  }
  if (scope?.terminalId && resolvedId && resolvedId !== scope.terminalId) {
    return { error: 'Requested terminal is outside the active AI terminal scope' };
  }
  if (resolvedId && !isTerminalAllowedForTarget(resolvedId, scope)) {
    return { error: 'Requested terminal is outside the active AI target scope' };
  }

  const normalizedPath = path.toLowerCase();
  const sources: Array<{ terminalId?: string; output: string }> = [];
  const terminalOutput = resolvedId ? terminalService.getOutput(resolvedId) : '';
  if (terminalOutput) sources.push({ terminalId: resolvedId || undefined, output: terminalOutput });

  // A terminal can be temporarily detached while its bounded command record
  // remains available. Search that already-captured evidence as a fallback;
  // never turn this context tool into an arbitrary filesystem read.
  try {
    const { manager } = useAttackState.getState();
    const records = manager?.commandOutputStore?.getScopedOutputs?.(scope || {}) || [];
    for (const record of records.slice(-80)) {
      if (resolvedId && record.terminalId && record.terminalId !== resolvedId) continue;
      const recordOutput = `${record.command || ''}\n${record.output || ''}${record.stderr ? `\n${record.stderr}` : ''}`;
      if (recordOutput.toLowerCase().includes(normalizedPath)) {
        sources.push({ terminalId: record.terminalId, output: recordOutput });
      }
    }
  } catch {
    // Terminal output remains the primary source; a missing attack-state store
    // should produce an empty result rather than a tool failure.
  }

  const matches: string[] = [];
  const seenLines = new Set<string>();
  let totalMatches = 0;
  for (const source of sources) {
    const lines = source.output.split(/\r?\n/);
    const matchingIndexes = lines
      .map((line, index) => line.toLowerCase().includes(normalizedPath) ? index : -1)
      .filter(index => index >= 0);
    totalMatches += matchingIndexes.length;
    const selectedIndexes = new Set<number>();
    for (const matchIndex of matchingIndexes.slice(-12)) {
      // Include a small lead-in and following block because `cat file` usually
      // prints the path in the command line and the actual values on later
      // lines. All returned lines still pass through provider redaction.
      for (let index = Math.max(0, matchIndex - 3); index < Math.min(lines.length, matchIndex + 80); index += 1) {
        selectedIndexes.add(index);
        if (selectedIndexes.size >= maxLines) break;
      }
      if (selectedIndexes.size >= maxLines) break;
    }
    for (const index of Array.from(selectedIndexes).sort((left, right) => left - right)) {
      const line = `${source.terminalId ? `[${source.terminalId}] ` : ''}${index + 1}: ${redactSensitiveText(lines[index])}`;
      if (!seenLines.has(line)) {
        seenLines.add(line);
        matches.push(line);
      }
      if (matches.length >= maxLines) break;
    }
    if (matches.length >= maxLines) break;
  }

  return {
    path,
    terminalId: resolvedId || (sources.length > 0 ? 'captured command output' : undefined),
    output: matches.join('\n'),
    lines: matches.length,
    totalMatches,
    message: matches.length > 0 ? undefined : 'Path was not present in captured output; run an authorized read command in the terminal if needed.',
  };
}

/**
 * Get findings by type from attack state
 */
async function handleGetFindingsByType(args: any, scope: any = {}): Promise<any> {
  const { findingType } = args;

  if (!findingType) {
    return { error: 'findingType is required' };
  }

  try {
    const { session, manager } = useAttackState.getState();

    if (!session || !manager) {
      return {
        findings: [],
        message: 'Attack state not initialized',
      };
    }

    // Extract findings based on type
    const findings: any[] = [];

    // Type-safe hosts iteration
    // WorkingSession.hosts is a Map<string, Host>
    const hostsMap = session.hosts;
    if (!hostsMap || !(hostsMap instanceof Map)) {
      console.error('[AIToolHandler] hosts is not a Map:', typeof hostsMap);
      return {
        findings: [],
        message: 'Invalid hosts structure in attack state',
      };
    }
    
    if (hostsMap.size === 0) {
      return {
        findings: [],
        message: 'No hosts in attack state',
      };
    }

    const scopedHosts = getHostsForScope(hostsMap, scope);

    switch (findingType) {
      case 'credential':
        scopedHosts.forEach((host: any) => {
          if (host.loot && Array.isArray(host.loot)) {
            host.loot.forEach((loot: any) => {
              if (loot.type === 'credential') {
                findings.push({
                  hostId: host.id,
                  hostIp: host.ip,
                  ...loot,
                  value: redactToolValue(loot.value),
                  source: redactToolValue(loot.source),
                });
              }
            });
          }
        });
        break;

      case 'port':
        scopedHosts.forEach((host: any) => {
          if (host.ports && Array.isArray(host.ports)) {
            host.ports.forEach((port: any) => {
              findings.push({
                hostId: host.id,
                hostIp: host.ip,
                port: port.port,
                protocol: port.protocol,
                state: port.state,
                service: port.service,
                version: port.version,
              });
            });
          }
        });
        break;

      case 'service':
        scopedHosts.forEach((host: any) => {
          if (host.ports && Array.isArray(host.ports)) {
            host.ports.forEach((port: any) => {
              if (port.service) {
                findings.push({
                  hostId: host.id,
                  hostIp: host.ip,
                  port: port.port,
                  service: port.service,
                  version: port.version,
                });
              }
            });
          }
        });
        break;

      case 'suid':
      case 'sudo':
      case 'capability':
      case 'writable':
        scopedHosts.forEach((host: any) => {
          if (host.loot && Array.isArray(host.loot)) {
            host.loot.forEach((loot: any) => {
              if (loot.type === findingType) {
                findings.push({
                  hostId: host.id,
                  hostIp: host.ip,
                  ...loot,
                  value: redactToolValue(loot.value),
                  source: redactToolValue(loot.source),
                });
              }
            });
          }
        });
        break;

      case 'vuln':
        scopedHosts.forEach((host: any) => {
          if (host.vulnerabilities && Array.isArray(host.vulnerabilities)) {
            host.vulnerabilities.forEach((vuln: any) => {
              findings.push({
                hostId: host.id,
                hostIp: host.ip,
                ...vuln,
                description: redactToolValue(vuln.description),
              });
            });
          }
        });
        break;

      default:
        if (findingType === 'process' || findingType === 'network') {
          const outputs = manager.commandOutputStore?.getScopedOutputs?.(scope || {}) || manager.commandOutputStore?.getAllOutputs?.() || [];
          const pattern = findingType === 'process'
            ? /\bps\b|\btop\b|\bhtop\b|\bpgrep\b/i
            : /\bnmap\b|\bmasscan\b|\bnetstat\b|\bss\b|\blisten(?:ing)?\b|\bopen\b/i;
          const records = outputs.filter((record: any) => pattern.test(`${record.command}\n${record.output}`)).slice(-100);
          return {
            findings: records.map((record: any) => ({
              command: redactSensitiveText(record.command),
              terminalId: record.terminalId,
              target: redactSensitiveText(record.target || record.host || 'unknown-target'),
              output: redactSensitiveText(record.output).slice(-1800),
            })),
            count: records.length,
            findingType,
          };
        }
        return { error: `Unknown finding type: ${findingType}` };
    }

    return {
      findings,
      count: findings.length,
      findingType,
    };
  } catch (error: any) {
    return { error: error.message || 'Failed to get findings' };
  }
}

/**
 * Enable heavy context mode
 */
async function handleEnableHeavyContext(): Promise<any> {
  const { settings, updateSetting } = useSettingsStore.getState();
  const wasAlreadyEnabled = settings.aiContextMode === 'ultra';

  if (!wasAlreadyEnabled) {
    updateSetting('aiContextMode', 'ultra');
  }

  return {
    enabled: true,
    mode: 'ultra',
    tokenLimit: useSettingsStore.getState().settings.aiTokenLimit,
    message: wasAlreadyEnabled
      ? 'Ultra context mode is already enabled.'
      : 'Ultra context mode enabled for the next response.',
  };
}

/**
 * Get attack paths
 */
async function handleGetAttackPaths(args: any, scope: any = {}): Promise<any> {
  const { target = 'root' } = args;

  try {
    const { session, manager } = useAttackState.getState();

    if (!session || !manager) {
      return {
        paths: [],
        message: 'Attack state not initialized',
      };
    }

    // Get privilege escalation paths
    const paths: any[] = [];

    // Type-safe hosts iteration
    const hostsMap = session.hosts;
    if (!hostsMap || !(hostsMap instanceof Map)) {
      console.error('[AIToolHandler] hosts is not a Map:', typeof hostsMap);
      return {
        paths: [],
        message: 'Invalid hosts structure in attack state',
      };
    }
    
    if (hostsMap.size === 0) {
      return {
        paths: [],
        message: 'No hosts in attack state',
      };
    }

    const scopedHosts = getHostsForScope(hostsMap, scope);

    scopedHosts.forEach((host: any) => {
      if (!host.loot || !Array.isArray(host.loot)) {
        return;
      }

      // Check for direct paths to target
      const directPaths = host.loot.filter((loot: any) => {
        return (
          loot.type === 'sudo' ||
          loot.type === 'suid' ||
          loot.type === 'capability'
        );
      });

      if (directPaths.length > 0) {
        paths.push({
          hostId: host.id,
          hostIp: host.ip,
          type: 'privilege_escalation',
          methods: directPaths.map((p: any) => ({
            type: p.type,
            value: redactToolValue(p.value),
            confidence: p.confidence,
          })),
        });
      }

      // Check for lateral movement paths
      const credentials = host.loot.filter((l: any) => l.type === 'credential');
      if (credentials.length > 0) {
        paths.push({
          hostId: host.id,
          hostIp: host.ip,
          type: 'lateral_movement',
          credentials: credentials.map((c: any) => ({
            username: redactToolValue(c.value),
            source: redactToolValue(c.source),
          })),
        });
      }
    });

    return {
      paths,
      count: paths.length,
      target,
    };
  } catch (error: any) {
    return { error: error.message || 'Failed to get attack paths' };
  }
}

/**
 * Search knowledge graph
 */
async function handleSearchKnowledgeGraph(args: any, scope: any = {}): Promise<any> {
  const { query } = args;

  if (!query) {
    return { error: 'query is required' };
  }

  try {
    const { session } = useAttackState.getState();

    if (!session) {
      return {
        results: [],
        message: 'Attack state not initialized',
      };
    }

    const results: any[] = [];
    const lowerQuery = query.toLowerCase();

    // Type-safe hosts iteration
    const hostsMap = session.hosts;
    if (!hostsMap || !(hostsMap instanceof Map)) {
      console.error('[AIToolHandler] hosts is not a Map:', typeof hostsMap);
      return {
        results: [],
        message: 'Invalid hosts structure in attack state',
      };
    }
    
    if (hostsMap.size === 0) {
      return {
        results: [],
        message: 'No hosts in attack state',
      };
    }

    const scopedHosts = getHostsForScope(hostsMap, scope);

    // Search hosts
    scopedHosts.forEach((host: any) => {
      if (
        host.ip.includes(query) ||
        host.hostname?.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          type: 'host',
          hostId: host.id,
          hostIp: host.ip,
          hostname: host.hostname,
        });
      }

      // Search ports and services
      if (host.ports && Array.isArray(host.ports)) {
        host.ports.forEach((port: any) => {
          if (
            port.service?.toLowerCase().includes(lowerQuery) ||
            port.version?.toLowerCase().includes(lowerQuery)
          ) {
            results.push({
              type: 'service',
              hostId: host.id,
              hostIp: host.ip,
              port: port.port,
              service: port.service,
              version: port.version,
            });
          }
        });
      }

      // Search loot
      if (host.loot && Array.isArray(host.loot)) {
        host.loot.forEach((loot: any) => {
          if (
            loot.value?.toLowerCase().includes(lowerQuery) ||
            loot.source?.toLowerCase().includes(lowerQuery)
          ) {
            results.push({
              type: 'loot',
              hostId: host.id,
              hostIp: host.ip,
              lootType: loot.type,
              value: redactToolValue(loot.value),
              source: redactToolValue(loot.source),
            });
          }
        });
      }
    });

    return {
      results,
      count: results.length,
      query: redactToolValue(query),
    };
  } catch (error: any) {
    return { error: error.message || 'Failed to search knowledge graph' };
  }
}

function getHostsForScope(hostsMap: Map<string, any>, scope: any): any[] {
  const target = String(scope?.target || '').trim();
  if (!target) return Array.from(hostsMap.values());

  return Array.from(hostsMap.values()).filter((host: any) => {
    if (host?.role === 'local') return true;
    return [host?.ip, host?.hostname].filter(Boolean)
      .some(value => targetsMatch(target, String(value)));
  });
}

function isTerminalAllowedForTarget(terminalId: string, scope: any): boolean {
  const requestedTarget = String(scope?.target || '').trim();
  if (!requestedTarget) return true;

  const knownTarget = terminalService.getTerminalTarget?.(terminalId);
  if (knownTarget) return targetsMatch(requestedTarget, knownTarget);

  const store = useAttackState.getState().manager?.commandOutputStore;
  const records = store?.getAllOutputs?.().filter((record: any) =>
    record.terminalId === terminalId || record.terminalId?.startsWith(`${terminalId}::`),
  ) || [];
  if (records.length === 0) return false;

  return records.every((record: any) => {
    const candidate = String(record.target || record.host || '').trim();
    return Boolean(candidate && targetsMatch(requestedTarget, candidate));
  });
}

function redactToolValue(value: unknown): string {
  return redactSensitiveText(value);
}
