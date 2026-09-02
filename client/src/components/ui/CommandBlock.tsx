import React, { useState } from 'react';
import { Play, Copy, Check, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';

interface CommandBlockProps {
  command: string;
  language?: string;
  onRun?: (command: string) => void;
  destination?: string;
  className?: string;
}

export function CommandBlock({ command, language = 'bash', onRun, destination, className }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRun = () => {
    if (onRun) {
      onRun(command);
    }
  };

  return (
    <div className={cn("rounded-lg overflow-hidden border border-gray-700 shadow-lg my-2", className)}>
      {/* Terminal header */}
      <div className="bg-gray-800 px-3 py-1.5 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
          </div>
          <Terminal className="w-3 h-3 text-gray-400" />
          <span className="text-[10px] text-gray-400 font-mono">{language}</span>
          {destination && (
            <span
              className="max-w-[190px] truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground/80"
              title={`Run in: ${destination}`}
            >
              Run in: {destination}
            </span>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-1 rounded-md bg-gray-700/50 hover:bg-gray-700 border border-gray-600/40 text-gray-300 text-[10px] font-medium flex items-center gap-1 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy
              </>
            )}
          </button>
          
          {onRun && (
            <button
              type="button"
              onClick={handleRun}
              className="px-2 py-1 rounded-md bg-green-600/20 hover:bg-green-600/30 border border-green-600/40 text-green-400 text-[10px] font-medium flex items-center gap-1 transition-colors"
              title="Execute this command in active terminal"
            >
              <Play className="w-3 h-3 fill-current" />
              Run
            </button>
          )}
        </div>
      </div>
      
      {/* Terminal content */}
      <div className="p-3 bg-black">
        <div className="flex items-start gap-2">
          <span className="text-green-400 font-mono text-xs select-none">$</span>
          <code className="text-gray-100 font-mono text-xs flex-1 break-all whitespace-pre-wrap">
            {command}
          </code>
        </div>
      </div>
    </div>
  );
}
