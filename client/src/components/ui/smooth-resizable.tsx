/**
 * Smooth Resizable Panels - Custom implementation for buttery smooth dragging
 * Bypasses react-resizable-panels for terminal resize to eliminate jitter
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ResizeGrip } from '@/components/ui/resizable';

interface SmoothResizableProps {
  topContent: React.ReactNode;
  bottomContent: React.ReactNode;
  defaultBottomHeight?: number;
  minBottomHeight?: number;
  maxBottomHeight?: number;
  onResize?: (bottomHeight: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (bottomHeight: number) => void;
  className?: string;
}

export function SmoothResizable({
  topContent,
  bottomContent,
  defaultBottomHeight = 40,
  minBottomHeight = 5,
  maxBottomHeight = 90,
  onResize,
  onResizeStart,
  onResizeEnd,
  className
}: SmoothResizableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const topPanelRef = useRef<HTMLDivElement>(null);
  const bottomPanelRef = useRef<HTMLDivElement>(null);
  
  // The divider can emit many pointer updates per frame. Keep live geometry in
  // refs/DOM styles so a drag does not re-render the scan results or terminal;
  // React is only notified when a drag/keyboard change is committed.
  const [, forcePanelRender] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const bottomHeightRef = useRef(defaultBottomHeight);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const updatePanelSizes = useCallback((newBottomHeight: number, commit = false) => {
    bottomHeightRef.current = newBottomHeight;
    const topFlex = `${100 - newBottomHeight} 1 0%`;
    const bottomFlex = `${newBottomHeight} 1 0%`;
    topPanelRef.current?.style.setProperty('flex', topFlex);
    bottomPanelRef.current?.style.setProperty('flex', bottomFlex);
    handleRef.current?.setAttribute('aria-valuenow', String(Math.round(newBottomHeight)));
    if (commit) {
      forcePanelRender(value => value + 1);
    }
    onResize?.(newBottomHeight);
  }, [onResize]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    
    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Use RAF for smooth 60fps updates
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      // Mouseup can arrive before the queued frame. Never apply a stale move
      // after the drag has already ended.
      if (!isDraggingRef.current || !containerRef.current) return;

      const containerRect = containerRef.current!.getBoundingClientRect();
      if (containerRect.height <= 0) return;
      const deltaY = e.clientY - startYRef.current;
      const deltaPercent = (deltaY / containerRect.height) * 100;
      
      let newBottomHeight = startHeightRef.current - deltaPercent;
      
      // Clamp to min/max
      newBottomHeight = Math.max(minBottomHeight, Math.min(maxBottomHeight, newBottomHeight));
      
      updatePanelSizes(newBottomHeight);
    });
  }, [minBottomHeight, maxBottomHeight, updatePanelSizes]);

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    isDraggingRef.current = false;
    setIsDragging(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Remove will-change after drag completes
    if (containerRef.current) {
      containerRef.current.style.willChange = '';
    }

    // Commit once after the pointer stream ends. This keeps drag updates out
    // of React's render path while ensuring the next unrelated render starts
    // from the latest panel geometry.
    updatePanelSizes(bottomHeightRef.current, true);
    onResizeEnd?.(bottomHeightRef.current);
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('blur', handleMouseUp);
  }, [handleMouseMove, onResizeEnd, updatePanelSizes]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    
    e.preventDefault();
    
    isDraggingRef.current = true;
    setIsDragging(true);
    startYRef.current = e.clientY;
    startHeightRef.current = bottomHeightRef.current;
    onResizeStart?.();
    
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    
    // Add will-change only during drag
    containerRef.current.style.willChange = 'transform';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [handleMouseMove, handleMouseUp, onResizeStart]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;

    e.preventDefault();
    const nextHeight = e.key === 'Home'
      ? minBottomHeight
      : e.key === 'End'
        ? maxBottomHeight
        : bottomHeightRef.current + (e.key === 'ArrowUp' ? 2 : -2);

    const committedHeight = Math.max(minBottomHeight, Math.min(maxBottomHeight, nextHeight));
    updatePanelSizes(committedHeight, true);
    onResizeEnd?.(committedHeight);
  }, [maxBottomHeight, minBottomHeight, onResizeEnd, updatePanelSizes]);

  // Initialize panel sizes
  useEffect(() => {
    updatePanelSizes(bottomHeightRef.current, true);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (containerRef.current) containerRef.current.style.willChange = '';
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div 
      ref={containerRef}
       className={cn("flex min-h-0 flex-col h-full w-full relative overflow-hidden", className)}
      style={{
        // Paint containment can clip/fix-position overlays and makes terminal
        // content look occluded during a drag. Layout/style containment keeps
        // the resize cheap without creating an extra paint boundary.
        contain: 'layout style',
      }}
    >
      {/* Top Panel */}
      <div
        ref={topPanelRef}
        className="w-full min-h-0 overflow-hidden"
        style={{
          flex: `${100 - bottomHeightRef.current} 1 0%`,
          minHeight: 0,
          transition: 'none',
        }}
      >
        {topContent}
      </div>

      {/* Resize Handle */}
      <div
        ref={handleRef}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        data-panel-resize-handle
        data-panel-group-direction="vertical"
        data-resize-handle-state={isDragging ? 'drag' : 'inactive'}
        className={cn(
          "group relative z-50 flex h-3 shrink-0 w-full items-center justify-center",
          "cursor-ns-resize select-none touch-none border-y border-transparent bg-transparent",
          "transition-colors duration-150 ease-out hover:border-transparent hover:bg-transparent"
        )}
        role="separator"
        tabIndex={0}
        aria-label="Resize terminal panel"
        aria-orientation="horizontal"
        aria-valuemin={minBottomHeight}
        aria-valuemax={maxBottomHeight}
        aria-valuenow={Math.round(bottomHeightRef.current)}
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Shared always-visible grabber — consistent with every other terminal divider */}
        <ResizeGrip active={isDragging} direction="vertical" />
      </div>

      {/* Bottom Panel */}
      <div
        ref={bottomPanelRef}
        className="w-full min-h-0 shrink-0 overflow-hidden"
        style={{
          flex: `${bottomHeightRef.current} 1 0%`,
          minHeight: 0,
          transition: 'none',
        }}
      >
        {bottomContent}
      </div>
    </div>
  );
}
