import { describe, expect, it } from 'vitest';
import { parseFfuf } from '../client/src/lib/parsers/directory-parsers';
import { parseUniversalOutput } from '../client/src/lib/universal-parser';

describe('universal tool parsers', () => {
  it('parses ffuf directory text and JSON output without duplicate findings', () => {
    const output = [
      'admin [Status: 200, Size: 1200, Words: 8, Lines: 4]',
      '{"url":"https://target.test/admin","status":200,"length":1200}',
      'secret [Status: 403, Size: 90, Words: 4, Lines: 2]',
    ].join('\n');

    const findings = parseFfuf(output);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      title: 'admin',
      data: { statusCode: 200, size: 1200 },
    });
    expect(findings[1]).toMatchObject({
      title: 'secret',
      severity: 'medium',
      data: { statusCode: 403 },
    });
  });

  it('parses ffuf pretty-printed file JSON with a results array', () => {
    const findings = parseFfuf(JSON.stringify({
      commandline: 'ffuf -u https://target.test/FUZZ -w common.txt',
      results: [
        {
          url: 'https://target.test/admin',
          status: 200,
          length: 1200,
          words: 8,
          lines: 4,
        },
        {
          url: 'https://target.test/private',
          status: 403,
          length: 90,
        },
      ],
    }, null, 2));

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      title: 'https://target.test/admin',
      data: { statusCode: 200, size: 1200, words: 8, lines: 4 },
    });
    expect(findings[1]).toMatchObject({
      title: 'https://target.test/private',
      severity: 'medium',
      data: { statusCode: 403 },
    });
  });

  it('routes ffuf through its own parser instead of the wfuzz parser', () => {
    const result = parseUniversalOutput(
      'ffuf -u https://target.test/FUZZ -w common.txt',
      'admin [Status: 200, Size: 1200, Words: 8, Lines: 4]',
    );

    expect(result.tool).toBe('ffuf');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].data).toMatchObject({ statusCode: 200, path: 'admin' });
  });

  it('uses dedicated parsers for assetfinder and prefixed sublist3r output', () => {
    const assetfinder = parseUniversalOutput(
      'assetfinder --subs-only example.com',
      'api.example.com\napi.example.com\n*.wild.example.com\n',
    );
    expect(assetfinder.tool).toBe('assetfinder');
    expect(assetfinder.findings).toHaveLength(2);
    expect(assetfinder.findings.map(finding => finding.title)).toEqual([
      'api.example.com',
      'wild.example.com',
    ]);

    const sublist3r = parseUniversalOutput(
      'sublist3r -d example.com',
      '[*] Enumerating subdomains now for example.com\n[+] api.example.com\n[+] Total Unique Subdomains Found: 1',
    );
    expect(sublist3r.tool).toBe('sublist3r');
    expect(sublist3r.findings).toHaveLength(1);
    expect(sublist3r.findings[0].title).toBe('api.example.com');
  });
});
