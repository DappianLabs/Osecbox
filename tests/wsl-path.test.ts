import { describe, expect, it } from 'vitest';
import { buildWslPath, toWslPath } from '../electron/utils/wsl-path';

describe('WSL path helpers', () => {
  it('converts Windows drive paths to /mnt paths', () => {
    expect(toWslPath('C:\\Users\\tester\\tools')).toBe('/mnt/c/Users/tester/tools');
  });

  it('quotes configured PATH entries without breaking spaces or shell data', () => {
    const value = buildWslPath(['/opt/my tools', '$HOME/custom/bin']);

    expect(value).toContain('"$HOME/go/bin"');
    expect(value).toContain("'/opt/my tools'");
    expect(value).toContain('"$HOME/custom/bin"');
  });
});
