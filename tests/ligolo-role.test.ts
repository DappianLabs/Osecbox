import { describe, expect, it } from 'vitest';
import { classifyLigoloRole } from '../electron/utils/ligolo-role';

describe('Ligolo-ng role classification', () => {
  it('identifies proxy/server help output', () => {
    expect(classifyLigoloRole('  -selfcert   server certificate\n  -laddr string')).toBe('proxy');
  });

  it('identifies agent/client help output', () => {
    expect(classifyLigoloRole('  -connect string\n  -ignore-cert')).toBe('agent');
  });

  it('does not guess a role from unrelated output', () => {
    expect(classifyLigoloRole('Ligolo-ng version information only')).toBe('unknown');
  });
});

