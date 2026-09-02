import { describe, expect, it } from 'vitest';
import { parseAutomationTargets, splitAutomationTarget } from '../client/src/lib/automation-targets';
import { TopologyAutoMapper } from '../client/src/lib/topology-auto-mapper';
import { getScannerHistoryStorageKey, scannerUsesLocalHistory } from '../client/src/lib/scanner/scanner-history';
import { formatScannerOptions, tokenizeScannerOptions } from '../client/src/lib/scanner/scanner-options';

describe('operational section contracts', () => {
  it('uses strict shared validation for Automation targets', () => {
    const parsed = parseAutomationTargets([
      '10.10.10.5 --script vuln',
      'example.test',
      '999.999.999.999',
      '10.0.0.0/33',
    ].join('\n'));

    expect(parsed.valid).toEqual(['10.10.10.5 --script vuln', 'example.test']);
    expect(parsed.invalid).toEqual(['999.999.999.999', '10.0.0.0/33']);
    expect(splitAutomationTarget(parsed.valid[0])).toEqual({
      target: '10.10.10.5',
      flags: ['--script', 'vuln'],
    });
  });

  it('forwards quoted custom scanner flags as shell-safe arguments', () => {
    expect(tokenizeScannerOptions(['--script "http-*"', '-p', '80,443'])).toEqual([
      '--script',
      'http-*',
      '-p',
      '80,443',
    ]);

    const command = formatScannerOptions(['--script vuln', '$(not-a-command)'], 'posix');
    expect(command).toBe("'--script' 'vuln' '$(not-a-command)'");
  });

  it('connects scan-derived topology hosts to the attacker scope', () => {
    const nodes = TopologyAutoMapper.generateScanNodes([
      { ip: '10.10.10.5', hostname: 'web', status: 'up' },
      { ip: '10.10.10.6', status: 'down' },
    ]);
    const nodeIds = new Set(['attacker', ...nodes.map(node => node.id)]);
    const connections = TopologyAutoMapper.generateScanConnections([
      { ip: '10.10.10.5', hostname: 'web', status: 'up' },
      { ip: '10.10.10.6', status: 'down' },
    ], nodeIds);

    expect(connections).toHaveLength(2);
    expect(connections.every(connection => connection.from === 'attacker')).toBe(true);
    expect(connections.map(connection => connection.to)).toEqual([
      'scan-10.10.10.5',
      'scan-10.10.10.6',
    ]);
  });
  
  it('keeps scanner history isolated from Custom results', () => {
    expect(getScannerHistoryStorageKey('universal')).toBe('universal-history');
    expect(getScannerHistoryStorageKey('nuclei')).toBe('nuclei-history');
    expect(getScannerHistoryStorageKey('dirbuster')).toBe('dirbuster-history');
    expect(scannerUsesLocalHistory('universal')).toBe(true);
    expect(scannerUsesLocalHistory('nuclei')).toBe(false);
  });
});
