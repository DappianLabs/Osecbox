import { describe, expect, it } from 'vitest';
import { redactSensitiveTextWithFindings } from '../client/src/lib/ai-data-policy';

describe('AI provider data policy', () => {
  it('redacts common pentest secrets across JSON, env, headers, URLs, and token formats', () => {
    const password = 'super-secret-password';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-value';
    const privateKey = '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----';
    const input = [
      `{"password":"${password}","apiKey":"api-value-123"}`,
      `AWS_SECRET_ACCESS_KEY=${password}`,
      'Authorization: Bearer bearer-token-123456789',
      'Authorization: Basic dXNlcjpzdXBlci1zZWNyZXQ=',
      'https://user:connection-password@example.test:8443/app',
      'ghp_123456789012345678901234567890',
      jwt,
      privateKey,
      '{"auths":{"registry.example":{"auth":"base64-docker-credential"}}}',
    ].join('\n');

    const result = redactSensitiveTextWithFindings(input);

    expect(result.text).not.toContain(password);
    expect(result.text).not.toContain(jwt);
    expect(result.text).not.toContain('private-material');
    expect(result.text).toContain('[REDACTED:');
    expect(result.findings.some(finding => finding.kind === 'aws_credential')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'bearer_token')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'basic_auth')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'github_token')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'jwt')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'private_key')).toBe(true);
    expect(result.findings.every(finding => !JSON.stringify(finding).includes(password))).toBe(true);
  });

  it('redacts namespaced cloud variables and database short password flags', () => {
    const input = [
      'AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF',
      'AWS_SESSION_TOKEN=session-token-value-should-not-leak',
      'TF_VAR_DB_PASSWORD=terraform-password-value',
      'sshpass -p super-short-password ssh user@example.test',
      'mysql -u root -p database-password dbname',
      'nmap -p 22,443 10.0.0.5',
    ].join('\n');

    const result = redactSensitiveTextWithFindings(input);

    expect(result.text).not.toContain('session-token-value-should-not-leak');
    expect(result.text).not.toContain('terraform-password-value');
    expect(result.text).not.toContain('super-short-password');
    expect(result.text).not.toContain('database-password');
    expect(result.text).toContain('nmap -p 22,443');
    expect(result.findings.some(finding => finding.kind === 'aws_credential')).toBe(true);
    expect(result.findings.some(finding => finding.kind === 'credential')).toBe(true);
  });
});
