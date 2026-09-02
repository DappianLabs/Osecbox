import { describe, expect, it, vi } from 'vitest';
import { PTYManager } from '../client/src/lib/terminal/pty-manager';

describe('PTY manager recovery lifecycle', () => {
  it('forgets an already-dead PTY without sending a second backend stop', () => {
    const onDestroy = vi.fn();
    const manager = new PTYManager(onDestroy);
    const pty = manager.createPTY('scan-tab::nuclei', 'scan');
    pty.isActive = false;

    manager.forgetPTY('scan-tab::nuclei');

    expect(manager.hasPTY('scan-tab::nuclei')).toBe(false);
    expect(onDestroy).not.toHaveBeenCalled();
  });

  it('still invokes the backend stop for an explicit destroy', () => {
    const onDestroy = vi.fn();
    const manager = new PTYManager(onDestroy);
    manager.createPTY('tunnel-1', 'tunneling');

    manager.destroyPTY('tunnel-1');

    expect(onDestroy).toHaveBeenCalledWith('tunnel-1', 'tunneling');
    expect(manager.hasPTY('tunnel-1')).toBe(false);
  });
});
