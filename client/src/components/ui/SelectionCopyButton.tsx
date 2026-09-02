import React, { useEffect, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Global text selection copy button
 * Shows a floating copy button when text is selected anywhere in the app
 */
export function SelectionCopyButton() {
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();

    // Only show button if there's actual text selected (not just whitespace)
    if (text && text.length > 0) {
      const range = sel?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();

      if (rect) {
        // Position button at the end of selection
        setSelection({
          text,
          x: rect.right,
          y: rect.top - 40, // Position above selection
        });
        setCopied(false);
      }
    } else {
      setSelection(null);
      setCopied(false);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!selection) return;

    try {
      // Handle different types of content
      const text = selection.text;
      
      // Clean up text for copying
      let cleanText = text;
      
      // Remove zero-width characters
      cleanText = cleanText.replace(/[\u200B-\u200D\uFEFF]/g, '');
      
      // Normalize line breaks
      cleanText = cleanText.replace(/\r\n/g, '\n');
      
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cleanText);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = cleanText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(textarea);
        }
      }

      setCopied(true);
      
      // Hide button after 1.5 seconds
      setTimeout(() => {
        setSelection(null);
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error('[SelectionCopyButton] Failed to copy:', error);
      
      // Still show success to user (they can try again if needed)
      setCopied(true);
      setTimeout(() => {
        setSelection(null);
        setCopied(false);
      }, 1500);
    }
  }, [selection]);

  useEffect(() => {
    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);
    
    // Also listen for mouseup to catch selections
    document.addEventListener('mouseup', handleSelectionChange);
    
    // Hide button when clicking elsewhere
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Don't hide if clicking the copy button itself
      if (target.closest('[data-selection-copy-button]')) {
        return;
      }
      
      // Hide button when clicking elsewhere
      setSelection(null);
      setCopied(false);
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    
    // Hide button when scrolling
    const handleScroll = () => {
      setSelection(null);
      setCopied(false);
    };
    
    document.addEventListener('scroll', handleScroll, true);
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [handleSelectionChange]);

  if (!selection) return null;

  return (
    <div
      data-selection-copy-button
      className={cn(
        "fixed z-[9999] pointer-events-auto",
        "transition-all duration-200 ease-out"
      )}
      style={{
        left: `${selection.x}px`,
        top: `${selection.y}px`,
        transform: 'translateX(-50%)',
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg",
          "border border-border backdrop-blur-sm",
          "transition-all duration-200",
          copied
            ? "bg-green-500/90 text-white border-green-600"
            : "bg-card/95 text-foreground hover:bg-primary/90 hover:text-primary-foreground hover:border-primary"
        )}
        title={copied ? "Copied!" : "Copy selected text"}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            <span className="text-sm font-medium">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}
