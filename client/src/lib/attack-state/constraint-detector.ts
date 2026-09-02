/**
 * Constraint Detector
 * Learns what doesn't work from repeated failures
 */

import type { Host, Move, Constraint } from './types';

const FAILURE_THRESHOLD = 3;

export function updateConstraints(host: Host, move: Move): void {
  if (move.result !== 'fail') return;

  const stderrKeywords = move.stderr_keywords || [];

  // Outbound HTTP blocked
  if (
    move.scope === 'network' &&
    (stderrKeywords.includes('connection refused') ||
      stderrKeywords.includes('timeout') ||
      stderrKeywords.includes('blocked')) &&
    (move.target?.includes('http') || move.exit_code === 7)
  ) {
    updateConstraint(host, 'outbound_http');
  }

  // Outbound DNS blocked
  if (
    move.scope === 'network' &&
    (stderrKeywords.includes('not found') ||
      stderrKeywords.includes('timeout')) &&
    (move.target?.includes('dns') || move.exit_code === 2)
  ) {
    updateConstraint(host, 'outbound_dns');
  }

  // Sudo denied
  if (
    move.scope === 'privilege' &&
    (stderrKeywords.includes('permission denied') ||
      stderrKeywords.includes('not in sudoers')) &&
    move.target === 'sudo'
  ) {
    updateConstraint(host, 'sudo');
  }

  // Root write denied
  if (
    move.scope === 'filesystem' &&
    stderrKeywords.includes('permission denied') &&
    move.target?.startsWith('/root')
  ) {
    updateConstraint(host, 'write_root');
  }

  // Package install blocked
  if (
    move.scope === 'execution' &&
    (stderrKeywords.includes('permission denied') ||
      stderrKeywords.includes('not found')) &&
    (move.target?.includes('apt') ||
      move.target?.includes('yum') ||
      move.target?.includes('dnf'))
  ) {
    updateConstraint(host, 'package_install');
  }
}

function updateConstraint(
  host: Host,
  constraintType: keyof Host['constraints']
): void {
  const constraint = host.constraints[constraintType] || {
    blocked: false,
    attempts: 0,
    last_try: 0
  };

  constraint.attempts++;
  constraint.last_try = Date.now();

  // Block after threshold
  if (constraint.attempts >= FAILURE_THRESHOLD) {
    constraint.blocked = true;
  }

  host.constraints[constraintType] = constraint;
}

export function isConstraintBlocked(
  host: Host,
  constraintType: keyof Host['constraints']
): boolean {
  return host.constraints[constraintType]?.blocked || false;
}

export function getBlockedConstraints(host: Host): string[] {
  const blocked: string[] = [];

  for (const [key, value] of Object.entries(host.constraints)) {
    if (value?.blocked) {
      blocked.push(key);
    }
  }

  return blocked;
}

export function resetConstraint(
  host: Host,
  constraintType: keyof Host['constraints']
): void {
  delete host.constraints[constraintType];
}
