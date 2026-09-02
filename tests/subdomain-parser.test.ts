import { describe, expect, it } from 'vitest';
import { parseSubdomainOutput } from '../client/src/lib/subdomain-parser';

describe('subdomain output parser', () => {
  it('keeps results inside the requested DNS scope and deduplicates mixed output', () => {
    const result = parseSubdomainOutput(
      'ffuf',
      [
        '{"url":"https://api.example.com/","status":200}',
        'api [Status: 200, Size: 120, Words: 8, Lines: 4]',
        'example.com.attacker.test [Status: 200, Size: 120]',
      ].join('\n'),
      'example.com',
    );

    expect(result.subdomains).toHaveLength(1);
    expect(result.subdomains[0]).toMatchObject({
      subdomain: 'api.example.com',
      httpStatus: 200,
      status: 'active',
    });
  });

  it('ignores tool errors instead of treating dotted error text as a finding', () => {
    const result = parseSubdomainOutput(
      'subfinder',
      'subfinder: command not found\nsee example.com for installation',
      'example.com',
    );

    expect(result.subdomains).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('preserves subdomains emitted before a later tool warning', () => {
    const result = parseSubdomainOutput(
      'subfinder',
      'api.example.com\nconnection timed out while querying one source\n',
      'example.com',
    );

    expect(result.subdomains).toEqual([
      expect.objectContaining({ subdomain: 'api.example.com' }),
    ]);
  });
});
