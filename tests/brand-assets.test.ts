import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): Buffer {
  return fs.readFileSync(path.join(root, relativePath));
}

function pngDimensions(data: Buffer): { width: number; height: number } {
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(data.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

describe('OsecBox brand assets', () => {
  it('keeps native, browser, and renderer icon assets present at the expected sizes', () => {
    const expectedPngs: Record<string, number> = {
      'build/icon.png': 1024,
      'client/public/osecbox-icon.png': 512,
      'client/public/favicon.png': 64,
    };

    for (const [relativePath, size] of Object.entries(expectedPngs)) {
      const data = read(relativePath);
      expect(data.length, relativePath).toBeGreaterThan(0);
      expect(pngDimensions(data), relativePath).toEqual({ width: size, height: size });
    }
  });

  it('contains valid Windows ICO and macOS ICNS containers', () => {
    const ico = read('build/icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(7);
    for (let index = 0; index < ico.readUInt16LE(4); index += 1) {
      const entryOffset = 6 + index * 16;
      const size = ico.readUInt32LE(entryOffset + 8);
      const dataOffset = ico.readUInt32LE(entryOffset + 12);
      expect(size).toBeGreaterThan(0);
      expect(dataOffset + size).toBeLessThanOrEqual(ico.length);
    }

    const icns = read('build/icon.icns');
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    for (const type of ['ic07', 'ic08', 'ic09', 'ic10']) {
      expect(icns.includes(Buffer.from(type, 'ascii')), type).toBe(true);
    }
  });

  it('wires the same mark into packaging and first-paint surfaces', () => {
    const builder = JSON.parse(read('electron-builder.json').toString('utf8'));
    expect(builder.icon).toBe('icon');
    expect(read('electron/main.ts').toString('utf8')).toContain("../public/osecbox-icon.png");
    expect(read('client/index.html').toString('utf8')).toContain('./osecbox-icon.png');
    expect(read('client/index.html').toString('utf8')).toContain('./favicon.png');
    expect(read('client/src/components/layout/MainSidebar.tsx').toString('utf8')).toContain('./osecbox-icon.png');
    expect(read('client/src/components/layout/TitleBar.tsx').toString('utf8')).toContain('./osecbox-icon.png');
    expect(read('client/src/components/dialogs/AboutDialog.tsx').toString('utf8')).toContain('./osecbox-icon.png');
  });
});
