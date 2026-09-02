import { describe, expect, it } from 'vitest';
import { createSession } from '../client/src/lib/attack-state/session';
import { buildAIContext } from '../client/src/lib/attack-state/ai-context-builder';
import { CommandOutputStore } from '../client/src/lib/attack-state/command-output-store';

describe('AI context scale and prioritization', () => {
  it('keeps five scan terminals visible while bounding a large evidence set', () => {
    const session = createSession('scale test');
    session.target_ip = '10.10.10.10';
    const store = new CommandOutputStore(1000, 150000, 64 * 1024 * 1024);

    let commandNumber = 1;
    for (let scan = 1; scan <= 5; scan += 1) {
      for (let command = 1; command <= 20; command += 1) {
        const terminalId = `scan-${scan}::nmap`;
        const output = [
          `Nmap scan report for 10.10.10.${scan}`,
          `22/tcp open ssh OpenSSH 9.${command}`,
          `808${scan}/tcp open http nginx`,
          `docker ps --format '{{.Names}}'`,
          `AWS_SECRET_ACCESS_KEY=secret-${scan}-${command}`,
          `config file /etc/app-${scan}-${command}.env`,
        ].join('\n');
        store.addOutput({
          num: commandNumber++,
          command: `nmap -sV 10.10.10.${scan}`,
          output,
          stderr: '',
          exitCode: 0,
          timestamp: Date.now() + commandNumber,
          host: session.target_ip,
          duration: 1,
          sessionId: session.id,
          tabId: `scan-${scan}`,
          terminalId,
          target: session.target_ip,
          tool: 'nmap',
        });
      }
    }

    const context = buildAIContext(
      session,
      store,
      'ultra',
      'full audit: find credentials, ports, Docker, and missed evidence',
      'scan-1::nmap',
      { sessionId: session.id, target: session.target_ip },
    );

    expect(context.length).toBeLessThanOrEqual(30_000);
    expect(context).toContain('SECURITY EVIDENCE INDEX');
    expect(context).toContain('aws_credential detected');
    expect(context).toContain('docker');
    expect(context).toContain('22/tcp open');
    expect(context).not.toContain('secret-1-1');
    for (let scan = 1; scan <= 5; scan += 1) {
      expect(context).toContain(`scan-${scan}`);
    }
  });

  it('bounds both stdout and stderr under terminal flood conditions', () => {
    const store = new CommandOutputStore(100, 1200, 24_000);
    const huge = Array.from({ length: 2000 }, (_, index) => `line-${index} password=secret-${index}`).join('\n');
    for (let index = 0; index < 100; index += 1) {
      store.addOutput({
        num: index + 1,
        command: `listener-${index} --token token-${index}`,
        output: huge,
        stderr: huge,
        exitCode: index % 7 === 0 ? 1 : 0,
        timestamp: index,
        host: '10.10.10.10',
        duration: 1,
        terminalId: `listener-${index}`,
        target: '10.10.10.10',
      });
    }

    const stats = store.getStats();
    expect(stats.totalSize).toBeLessThanOrEqual(24_000 + 2_500);
    expect(store.getAllOutputs().every(output => output.output.length <= 1200)).toBe(true);
    expect(store.getAllOutputs().every(output => output.stderr.length <= 1200)).toBe(true);
    expect(store.getAllOutputs().length).toBeLessThanOrEqual(100);
  });

  it('keeps target and terminal scopes isolated when engagements share one session', () => {
    const session = createSession('scope test');
    session.target_ip = '10.20.0.5';
    const store = new CommandOutputStore();

    store.addOutput({
      num: 1,
      command: 'nmap -sV 10.20.0.5',
      output: '22/tcp open ssh OpenSSH',
      stderr: '',
      exitCode: 0,
      timestamp: 1,
      host: '10.20.0.5',
      target: '10.20.0.5',
      duration: 1,
      sessionId: session.id,
      tabId: 'target-a',
      terminalId: 'target-a::nmap',
      tool: 'nmap',
    });
    store.addOutput({
      num: 2,
      command: 'nmap -sV 10.20.0.9',
      output: '445/tcp open microsoft-ds',
      stderr: '',
      exitCode: 0,
      timestamp: 2,
      host: '10.20.0.9',
      target: '10.20.0.9',
      duration: 1,
      sessionId: session.id,
      tabId: 'target-b',
      terminalId: 'target-b::nmap',
      tool: 'nmap',
    });

    const context = buildAIContext(
      session,
      store,
      'ultra',
      'full audit ports',
      'target-a::nmap',
      { sessionId: session.id, target: '10.20.0.5' },
    );

    expect(context).toContain('10.20.0.5');
    expect(context).toContain('22/tcp open');
    expect(context).not.toContain('10.20.0.9');
    expect(context).not.toContain('445/tcp open');
  });
});
