import { describe, expect, it, vi } from 'vitest';
import { preflightPort, preflightTool } from '../client/src/lib/runtime-preflight';

describe('runtime preflight adapters', () => {
  it('blocks a missing tool and names the actual WSL runtime', async () => {
    const result = await preflightTool('ligolo-ng', async () => ({
      success: true,
      available: false,
      usedWSL: true,
    }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ligolo-ng');
    expect(result.message).toContain('WSL2 Linux runtime');
  });

  it('does not hide a backend/tool-check error', async () => {
    const result = await preflightTool('socat', async () => ({
      success: false,
      error: 'WSL service access denied',
    }));

    expect(result).toEqual({ ok: false, message: 'WSL service access denied' });
  });

  it('surfaces an installed-but-unusable tool diagnostic', async () => {
    const result = await preflightTool('pwncat-cs', async () => ({
      success: true,
      available: false,
      usedWSL: true,
      error: 'pwncat-cs is incompatible with the current Python runtime',
    }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('pwncat-cs');
    expect(result.message).toContain('incompatible with the current Python runtime');
  });

  it('passes an available bind port and preserves occupancy-only warnings', async () => {
    const warning = await preflightPort(45132, '127.0.0.1', async () => ({
      success: true,
      available: true,
      status: 'available',
      verification: 'occupancy-only',
      message: 'Port was not reported as occupied; bind permission was not tested.',
    }));

    expect(warning).toEqual({
      ok: true,
      warning: 'Port was not reported as occupied; bind permission was not tested.',
    });
  });

  it.each([
    ['occupied', 'Port is already in use'],
    ['permission-denied', 'Port requires local privilege'],
    ['runtime-unavailable', 'WSL2 is unavailable'],
    ['diagnostic-unavailable', 'port preflight could not determine'],
  ] as const)('blocks a %s port preflight with a clear message', async (status, message) => {
    const result = await preflightPort(45132, '0.0.0.0', async () => ({
      success: true,
      available: false,
      status,
      message,
    }));

    expect(result.ok).toBe(false);
    expect(result.message).toBe(message);
  });

  it('turns probe exceptions into a visible failure', async () => {
    const result = await preflightPort(45132, '127.0.0.1', vi.fn(async () => {
      throw new Error('IPC disconnected');
    }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('IPC disconnected');
  });
});
