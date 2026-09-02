import { quoteShellArgument } from '@/lib/terminal/command-lifecycle';
import type { ManagedShellRuntime } from '@/lib/terminal/command-lifecycle';

/**
 * Tokenize option fragments while retaining quoted values such as
 * `--script "http-*"`. The resulting tokens are quoted again for the managed
 * shell, so custom flags cannot become a second shell command.
 */
export function tokenizeScannerOptions(options: string[]): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;

  const push = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (const fragment of options) {
    const value = String(fragment ?? '');
    for (const character of value) {
      if (escaped) {
        current += character;
        escaped = false;
        continue;
      }

      if (character === '\\' && quote !== 'single') {
        escaped = true;
        continue;
      }

      if (quote === 'single') {
        if (character === "'") quote = null;
        else current += character;
        continue;
      }

      if (quote === 'double') {
        if (character === '"') quote = null;
        else current += character;
        continue;
      }

      if (character === "'") {
        quote = 'single';
      } else if (character === '"') {
        quote = 'double';
      } else if (/\s/.test(character)) {
        push();
      } else {
        current += character;
      }
    }

    // Fragments represent one source field, but whitespace between array
    // entries is still a separator unless a quote remains open.
    if (!quote) push();
    else current += ' ';
  }

  if (escaped) current += '\\';
  if (quote) throw new Error('Scanner flags contain an unterminated quote');
  push();
  return tokens;
}

export function formatScannerOptions(options: string[] | undefined, runtime: ManagedShellRuntime): string {
  const tokens = tokenizeScannerOptions(Array.isArray(options) ? options : []);
  return tokens.map(token => quoteShellArgument(token, runtime)).join(' ');
}
