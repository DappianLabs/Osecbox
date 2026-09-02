import React, { useMemo } from 'react';
import { Copy, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

interface RawOutputPreviewProps {
  rawOutput?: string;
  title?: string;
  className?: string;
}

const MAX_PREVIEW_CHARS = 120_000;

/**
 * Keep the structured result view honest: parsers are an enhancement, while
 * the bounded PTY transcript remains the authoritative tool output.
 */
export function RawOutputPreview({
  rawOutput = '',
  title = 'Raw terminal output',
  className,
}: RawOutputPreviewProps) {
  const displayOutput = useMemo(() => cleanANSIForDisplay(rawOutput), [rawOutput]);
  if (!rawOutput) return null;

  const preview = displayOutput.length > MAX_PREVIEW_CHARS
    ? `${displayOutput.slice(0, 24_000)}\n...[preview truncated; complete output remains in the terminal]...\n${displayOutput.slice(-96_000)}`
    : displayOutput;

  const copyOutput = async () => {
    try {
      await navigator.clipboard?.writeText(displayOutput);
    } catch {
      // Clipboard access is optional in Electron and browser previews.
    }
  };

  return (
    <Card className={cn('shrink-0 mx-2 mt-1 mb-1 border-border/70 bg-card/60', className)}>
      <details>
        <summary className="cursor-pointer list-none px-3 py-1.5 flex items-center justify-between gap-3 text-xs font-medium text-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {displayOutput.length.toLocaleString()} chars
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0"
            onClick={(event) => {
              event.preventDefault();
              void copyOutput();
            }}
            aria-label={`Copy ${title}`}
          >
            <Copy className="mr-1 h-3 w-3" />
            Copy
          </Button>
        </summary>
        <pre className="max-h-64 overflow-auto border-t border-border p-2 text-[11px] leading-4 text-muted-foreground font-mono whitespace-pre-wrap break-words">
          {preview}
        </pre>
      </details>
    </Card>
  );
}
