import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../electron/utils/async-timeout';

describe('withTimeout', () => {
  it('returns the task result before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 100, 'fast task')).resolves.toBe('ready');
  });

  it('releases the caller when a lifecycle task is too slow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const slowTask = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 30));

    await expect(withTimeout(slowTask, 1, 'slow task')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[Lifecycle] slow task exceeded 1ms; continuing');

    warn.mockRestore();
  });

  it('preserves task errors that occur before the deadline', async () => {
    await expect(withTimeout(Promise.reject(new Error('failed')), 100, 'failing task'))
      .rejects.toThrow('failed');
  });
});
