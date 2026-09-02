import { describe, expect, it } from 'vitest';
import {
  beginScanRun,
  cancelScanRun,
  getScanRunOutputMarker,
  getScanRunOutputOffset,
  hasActiveScanRun,
  setScanRunOutputBoundary,
} from '../client/src/lib/scanner/scan-run-registry';
import { getLatestScanTranscript } from '../client/src/lib/scanner/scan-transcript';

describe('scanner run ownership', () => {
  it('reports ownership only for the current replacement run', () => {
    const terminalId = 'scan-tab::nmap';
    const firstRun = beginScanRun(terminalId);
    expect(hasActiveScanRun(terminalId)).toBe(true);

    const secondRun = beginScanRun(terminalId);
    expect(secondRun).not.toBe(firstRun);
    expect(hasActiveScanRun(terminalId)).toBe(true);

    cancelScanRun(terminalId);
    expect(hasActiveScanRun(terminalId)).toBe(false);
  });

  it('keeps the transcript boundary scoped to the current replacement run', () => {
    const terminalId = 'scan-tab::nikto';
    const firstRun = beginScanRun(terminalId);
    const firstMarker = '\x1b]9;osecbox-scan-start;first\x07';

    expect(setScanRunOutputBoundary(terminalId, firstRun, 420, firstMarker)).toBe(true);
    expect(getScanRunOutputOffset(terminalId)).toBe(420);
    expect(getScanRunOutputMarker(terminalId)).toBe(firstMarker);

    const replacementRun = beginScanRun(terminalId);
    expect(replacementRun).not.toBe(firstRun);
    expect(getScanRunOutputOffset(terminalId)).toBeUndefined();
    expect(getScanRunOutputMarker(terminalId)).toBeUndefined();

    cancelScanRun(terminalId);
  });

  it('parses only the newest retained scanner transcript', () => {
    const first = '\x1b]9;osecbox-scan-start;first\x07old output\x1b]9;osecbox-command-exit;0\x07';
    const second = '\x1b]9;osecbox-scan-start;second\x07new output';

    expect(getLatestScanTranscript(`${first}${second}`)).toBe('new output');
    expect(getLatestScanTranscript('legacy transcript without a marker')).toBe('legacy transcript without a marker');
  });
});
