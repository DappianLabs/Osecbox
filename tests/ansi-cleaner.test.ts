import { describe, expect, it } from 'vitest';
import { cleanANSI, cleanANSIForDisplay } from '../client/src/lib/utils/ansi-cleaner';

describe('ANSI output boundaries', () => {
  it('removes private CSI cursor and bracketed-paste controls without touching tool text', () => {
    const escape = '\u001b';
    const output = `${escape}[?25h${escape}[?2004hmsf > search exploit${escape}[?25l`;

    expect(cleanANSIForDisplay(output)).toBe('msf > search exploit');
    expect(cleanANSIForDisplay(output)).not.toContain('25h');
    expect(cleanANSIForDisplay(output)).not.toContain('2004h');
  });

  it('preserves aligned Nmap/Nikto tables and ordinary whitespace', () => {
    const escape = '\u001b';
    const output = [
      `${escape}[1;32mPORT${escape}[0m     STATE  SERVICE`,
      '22/tcp   open   ssh',
      `${escape}[?25h+ Uncommon header 'x-content-type-options' found${escape}[?25l`,
    ].join('\n');

    expect(cleanANSIForDisplay(output)).toBe([
      'PORT     STATE  SERVICE',
      '22/tcp   open   ssh',
      "+ Uncommon header 'x-content-type-options' found",
    ].join('\n'));
  });

  it('removes OSC titles and non-printing controls', () => {
    const escape = '\u001b';
    const output = `${escape}]0;hidden title${escape}\\visible\u0007 text\u0000`;

    expect(cleanANSIForDisplay(output)).toBe('visible text');
  });

  it('renders carriage-return progress output as the final line', () => {
    expect(cleanANSIForDisplay('Progress 10%\rProgress 100%\nnext')).toBe('Progress 100%\nnext');
    expect(cleanANSIForDisplay('abc\b\bXY')).toBe('aXY');
  });

  it('keeps parser normalization separate from display layout', () => {
    const output = '\u001b[32m  finding    details  \u001b[0m\n\nnext';

    expect(cleanANSIForDisplay(output)).toBe('  finding    details  \n\nnext');
    expect(cleanANSI(output)).toBe('finding details\nnext');
  });
});
