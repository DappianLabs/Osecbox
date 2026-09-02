import React from 'react';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScanSaveTriggerProps {
  className?: string;
}

/** Opens the scan export menu owned by the scan tab bar. */
export function ScanSaveTrigger({ className }: ScanSaveTriggerProps) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('open-scan-save-dialog'))}
      className={cn(
        'flex h-7 items-center justify-center gap-1 rounded-md border border-emerald-500/60',
        'bg-emerald-600/90 px-3 text-[11px] font-semibold text-white',
        'shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-1',
        'focus-visible:ring-offset-background',
        className
      )}
      title="Save scan data"
      aria-label="Save scan data"
    >
      <Save className="h-3.5 w-3.5" aria-hidden="true" />
      <span>SAVE</span>
    </button>
  );
}
