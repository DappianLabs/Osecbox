import { describe, expect, it } from 'vitest';
import { getLocalListenerBind } from '../client/src/lib/listener-preflight';

const listener = (overrides: Record<string, unknown> = {}) => ({
  id: 'listener-test',
  type: 'netcat',
  port: 45160,
  status: 'stopped',
  command: 'nc -lvnp 45160',
  ...overrides,
}) as any;

describe('listener start preflight parsing', () => {
  it('uses the actual command port and bind host', () => {
    expect(getLocalListenerBind(listener({
      port: 45160,
      command: 'ncat -l -p 45161 -s 127.0.0.1',
    }))).toEqual({ port: 45161, host: '127.0.0.1' });
    expect(getLocalListenerBind(listener({
      type: 'socat',
      port: 45160,
      command: 'socat TCP-LISTEN:45162,reuseaddr,bind=127.0.0.1,fork EXEC:/bin/bash',
    }))).toEqual({ port: 45162, host: '127.0.0.1' });
    expect(getLocalListenerBind(listener({
      type: 'http-server',
      port: 45160,
      command: 'python3 -m http.server 45163 --bind 127.0.0.1',
    }))).toEqual({ port: 45163, host: '127.0.0.1' });
  });

  it('covers framework listeners and custom commands with recognizable binds', () => {
    expect(getLocalListenerBind(listener({
      type: 'pwncat',
      command: 'pwncat-cs -lp 45164',
    }))).toEqual({ port: 45164, host: '0.0.0.0' });
    expect(getLocalListenerBind(listener({
      type: 'meterpreter',
      command: 'msfconsole -q -x "set LHOST 127.0.0.1; set LPORT 45165; exploit"',
    }))).toEqual({ port: 45165, host: '127.0.0.1' });
    expect(getLocalListenerBind(listener({
      type: 'custom',
      port: 0,
      command: 'nc -lvnp 45166',
    }))).toEqual({ port: 45166, host: '0.0.0.0' });
  });

  it('does not guess an arbitrary custom command', () => {
    expect(getLocalListenerBind(listener({
      type: 'custom',
      port: 45160,
      command: 'my-wrapper --start',
    }))).toBeNull();
  });
});
