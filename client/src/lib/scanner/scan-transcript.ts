/**
 * Return the newest scanner run from a durable scanner-terminal transcript.
 *
 * Scanner terminals intentionally retain older commands. The internal OSC
 * start marker is invisible in xterm, but gives live/result panels a cheap,
 * deterministic boundary so progressive parsing never mixes two runs.
 */
const SCAN_START_MARKER = /\x1b\]9;osecbox-scan-start;[^\x07]*\x07/g;

export function getLatestScanTranscript(output: string): string {
  const value = String(output || '');
  const markers = [...value.matchAll(SCAN_START_MARKER)];
  const latest = markers.at(-1);
  if (!latest || latest.index === undefined) return value;
  return value.slice(latest.index + latest[0].length);
}
