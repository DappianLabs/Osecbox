/**
 * Pivot Detector
 * Identifies when traffic routes through another host
 */

import type { WorkingSession as Session, Edge, PivotMethod } from './types';

export function detectPivot(
  session: Session,
  command: string,
  currentHost: string
): void {
  const commandLower = command.toLowerCase();

  // Proxychains
  if (commandLower.includes('proxychains')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'proxy');
    }
  }

  // SSH tunnel (-L, -R, -D)
  if (
    commandLower.includes('ssh') &&
    (commandLower.includes(' -l') ||
      commandLower.includes(' -r') ||
      commandLower.includes(' -d'))
  ) {
    const target = extractSSHTarget(command);
    if (target) {
      addEdge(session, currentHost, target, 'ssh');
    }
  }

  // Chisel
  if (commandLower.includes('chisel')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'tunnel');
    }
  }

  // Ligolo-ng proxy/agent commands are passive indicators only. This does
  // not open a socket or infer a pivot from a command that merely contains
  // the tool name; a target must be present with a role-specific flag.
  if (
    commandLower.includes('ligolo') &&
    (commandLower.includes(' -connect ') || commandLower.includes(' -bind ') || commandLower.includes(' -laddr '))
  ) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'ligolo');
    }
  }

  // sshuttle routes a subnet through an SSH foothold. Record the remote host
  // when it is present, while keeping the parser passive and IP-only.
  if (commandLower.includes('sshuttle')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'sshuttle');
    }
  }

  // Socat relay commands establish a local listener and forward to a remote
  // endpoint. Only record an edge when the command contains both sides.
  if (commandLower.includes('socat') && commandLower.includes('tcp-listen')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'socat');
    }
  }

  // Reverse shell
  if (
    commandLower.includes('nc') &&
    (commandLower.includes('-e') || commandLower.includes('-c'))
  ) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'reverse_shell');
    }
  }

  // SMB mount
  if (commandLower.includes('mount') && commandLower.includes('cifs')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'smb');
    }
  }

  // RDP
  if (commandLower.includes('xfreerdp') || commandLower.includes('rdesktop')) {
    const target = extractTargetIP(command);
    if (target) {
      addEdge(session, currentHost, target, 'rdp');
    }
  }
}

function addEdge(
  session: Session,
  fromHost: string,
  toHost: string,
  method: PivotMethod
): void {
  // Check if edge already exists
  const exists = session.edges.some(
    edge =>
      edge.from_host === fromHost &&
      edge.to_host === toHost &&
      edge.method === method
  );

  if (!exists) {
    session.edges.push({
      from_host: fromHost,
      to_host: toHost,
      method,
      established_at: Date.now()
    });
  }
}

function extractTargetIP(command: string): string | null {
  const ipMatch = command.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  return ipMatch ? ipMatch[0] : null;
}

function extractSSHTarget(command: string): string | null {
  // ssh user@host or ssh host
  const match = command.match(/ssh\s+(?:[a-z0-9_-]+@)?([a-z0-9\.\-]+)/i);
  return match ? match[1] : null;
}

export function getPivotPath(
  session: Session,
  fromHost: string,
  toHost: string
): Edge[] {
  // Simple BFS to find path
  const visited = new Set<string>();
  const queue: { host: string; path: Edge[] }[] = [
    { host: fromHost, path: [] }
  ];

  while (queue.length > 0) {
    const { host, path } = queue.shift()!;

    if (host === toHost) {
      return path;
    }

    if (visited.has(host)) continue;
    visited.add(host);

    // Find edges from this host
    const edges = session.edges.filter(e => e.from_host === host);
    for (const edge of edges) {
      queue.push({
        host: edge.to_host,
        path: [...path, edge]
      });
    }
  }

  return [];
}

export function getConnectedHosts(session: Session, hostId: string): string[] {
  const connected = new Set<string>();

  for (const edge of session.edges) {
    if (edge.from_host === hostId) {
      connected.add(edge.to_host);
    }
    if (edge.to_host === hostId) {
      connected.add(edge.from_host);
    }
  }

  return Array.from(connected);
}

export function getPivotDepth(session: Session, hostId: string): number {
  // Calculate how many hops from local
  const localHost = Array.from(session.hosts.values()).find(
    h => h.role === 'local'
  );
  if (!localHost) return 0;

  const path = getPivotPath(session, localHost.id, hostId);
  return path.length;
}
