import {
  classifyDnsDiagnostic,
  DNS_PUBLIC_PROBE,
  extractNameservers,
  formatDnsDiagnosticFailure,
  normalizeDnsHostname,
} from '../electron/utils/dns-diagnostics';

const okProbe = { ok: true, available: true, output: '93.184.216.34' };
const failedProbe = { ok: false, available: true, error: 'lookup failed' };

describe('DNS preflight classification', () => {
  it('does not require DNS for IP addresses and network targets', () => {
    expect(normalizeDnsHostname('https://app.example.com/path')).toBe('app.example.com');
    expect(normalizeDnsHostname('example.com.')).toBe('example.com');
    expect(normalizeDnsHostname('192.0.2.10')).toBeNull();
    expect(normalizeDnsHostname('192.0.2.0/24')).toBeNull();

    const diagnostic = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: false,
      target: '192.0.2.10',
      publicProbe: failedProbe,
    });

    expect(diagnostic).toMatchObject({ status: 'not-required', ok: true });
  });

  it('distinguishes a resolver failure from a missing default route', () => {
    const resolverFailure = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: true,
      publicProbe: failedProbe,
      routeEvidence: 'default via 172.27.0.1 dev eth0',
    });
    expect(resolverFailure).toMatchObject({ status: 'resolver-unavailable', ok: false });

    const networkFailure = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: true,
      publicProbe: failedProbe,
      routeEvidence: '__OSECBOX_ROUTE_CHECKED__',
    });
    expect(networkFailure).toMatchObject({ status: 'network-unavailable', ok: false });
  });

  it('does not label a target-only record problem as a broken resolver', () => {
    const diagnostic = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: true,
      target: 'missing.example.com',
      publicProbe: okProbe,
      targetProbe: failedProbe,
      routeEvidence: 'default via 172.27.0.1 dev eth0',
    });

    expect(diagnostic.status).toBe('target-unresolved');
    expect(diagnostic.message).toContain(DNS_PUBLIC_PROBE);
    expect(diagnostic.remediation.join('\n')).toContain('VPN');
  });

  it('allows private/VPN targets that resolve even when public DNS is blocked', () => {
    const diagnostic = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: true,
      target: 'internal.example',
      publicProbe: failedProbe,
      targetProbe: { ok: true, available: true, output: '10.0.0.12' },
      routeEvidence: 'default via 10.0.0.1 dev eth0',
    });

    expect(diagnostic).toMatchObject({ status: 'healthy', ok: true });
  });

  it('extracts and de-duplicates resolver evidence', () => {
    expect(extractNameservers([
      'nameserver 10.0.0.1',
      'Current DNS Server: 10.0.0.1',
      'DNS Servers: 1.1.1.1 8.8.8.8',
    ].join('\n'))).toEqual(['10.0.0.1', '1.1.1.1', '8.8.8.8']);
  });

  it('formats a machine-actionable failure for tool and UI surfaces', () => {
    const diagnostic = classifyDnsDiagnostic({
      runtime: 'wsl2',
      runtimeAvailable: true,
      target: 'app.example.com',
      publicProbe: failedProbe,
      targetProbe: failedProbe,
      resolverEvidence: 'nameserver 10.255.255.254',
      routeEvidence: 'default via 172.27.0.1 dev eth0',
    });

    const message = formatDnsDiagnosticFailure(diagnostic);
    expect(message).toContain('OSECBOX_DNS_PREFLIGHT_FAILED');
    expect(message).toContain('Nameservers observed: 10.255.255.254');
    expect(message).toContain('How to solve it:');
  });
});
