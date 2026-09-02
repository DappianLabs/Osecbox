import { useEffect } from 'react';
import { useFootholdStore } from '@/lib/foothold-store';
import { useTunnelingStore } from '@/lib/tunneling-store';

const FAILURE_MARKERS = [
  'command not found',
  'not found, but can be installed',
  'no such file or directory',
  'permission denied',
  'error:',
  'failed to',
  'cannot',
  'unable to',
];

function includesAny(value: string, markers: string[]): boolean {
  return markers.some(marker => value.includes(marker));
}

/** Keeps long-running listener/tunnel state synchronized while their views are unmounted. */
export function ProcessStatusSync() {
  useEffect(() => {
    if (!window.electron) return;

    // Stop -> Start is serialized by command-lifecycle, but this component is
    // always mounted while the section views can be hidden. Keep its global
    // state bridge from applying late output from the command being stopped.
    const stoppingIds = new Set<string>();
    const commandMarkerTails = new Map<string, string>();

    const handleOutput = (data: { listenerId: string; data: string }) => {
      if (stoppingIds.has(data.listenerId)) return;

      // Start controls append an OSC completion marker. Keep a short tail so
      // the marker is recognized even when node-pty splits it across chunks.
      const markerInput = `${commandMarkerTails.get(data.listenerId) || ''}${data.data || ''}`;
      commandMarkerTails.set(data.listenerId, markerInput.slice(-512));
      const exitMatch = markerInput.match(/\x1b\]9;osecbox-command-exit;(\d+)\x07/);
      if (exitMatch) {
        commandMarkerTails.delete(data.listenerId);
        const exitCode = Number(exitMatch[1]);
        const footholdState = useFootholdStore.getState();
        const tunnelingState = useTunnelingStore.getState();
        footholdState.updateListener(data.listenerId, { status: 'stopped' });
        tunnelingState.updateSession(data.listenerId, { status: 'idle' });
        console.debug(`[ProcessStatusSync] Managed command exited with code ${exitCode}: ${data.listenerId}`);
        return;
      }

      const output = String(data.data || '').toLowerCase();
      const footholdState = useFootholdStore.getState();
      const tunnelingState = useTunnelingStore.getState();
      const footholdExists = footholdState.tabs.some(tab =>
        tab.listeners.some(listener => listener.id === data.listenerId)
      );
      const tunnelExists = tunnelingState.tabs.some(tab =>
        tab.sessions.some(session => session.id === data.listenerId)
      );

      if (footholdExists) {
        if (includesAny(output, FAILURE_MARKERS)) {
          footholdState.updateListener(data.listenerId, { status: 'stopped' });
        }
      }

      if (tunnelExists) {
        if (includesAny(output, FAILURE_MARKERS)) {
          tunnelingState.updateSession(data.listenerId, { status: 'idle' });
        }
      }
    };

    const handleClosed = (data: { listenerId: string; code: number }) => {
      stoppingIds.delete(data.listenerId);
      commandMarkerTails.delete(data.listenerId);
      useFootholdStore.getState().updateListener(data.listenerId, { status: 'stopped' });
      useTunnelingStore.getState().updateSession(data.listenerId, { status: 'idle' });
    };

    const handleStopRequested = (event: Event) => {
      const listenerId = (event as CustomEvent<{ listenerId?: string }>).detail?.listenerId;
      if (listenerId) stoppingIds.add(listenerId);
    };

    const handleStopped = (event: Event) => {
      const listenerId = (event as CustomEvent<{ listenerId?: string }>).detail?.listenerId;
      if (!listenerId) return;
      stoppingIds.delete(listenerId);
      commandMarkerTails.delete(listenerId);
      useFootholdStore.getState().updateListener(listenerId, { status: 'stopped' });
      useTunnelingStore.getState().updateSession(listenerId, { status: 'idle' });
    };

    const cleanupOutput = window.electron.onListenerOutput(handleOutput);
    const cleanupClosed = window.electron.onListenerClosed(handleClosed);
    window.addEventListener('listener-stop-requested', handleStopRequested);
    window.addEventListener('listener-stopped', handleStopped);

    return () => {
      cleanupOutput();
      cleanupClosed();
      window.removeEventListener('listener-stop-requested', handleStopRequested);
      window.removeEventListener('listener-stopped', handleStopped);
    };
  }, []);

  return null;
}
