import { describe, expect, it } from 'vitest';
import { ConnectionDetector } from '../client/src/lib/connection-detector';

describe('passive listener and tunnel detection', () => {
  it('recognizes Ligolo agent connection flags', () => {
    const result = ConnectionDetector.detectConnection(
      'agent connected: ligolo-ng -connect 10.20.30.40:11601 -ignore-cert',
      'terminal-1',
    );

    expect(result.detected).toBe(true);
    expect(result.connection).toMatchObject({
      ip: '10.20.30.40',
      port: '11601',
      role: 'pivot',
      method: 'ligolo',
    });
  });

  it('recognizes a socat TCP relay without requiring TCP4 syntax', () => {
    const result = ConnectionDetector.detectConnection(
      'socat TCP-LISTEN:4444,reuseaddr,fork TCP:10.20.30.40:8080 accepting connections',
      'terminal-2',
    );

    expect(result.detected).toBe(true);
    expect(result.connection).toMatchObject({
      ip: '10.20.30.40',
      port: '4444',
      role: 'pivot',
      method: 'socat',
    });
  });

  it('does not infer a pivot from a bare tool name', () => {
    expect(ConnectionDetector.detectConnection('ligolo-ng --help', 'terminal-3')).toEqual({
      detected: false,
    });
  });
});

