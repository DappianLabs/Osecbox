import { describe, expect, it } from 'vitest';
import { detectLoot } from '../client/src/lib/attack-state/loot-detector';

describe('loot detector coverage', () => {
  it('finds cloud tokens, private keys, and database credentials in one transcript', () => {
    const output = [
      'AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF',
      'AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz1234567890abcd',
      'GOOGLE_API_KEY=AIza12345678901234567890123456789012345',
      'GITHUB_TOKEN=ghp_123456789012345678901234567890',
      'SECRET_KEY=example_nonsecret_test_value_0001',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-value',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'dummy-private-material',
      '-----END OPENSSH PRIVATE KEY-----',
      'postgres://exam_user:exam_password@db.internal:5432/app',
      'Server=db.internal;User Id=exam_user;Password=exam_password;',
      'region=us-east-1',
    ].join('\n');

    const loot = detectLoot('10.10.10.5', 'cat /root/.aws/credentials', output, new Set());
    const types = new Set(loot.map(item => item.type));

    expect(types.has('token')).toBe(true);
    expect(types.has('key')).toBe(true);
    expect(types.has('credential')).toBe(true);
    expect(loot.some(item => item.value.includes('aws_access_key_id'))).toBe(true);
    expect(loot.some(item => item.value.includes('github_token'))).toBe(true);
    expect(loot.some(item => item.value.includes('db.internal'))).toBe(true);
    expect(loot.some(item => item.type === 'config')).toBe(true);
  });
});
