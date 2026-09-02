/**
 * Clipboard helpers with a DOM fallback for Electron windows where the
 * navigator Clipboard API can be unavailable or permission-restricted.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) return;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy command failed');
    }
  } finally {
    textarea.remove();
  }
}

export async function readTextFromClipboard(): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    throw new Error('Clipboard read is unavailable');
  }

  return navigator.clipboard.readText();
}
