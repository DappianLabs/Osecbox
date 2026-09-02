import { describe, expect, it } from 'vitest';
import { getLocalTunnelBind, isSafeRemoteHost, isStrictPort, replaceCommandExecutable } from '../client/src/lib/tunneling-preflight';

const session = (overrides: Record<string, unknown> = {}) => ({
  id: 'tunnel-test',
  tool: 'chisel',
  mode: 'server',
  port: '45150',
  remoteHost: '',
  localPort: '',
  remotePort: '',
  command: 'chisel server --port 45150 --reverse',
  status: 'idle',
  ...overrides,
}) as any;

describe('tunnel start preflight parsing', () => {
  it('detects local bind ports for supported server/forward commands', () => {
    expect(getLocalTunnelBind(session())).toEqual({ port: 45150, host: '0.0.0.0' });
    expect(getLocalTunnelBind(session({
      port: '45150',
      command: 'chisel server --port 45152 --host 127.0.0.1 --reverse',
    }))).toEqual({ port: 45152, host: '127.0.0.1' });
    expect(getLocalTunnelBind(session({
      tool: 'ligolo-ng',
      command: 'proxy -laddr 127.0.0.1:45153 -selfcert',
    }))).toEqual({ port: 45153, host: '127.0.0.1' });
    expect(getLocalTunnelBind(session({
      tool: 'socat',
      command: 'socat TCP-LISTEN:45150,fork TCP:127.0.0.1:8080',
    }))).toEqual({ port: 45150, host: '0.0.0.0' });
    expect(getLocalTunnelBind(session({
      tool: 'ssh',
      mode: 'client',
      localPort: '45151',
      command: 'ssh -o BatchMode=yes -N -L 127.0.0.1:45151:localhost:3306 user@127.0.0.1',
    }))).toEqual({ port: 45151, host: '127.0.0.1' });
  });

  it('does not check a remote-only client port as a local bind', () => {
    expect(getLocalTunnelBind(session({
      tool: 'chisel',
      mode: 'client',
      command: 'chisel client 127.0.0.1:45150 R:45151:127.0.0.1:3306',
    }))).toBeNull();
  });

  it('validates strict ports and safe remote host syntax', () => {
    expect(isStrictPort('45150')).toBe(true);
    expect(isStrictPort('45150abc')).toBe(false);
    expect(isStrictPort('0')).toBe(false);
    expect(isSafeRemoteHost('backend.example.test')).toBe(true);
    expect(isSafeRemoteHost('[2001:db8::1]')).toBe(true);
    expect(isSafeRemoteHost('https://backend.example.test')).toBe(false);
  });

  it('replaces a tunnel executable even when a sudo prefix or absolute path is persisted', () => {
    expect(replaceCommandExecutable('sudo -n /usr/local/bin/ligolo-ng -connect 127.0.0.1:11601', 'proxy'))
      .toBe('sudo -n proxy -connect 127.0.0.1:11601');
  });
});
