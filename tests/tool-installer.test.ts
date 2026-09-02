import { describe, expect, it } from 'vitest';
import { SUPPORTED_INSTALL_TOOLS, toolInstaller } from '../electron/tool-installer';

describe('tool installer compatibility catalog', () => {
  it('covers binaries checked by the title bar and tool views', () => {
    expect(SUPPORTED_INSTALL_TOOLS).toContain('assetfinder');
    expect(SUPPORTED_INSTALL_TOOLS).toContain('ffuf');
    expect(SUPPORTED_INSTALL_TOOLS).toContain('msfvenom');
    expect(SUPPORTED_INSTALL_TOOLS).toContain('ssh');
    expect(SUPPORTED_INSTALL_TOOLS).toContain('nc');
    expect(SUPPORTED_INSTALL_TOOLS).toContain('python3');

    for (const tool of ['assetfinder', 'ffuf', 'msfvenom', 'ssh', 'python3', 'nc']) {
      const info = toolInstaller.getInstallCommand(tool, 'Ubuntu');
      expect(info.packageManager).not.toBe('unknown');
      expect(info.command).not.toMatch(/^# Install /);
    }
  });

  it('creates a bounded, idempotent bash setup script for missing tools', () => {
    const bundle = toolInstaller.getInstallScript(
      ['ffuf', 'assetfinder', 'ffuf', 'not-a-supported-tool'],
      'Ubuntu',
      'wsl2',
    );

    expect(bundle.shell).toBe('bash');
    expect(bundle.runtime).toBe('wsl2');
    expect(bundle.tools).toEqual(['ffuf', 'assetfinder']);
    expect(bundle.script).toContain('set -Eeuo pipefail');
    expect(bundle.script).toContain('command -v \'ffuf\'');
    expect(bundle.script).toContain('go install github.com/ffuf/ffuf/v2@latest');
    expect(bundle.script).not.toContain('wsl ');
  });

  it('keeps installer output names aligned with the commands launched by tunneling UI', () => {
    const info = toolInstaller.getInstallCommand('ligolo-ng', 'Ubuntu');

    expect(info.command).toContain('GOBIN="$HOME/go/bin"');
    expect(info.command).toContain('"$HOME/go/bin/ligolo-ng"');
  });
});
