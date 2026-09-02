/**
 * ANSI Cleaner Utility - Shared across all parsers and result presenters.
 *
 * The live xterm renderer must receive the original byte stream because ANSI
 * sequences carry colours, cursor movement, and progress rendering. Result
 * cards, clipboard previews, and AI context are different boundaries: they
 * need readable text and must never expose terminal protocol bytes to users.
 */

// Keep these patterns broad enough for modern terminal applications. In
// particular, ?25h/?25l and ?2004h are CSI sequences with private parameters,
// while hyperlinks and titles are OSC sequences terminated by BEL or ST.
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const ANSI_DCS = /\u001b(?:P|X|\^|_)[\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ANSI_ESC = /\u001b[ -/]*[@-~]/g;

/**
 * Remove terminal protocol sequences while preserving the text layout.
 *
 * Standalone carriage returns are interpreted as line rewrites (the common
 * progress-bar pattern) instead of being converted into visible blank lines.
 * Tabs, spaces, alignment, and newlines remain intact so Nmap tables do not
 * collapse into an unreadable paragraph.
 */
export function cleanANSIForDisplay(text: string): string {
  if (!text) return '';

  const withoutSequences = String(text)
    .replace(ANSI_OSC, '')
    .replace(ANSI_DCS, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_ESC, '')
    .replace(/\u001b/g, '')
    // Remove any remaining C1 controls. CSI/OSC are already handled above;
    // this catches malformed or truncated sequences without leaking ESC bytes.
    .replace(/[\u0080-\u009f]/g, '')
    .replace(/\r\n/g, '\n');

  let result = '';
  let line = '';

  for (const character of withoutSequences) {
    if (character === '\n') {
      result += `${line}\n`;
      line = '';
      continue;
    }
    if (character === '\r') {
      // A terminal carriage return moves to column zero. Replacing the current
      // line makes spinner/progress output readable and deterministic.
      line = '';
      continue;
    }
    if (character === '\b') {
      line = line.slice(0, -1);
      continue;
    }

    const code = character.charCodeAt(0);
    if (character === '\t' || (code >= 0x20 && code !== 0x7f)) {
      line += character;
    }
    // Bells, NUL, and the remaining C0 controls are protocol noise.
  }

  return result + line;
}

/**
 * Remove ANSI/control bytes for parsers. This retains the historical
 * whitespace normalization contract used by the structured-output parsers,
 * while delegating sequence handling to the display-safe implementation.
 */
export function cleanANSI(text: string): string {
  return cleanANSIForDisplay(text)
    .replace(/ +/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

/**
 * Clean and normalize whitespace
 */
export function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
