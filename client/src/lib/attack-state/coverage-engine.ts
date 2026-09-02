/**
 * Coverage Engine
 * Updates host coverage based on moves
 */

import type { Host, Move } from './types';

export function updateCoverage(host: Host, move: Move): void {
  if (move.result === 'success') {
    // Base increment for successful moves
    const increment = 2;
    host.coverage[move.scope] = Math.min(100, host.coverage[move.scope] + increment);
  } else if (move.result === 'partial') {
    // Smaller increment for partial success
    const increment = 1;
    host.coverage[move.scope] = Math.min(100, host.coverage[move.scope] + increment);
  }

  // Remove from unexplored
  if (move.target) {
    removeFromUnexplored(host, move.scope, move.target);
  }

  // Update paths (with limits to prevent unbounded growth)
  const MAX_PATHS = 500; // Cap at 500 paths per host
  
  if (move.scope === 'filesystem' && move.result === 'success' && move.target) {
    if (move.stderr_keywords?.includes('permission denied')) {
      // Can read but not write
      if (!host.readable_paths.includes(move.target) && host.readable_paths.length < MAX_PATHS) {
        host.readable_paths.push(move.target);
      }
    } else {
      // Assume writable if we could interact with it
      if (!host.writable_paths.includes(move.target) && host.writable_paths.length < MAX_PATHS) {
        host.writable_paths.push(move.target);
      }
      if (!host.readable_paths.includes(move.target) && host.readable_paths.length < MAX_PATHS) {
        host.readable_paths.push(move.target);
      }
    }
  }

  // Update last success
  if (move.result === 'success') {
    host.last_success = {
      scope: move.scope,
      timestamp: move.timestamp,
      description: `${move.scope} operation on ${move.target || 'target'}`
    };
  }
}

function removeFromUnexplored(host: Host, scope: string, target: string): void {
  const targetLower = target.toLowerCase();

  switch (scope) {
    case 'filesystem':
      host.unexplored.filesystem = host.unexplored.filesystem.filter(
        item => !item.path?.toLowerCase().includes(targetLower)
      );
      break;

    case 'network':
      host.unexplored.network = host.unexplored.network.filter(
        item => !item.service?.toLowerCase().includes(targetLower)
      );
      break;

    case 'auth':
      host.unexplored.auth = host.unexplored.auth.filter(
        item => !item.method?.toLowerCase().includes(targetLower)
      );
      break;

    case 'privilege':
      host.unexplored.privilege = host.unexplored.privilege.filter(
        item => !item.vector?.toLowerCase().includes(targetLower)
      );
      break;
  }
}

export function getCoveragePercentage(host: Host): number {
  const { filesystem, network, auth, privilege, execution } = host.coverage;
  return Math.round((filesystem + network + auth + privilege + execution) / 5);
}

export function getHighestCoverageScope(host: Host): string {
  const { filesystem, network, auth, privilege, execution } = host.coverage;
  const max = Math.max(filesystem, network, auth, privilege, execution);

  if (filesystem === max) return 'filesystem';
  if (network === max) return 'network';
  if (auth === max) return 'auth';
  if (privilege === max) return 'privilege';
  return 'execution';
}

export function getLowestCoverageScope(host: Host): string {
  const { filesystem, network, auth, privilege, execution } = host.coverage;
  const min = Math.min(filesystem, network, auth, privilege, execution);

  if (filesystem === min) return 'filesystem';
  if (network === min) return 'network';
  if (auth === min) return 'auth';
  if (privilege === min) return 'privilege';
  return 'execution';
}
