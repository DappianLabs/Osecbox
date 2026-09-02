import { describe, expect, it } from 'vitest';
import { buildManagedShellCommand } from '../client/src/lib/terminal/command-lifecycle';

describe('managed shell command lifecycle', () => {
  it('emits the POSIX completion marker without changing the command', async () => {
    const command = await buildManagedShellCommand('nmap 10.0.0.5');

    expect(command).toContain('nmap 10.0.0.5;');
    expect(command).toContain('osecbox-command-exit');
    expect(command).toContain('"$?"');
  });

  it('uses LASTEXITCODE for native PowerShell tools', async () => {
    const originalElectron = (window as any).electron;
    (window as any).electron = {
      platform: 'win32',
      getPlatformInfo: async () => ({ platformInfo: { wsl2Status: 'unavailable' } }),
    };

    try {
      const command = await buildManagedShellCommand('nmap 10.0.0.5');
      expect(command).toContain('$global:LASTEXITCODE = 0;');
      expect(command).toContain('$LASTEXITCODE -is [int]');
      expect(command).toContain('osecbox-command-exit');
    } finally {
      (window as any).electron = originalElectron;
    }
  });
});
