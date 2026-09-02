import { describe, expect, it } from 'vitest';
import { getScannerTerminalId } from '../client/src/lib/scanner/scanner-scan';

describe('scanner terminal identity', () => {
  it('keeps each scanner output buffer isolated within a tab', () => {
    expect(getScannerTerminalId('scan-tab-42', 'nmap')).toBe('scan-tab-42::nmap');
    expect(getScannerTerminalId('scan-tab-42', 'nuclei')).toBe('scan-tab-42::nuclei');
    expect(getScannerTerminalId('scan-tab-42', 'nikto')).toBe('scan-tab-42::nikto');
    expect(getScannerTerminalId('scan-tab-42', 'nmap')).not.toBe(
      getScannerTerminalId('scan-tab-42', 'nuclei'),
    );
  });

  it('falls back to the stable Nmap identity for legacy tabs', () => {
    expect(getScannerTerminalId('legacy-tab', undefined)).toBe('legacy-tab::nmap');
  });
});
