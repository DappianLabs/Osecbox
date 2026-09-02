import { beforeEach, describe, expect, it } from 'vitest';
import { mapMsfJob, mapMsfSession, syncMetasploitState } from '../client/src/lib/metasploit-state-sync';
import { useMetasploitStore } from '../client/src/lib/metasploit-store';

describe('Metasploit live state synchronization', () => {
  beforeEach(() => {
    useMetasploitStore.getState().reset();
  });

  it('maps session tunnel endpoints without inventing an outcome', () => {
    const session = mapMsfSession({
      id: 7,
      type: 'meterpreter',
      tunnel: '10.0.0.5:4444 -> 10.0.0.20:49832',
      platform: 'windows',
      arch: 'x64',
      user: 'CORP\\alice',
      computer: 'WORKSTATION',
    }, 1234);

    expect(session).toMatchObject({
      id: 7,
      type: 'meterpreter',
      localIp: '10.0.0.5',
      localPort: 4444,
      remoteIp: '10.0.0.20',
      remotePort: 49832,
      status: 'active',
      timestamp: 1234,
    });
  });

  it('keeps raw job descriptions when port metadata is unavailable', () => {
    const handler = mapMsfJob({ id: 3, name: 'exploit/multi/handler (payload unknown)' }, 1234);

    expect(handler).toMatchObject({
      id: 3,
      jobName: 'exploit/multi/handler (payload unknown)',
      payload: 'exploit/multi/handler (payload unknown)',
      port: 0,
      status: 'listening',
      createdAt: 1234,
    });
  });

  it('synchronizes live sessions and jobs into the shared store', () => {
    syncMetasploitState({
      sessions: [{ id: 1, type: 'shell', tunnel: '127.0.0.1:4444 -> 10.0.0.4:22' }],
      jobs: [{ id: 2, name: 'handler LPORT 4444', lhost: '127.0.0.1', lport: 4444 }],
    });

    expect(useMetasploitStore.getState().sessions).toHaveLength(1);
    expect(useMetasploitStore.getState().handlers).toMatchObject([
      expect.objectContaining({ id: 2, port: 4444, status: 'listening' }),
    ]);
  });

  it('clears only the module cache and records real dispatch history', () => {
    const campaignId = useMetasploitStore.getState().createCampaign({
      name: 'Scope',
      targets: ['10.0.0.4'],
      exploits: [{ modulePath: 'exploit/test/module' }],
      status: 'pending',
      schedule: 'sequential',
      parallelism: 1,
      retryFailures: false,
      retryCount: 0,
      retryDelay: 0,
      stopOnSuccess: false,
    });

    useMetasploitStore.getState().addCampaignDispatch(campaignId, {
      id: 'dispatch-1',
      target: '10.0.0.4',
      modulePath: 'exploit/test/module',
      commands: ['use exploit/test/module', 'set RHOSTS 10.0.0.4'],
      status: 'sent',
      dispatchedAt: 1234,
    });
    useMetasploitStore.getState().clearModules();

    const state = useMetasploitStore.getState();
    expect(state.modules).toEqual([]);
    expect(state.campaigns[0].dispatchHistory).toHaveLength(1);
    expect(state.campaigns[0].nextStepIndex).toBe(1);
  });
});
