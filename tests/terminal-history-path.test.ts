import { describe, expect, it } from 'vitest';
import { getTerminalHistoryFileStem } from '../electron/utils/terminal-history-path';

describe('terminal history file stems', () => {
  it('removes Windows-reserved separators while remaining deterministic', () => {
    const first = getTerminalHistoryFileStem('scan-tab-123::nmap');
    const second = getTerminalHistoryFileStem('scan-tab-123::nmap');

    expect(first).toBe(second);
    expect(first).toMatch(/^pty_scan-tab-123_nmap_[a-f0-9]{12}$/);
    expect(first).not.toContain(':');
  });

  it('keeps sanitized ids distinct', () => {
    expect(getTerminalHistoryFileStem('a:b')).not.toBe(getTerminalHistoryFileStem('a/b'));
  });
});
