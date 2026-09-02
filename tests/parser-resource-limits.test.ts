import { describe, expect, it } from 'vitest';
import {
  parseUniversalOutput,
  UNIVERSAL_PARSER_LIMITS,
} from '../client/src/lib/universal-parser';
import { parseMasscan, parseNmap } from '../client/src/lib/parsers/network-parsers';
import { parseNucleiOutput } from '../client/src/lib/parsers/nuclei-parser';
import { parseNmapOutput } from '../client/src/lib/nmap-parser';

describe('parser resource limits', () => {
  it('bounds oversized universal-parser input and reports truncation', () => {
    const output = `nmap -sV target.test\n${'noise-line\n'.repeat(
      Math.ceil(UNIVERSAL_PARSER_LIMITS.maxInputChars / 11) + 10,
    )}`;

    const result = parseUniversalOutput('nmap -sV target.test', output);

    expect(result.rawOutput.length).toBeLessThanOrEqual(UNIVERSAL_PARSER_LIMITS.maxInputChars);
    expect(result.metadata.rawOutputTruncated).toBe(true);
    expect(result.metadata.parserInputLength).toBe(result.rawOutput.length);
    expect(result.summary.truncated).toBe(true);
    expect(result.findings.some((finding) => finding.id === 'parse-input-truncated')).toBe(true);
  });

  it('caps high-volume nmap findings and leaves an explicit warning', () => {
    const ports = Array.from({ length: UNIVERSAL_PARSER_LIMITS.maxFindings + 500 }, (_, index) =>
      `${1000 + index}/tcp open custom service-${index}`,
    ).join('\n');
    const output = `Nmap scan report for 10.10.10.10\n${ports}`;

    const findings = parseNmap(output);

    expect(findings).toHaveLength(UNIVERSAL_PARSER_LIMITS.maxFindings);
    expect(findings.at(-1)).toMatchObject({
      id: 'nmap-truncated',
      type: 'warning',
    });
  });

  it('keeps the combined input and finding markers within the universal cap', () => {
    const ports = Array.from({ length: UNIVERSAL_PARSER_LIMITS.maxFindings + 250 }, (_, index) =>
      `${2000 + index}/tcp open bounded service-${index}`,
    ).join('\n');
    const oversizedOutput = `${'nmap noise\n'.repeat(
      Math.ceil(UNIVERSAL_PARSER_LIMITS.maxInputChars / 10) + 10,
    )}${ports}`;

    const result = parseUniversalOutput('nmap -sV target.test', oversizedOutput);

    expect(result.findings.length).toBeLessThanOrEqual(UNIVERSAL_PARSER_LIMITS.maxFindings);
    expect(result.summary.truncated).toBe(true);
  });

  it('keeps valid findings when diagnostic error text is present', () => {
    const result = parseUniversalOutput(
      'nmap -sV 10.10.10.10',
      [
        'Nmap scan report for 10.10.10.10',
        '80/tcp open http Apache httpd',
        'permission denied while reading an optional service probe',
      ].join('\n'),
    );

    expect(result.metadata.hasError).toBe(true);
    expect(result.findings.some(finding => finding.type === 'open_port')).toBe(true);
    expect(result.findings.some(finding => finding.type === 'error')).toBe(true);
  });

  it('keeps masscan truncation within the hard finding cap', () => {
    const output = Array.from({ length: UNIVERSAL_PARSER_LIMITS.maxFindings + 50 }, (_, index) =>
      `Discovered open port ${1000 + index}/tcp on 10.20.${Math.floor(index / 255)}.${index % 255}`,
    ).join('\n');

    const findings = parseMasscan(output);
    expect(findings.length).toBeLessThanOrEqual(UNIVERSAL_PARSER_LIMITS.maxFindings);
    expect(findings.at(-1)).toMatchObject({ id: 'masscan-truncated', type: 'warning' });
  });

  it('parses Nmap XML into hosts and services for both parser paths', () => {
    const xml = `<?xml version="1.0"?>
      <nmaprun><host><status state="up" reason="syn-ack"/><address addr="10.0.0.5" addrtype="ipv4"/>
      <hostnames><hostname name="app.example.test"/></hostnames>
      <ports><port protocol="tcp" portid="443"><state state="open"/><service name="https" product="nginx" version="1.25"/></port></ports>
      </host></nmaprun>`;

    const universal = parseUniversalOutput('nmap -oX - 10.0.0.5', xml);
    expect(universal.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'host' }),
      expect.objectContaining({ type: 'open_port', data: expect.objectContaining({ port: 443, service: 'https' }) }),
    ]));

    expect(parseNmapOutput(xml)).toMatchObject([{
      ip: '10.0.0.5',
      hostname: 'app.example.test',
      status: 'up',
      ports: [{ port: 443, state: 'open', service: 'https' }],
    }]);
  });

  it('parses Nuclei JSON output in the dedicated result path', () => {
    const output = JSON.stringify({
      'template-id': 'cve-2024-example',
      'matched-at': 'https://target.test/login',
      info: {
        name: 'Example finding',
        severity: 'high',
        description: 'A test finding',
        classification: { 'cve-id': 'CVE-2024-1234', 'cvss-score': '8.1' },
        tags: ['cve', 'login'],
      },
      'extracted-results': ['demo'],
    });

    const result = parseNucleiOutput(output);
    expect(result.findings).toEqual([
      expect.objectContaining({
        templateId: 'cve-2024-example',
        severity: 'high',
        url: 'https://target.test/login',
        cve: 'CVE-2024-1234',
        cvss: 8.1,
      }),
    ]);
    expect(result.summary.high).toBe(1);
  });
});
