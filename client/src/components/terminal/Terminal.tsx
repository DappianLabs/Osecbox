/**
 * Terminal Component - Clean xterm.js wrapper
 * 
 * Simple terminal component that works with opacity-based visibility switching.
 * No complex workarounds needed when display:none is avoided.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { terminalService } from '@/lib/terminal-service';
import { copyTextToClipboard, readTextFromClipboard } from '@/lib/clipboard';

interface TerminalProps {
  sessionId: string;
  sessionType?: 'scan' | 'foothold' | 'tunneling' | 'metasploit' | 'general';
  className?: string;
  isActive?: boolean;
  disableResize?: boolean;
}

export const Terminal = React.memo(function Terminal({ 
  sessionId, 
  sessionType = 'general',
  className = 'w-full h-full bg-black',
  isActive = true,
  disableResize = false
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showCopyButton, setShowCopyButton] = useState(false);
  const [copied, setCopied] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  const [terminalReady, setTerminalReady] = useState(0);
  const lastFitAtRef = useRef(0);
  const restoreRafRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate sessionId
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-full text-destructive">
          <div className="text-center">
            <p className="text-sm">Invalid terminal session</p>
            <p className="text-xs text-muted-foreground mt-2">SessionId: "{sessionId}"</p>
          </div>
        </div>
      </div>
    );
  }

  // Check electron availability
  if (!window.electron) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-full text-destructive">
          <div className="text-center">
            <p className="text-sm">Electron API not available</p>
            <p className="text-xs text-muted-foreground mt-2">Terminal requires Electron environment</p>
          </div>
        </div>
      </div>
    );
  }

  // Handle copy button for terminal selection
  const handleCopySelection = useCallback(async () => {
    if (!isActive) return;

    try {
      const terminal = terminalService.getTerminal(sessionId);
      if (!terminal) return;

      const selection = terminal.getSelection();
      if (!selection) return;

      await copyTextToClipboard(selection);
      setCopied(true);
      
      setTimeout(() => {
        setShowCopyButton(false);
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error('[Terminal] Failed to copy selection:', error);
    }
  }, [isActive, sessionId]);

  const writePastedInput = useCallback((data: string) => {
    if (!isActive || !data) return;
    terminalService.writeWhenReady(sessionId, data);
  }, [isActive, sessionId]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!isActive) return;

    const text = event.clipboardData.getData('text/plain');
    if (!text) return;

    // Handle paste at the wrapper so keyboard and context-menu paste work even
    // when xterm's hidden textarea is inside a panel that was recently resized.
    event.preventDefault();
    writePastedInput(text);
  }, [isActive, writePastedInput]);

  const handleTerminalKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isActive) return;

    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (modifier && key === 'c') {
      const terminal = terminalService.getTerminal(sessionId);
      const selection = terminal?.getSelection();

      // Preserve Ctrl/Cmd+C as SIGINT when there is no selection.
      if (selection) {
        event.preventDefault();
        void handleCopySelection();
      }
      return;
    }

    if ((modifier && key === 'v') || (event.shiftKey && event.key === 'Insert')) {
      event.preventDefault();
      void readTextFromClipboard()
        .then(text => writePastedInput(text))
        .catch(error => console.warn('[Terminal] Clipboard paste unavailable:', error));
    }
  }, [handleCopySelection, isActive, sessionId, writePastedInput]);

  // Create terminal and PTY on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    console.log(`[Terminal] Mounting terminal: ${sessionId}, type: ${sessionType}, isActive: ${isActive}`);

    const initTerminal = async () => {
      try {
        // Kick off xterm loading, but do not make the first prompt wait for it.
        // The PTY output is retained by TerminalService while the renderer is
        // loading and is replayed when attach() completes.
        terminalService.preloadTerminalRenderer();

        // Start/reuse the backend PTY first. getOrCreatePTY is idempotent and
        // recreates a stale shell, which fixes returning to a dead scan tab.
        if (sessionType !== 'metasploit') {
          // If the renderer cache was released or the app was restarted,
          // restore the durable tail before starting the replacement shell so
          // the old transcript stays before the new prompt.
          await terminalService.hydrateFromHistory(sessionId);
          console.log(`[Terminal] Ensuring PTY: ${sessionId}`);
          terminalService.getOrCreatePTY(sessionId, sessionType);
        } else {
          await terminalService.hydrateFromHistory(sessionId);
          console.log(`[Terminal] Metasploit session - skipping backend PTY creation`);
          const pty = terminalService.getOrCreatePTY(sessionId, sessionType);
          pty.isActive = true;
        }

        // Create the renderer in parallel with PTY startup. Do not await a
        // second creation when the xterm instance already exists.
        if (!terminalService.hasTerminal(sessionId)) {
          console.log(`[Terminal] Creating NEW terminal instance: ${sessionId}`);
          await terminalService.getOrCreateTerminal(sessionId, sessionType);
        } else {
          console.log(`[Terminal] Reusing EXISTING terminal instance: ${sessionId}`);
        }

        if (cancelled || !containerRef.current) {
          if (cancelled && terminalService.hasTerminal(sessionId)) {
            terminalService.scheduleTerminalRelease(sessionId);
          }
          return;
        }
        
        // ALWAYS attach immediately, even if not active
        // This ensures canvas is initialized properly AND sets up input handler
        await terminalService.attach(sessionId, containerRef.current!);
        if (cancelled) {
          // Navigation can happen while xterm/WSL are still attaching. Keep
          // the retained PTY/output state, but release the detached renderer
          // on the same delayed path as a normal unmount.
          terminalService.scheduleTerminalRelease(sessionId);
          return;
        }
        setTerminalReady(value => value + 1);
        console.log(`[Terminal] Attached terminal ${sessionId} to container`);
        
        // `attach()` is the single owner of PTY binding and input wiring. Do
        // not schedule a second MSF attach here: a delayed rebind can race a
        // streaming output burst and used to make prompt/input behavior look
        // duplicated after a remount.
        
        // SESSION RESTORE: Check if there's saved output to restore
        const pendingRestore = localStorage.getItem('pending-terminal-restore');
        if (pendingRestore) {
          try {
            const snapshots = JSON.parse(pendingRestore);
            const snapshotIndex = snapshots.findIndex((s: any) => s.id === sessionId);
            
            if (snapshotIndex !== -1) {
              const snapshot = snapshots[snapshotIndex];
              
              // FIX: Remove snapshot IMMEDIATELY to prevent race conditions
              snapshots.splice(snapshotIndex, 1);
              if (snapshots.length === 0) {
                localStorage.removeItem('pending-terminal-restore');
                console.log('[Terminal] All terminal outputs restored, cleared pending list');
              } else {
                localStorage.setItem('pending-terminal-restore', JSON.stringify(snapshots));
              }
              
              // IMPROVED: Wait for PTY to be fully ready before writing
              const waitForPTY = async () => {
                let attempts = 0;
                while (attempts < 50) { // Max 5 seconds (increased for slow systems)
                  const pty = terminalService.getPTY(sessionId);
                  if (pty && pty.isActive) {
                    // ADDITIONAL WAIT: Give PTY extra time to fully initialize
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // PTY is ready, restore session state
                    try {
                      // Durable terminal history is the source of truth now.
                      // A legacy localStorage snapshot can still exist after a
                      // session load, but replaying it on top of a hydrated or
                      // already-live buffer duplicates prompts and command
                      // output. Only use the snapshot as a fallback when this
                      // session has no retained bytes at all.
                      if (terminalService.getOutput(sessionId).length > 0) {
                        console.log(`[Terminal] Skipping legacy snapshot for ${sessionId}; retained terminal output already exists`);
                        return;
                      }

                      // Show restoration banner
                      const banner = `\r\n\x1b[1;36m╔════════════════════════════════════════════════════════════╗\x1b[0m\r\n` +
                                   `\x1b[1;36m║\x1b[0m  \x1b[1;33m📦 Session Restored\x1b[0m                                      \x1b[1;36m║\x1b[0m\r\n` +
                                   `\x1b[1;36m║\x1b[0m  Previous terminal output and state have been restored    \x1b[1;36m║\x1b[0m\r\n` +
                                   `\x1b[1;36m║\x1b[0m  \x1b[90m(New shell session with restored history)\x1b[0m              \x1b[1;36m║\x1b[0m\r\n` +
                                   `\x1b[1;36m╚════════════════════════════════════════════════════════════╝\x1b[0m\r\n\r\n`;
                      
                      terminalService.writeToTerminal(sessionId, banner);
                      
                      // Detect shell type from saved snapshot
                      const shellType = snapshot.envVars?.SHELL_TYPE || 'bash';
                      const isPowerShell = shellType === 'powershell';
                      
                      // IMPROVED: Restore working directory via backend (no echo)
                      if (snapshot.workingDirectory && snapshot.workingDirectory !== '~') {
                        try {
                          if (window.electron?.restoreTerminalState) {
                            await window.electron.restoreTerminalState(sessionId, {
                              workingDirectory: snapshot.workingDirectory,
                              envVars: snapshot.envVars
                            });
                            console.log(`[Terminal] ✅ Restored working directory via backend: ${snapshot.workingDirectory} (${shellType})`);
                          } else {
                            throw new Error('Backend not available');
                          }
                        } catch (error) {
                          console.error(`[Terminal] Failed to restore working directory:`, error);
                          // Fallback to manual cd command
                          if (isPowerShell) {
                            terminalService.writeToTerminal(sessionId, `Set-Location "${snapshot.workingDirectory}"\r`);
                          } else {
                            terminalService.writeToTerminal(sessionId, `cd ${snapshot.workingDirectory}\r`);
                          }
                        }
                      }
                      
                      // Restore command history if available
                      if (snapshot.commandHistory && snapshot.commandHistory.length > 0) {
                        if (isPowerShell) {
                          // Windows PowerShell: Show recent commands as comment
                          const recentCommands = snapshot.commandHistory.slice(-3).join(', ');
                          const historyNote = `# Previous session commands: ${recentCommands}\r`;
                          terminalService.writeToTerminal(sessionId, historyNote);
                          console.log(`[Terminal] ℹ️ PowerShell history note shown (${snapshot.commandHistory.length} commands saved)`);
                        } else {
                          // Linux/WSL/Mac: Write to bash history
                          // Use printf for proper escaping
                          const historyCommands = snapshot.commandHistory
                            .map((cmd: string) => cmd.replace(/'/g, "'\\''")) // Escape single quotes
                            .join('\\n');
                          const historyCmd = `printf '%s\\n' '${historyCommands}' >> ~/.bash_history 2>/dev/null\r`;
                          terminalService.writeToTerminal(sessionId, historyCmd);
                          console.log(`[Terminal] ✅ Restored ${snapshot.commandHistory.length} commands to bash history`);
                        }
                      }
                      
                      // Write and persist the legacy fallback output through the
                      // same synthetic-output path as other terminal evidence.
                      // This keeps an old session recoverable/exportable after
                      // the first restore instead of leaving it renderer-only.
                      terminalService.writeExternalOutput(sessionId, snapshot.output, true);
                      console.log(`[Terminal] ✅ Restored ${snapshot.output.length} chars of output for ${sessionId}`);
                      
                      // Focus terminal so user can type immediately
                      terminalService.focus(sessionId);
                      console.log(`[Terminal] ✅ Terminal focused and ready for input: ${sessionId}`);
                      
                      return;
                    } catch (error) {
                      console.error(`[Terminal] Failed to write output to ${sessionId}:`, error);
                      return;
                    }
                  }
                  await new Promise(resolve => setTimeout(resolve, 100));
                  attempts++;
                }
                console.error(`[Terminal] ❌ PTY not ready after 5s, restoration FAILED for ${sessionId}`);
                console.error(`[Terminal] This means the terminal will NOT work properly - user cannot continue where they left off`);
              };
              
              waitForPTY();
            }
          } catch (error) {
            console.error('[Terminal] Failed to restore terminal output:', error);
          }
        }
        
        // Force canvas paint IMMEDIATELY, even if not active
        // This prevents black box issue when terminal starts hidden
        const initializeCanvas = () => {
          if (!terminalService.hasTerminal(sessionId)) return;
          
          const terminal = terminalService.getTerminal(sessionId);
          if (!terminal) return;
          
          // STEP 1: Force initial render by writing empty string
          // This ensures canvas is painted and ready, even if hidden
          terminal.write('');
          
          // STEP 2: Fit terminal (skip if resizing or not active)
          if (!disableResize && isActive) {
            // FIX: Wait for container to stabilize before first fit
            setTimeout(() => {
              if (!cancelled && terminalService.hasTerminal(sessionId)) {
                terminalService.fit(sessionId);
                lastFitAtRef.current = performance.now();
              }
            }, 100);
          }
          
          // STEP 3: Focus terminal - only if active
          if (!cancelled && isActive) {
            terminalService.focus(sessionId);
          }
        };
        
        // Initialize immediately without RAF delay
        initializeCanvas();
        
      } catch (error) {
        console.error(`[Terminal] Initialization failed:`, error);
      }
    };

    void initTerminal();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionType]);

  // TerminalRenderer may evict the oldest xterm when the configured renderer
  // cap is reached. That is a RAM policy, not a session-destruction policy:
  // recreate and reattach the view from the same retained PTY/buffer so a
  // mounted scan/listener terminal never turns into a blank orphan.
  useEffect(() => {
    let cancelled = false;

    const handleRendererEvicted = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string }>).detail;
      if (detail?.terminalId !== sessionId) return;

      void (async () => {
        try {
          await terminalService.getOrCreateTerminal(sessionId, sessionType);
          if (cancelled || !containerRef.current) return;

          await terminalService.attach(sessionId, containerRef.current);
          if (cancelled) return;

          setTerminalReady(value => value + 1);
          if (isActive) {
            if (!disableResize) terminalService.fit(sessionId);
            terminalService.focus(sessionId);
          }
        } catch (error) {
          console.error(`[Terminal] Renderer recovery failed for ${sessionId}:`, error);
        }
      })();
    };

    window.addEventListener('terminal-renderer-evicted', handleRendererEvicted);
    return () => {
      cancelled = true;
      window.removeEventListener('terminal-renderer-evicted', handleRendererEvicted);
    };
  }, [disableResize, isActive, sessionId, sessionType]);

  // COPY BUTTON: Separate effect for selection listener
  useEffect(() => {
    const terminal = terminalService.getTerminal(sessionId);
    if (!terminal) return;

    const disposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection && selection.trim().length > 0) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          setButtonPosition({
            x: rect.right - 80,
            y: rect.top + 10
          });
          setShowCopyButton(true);
          setCopied(false);
        }
      } else {
        setShowCopyButton(false);
        setCopied(false);
      }
    });

    // Cleanup listener on unmount
    return () => {
      disposable?.dispose();
    };
  }, [sessionId, terminalReady]);

  // Keep the latest user viewport in the service while the component stays
  // mounted. Resize/reflow can happen without a click or unmount, so relying
  // only on cleanup-time snapshots loses the scroll position during repeated
  // drag cycles. One RAF per frame keeps this off React's render path.
  useEffect(() => {
    const terminal = terminalService.getTerminal(sessionId);
    if (!terminal) return;

    let frame: number | null = null;
    const disposable = terminal.onScroll(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (terminalService.hasTerminal(sessionId)) {
          terminalService.saveScrollPosition(sessionId);
        }
      });
    });

    return () => {
      disposable.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [sessionId, terminalReady]);

  // A section can stay mounted while its parent is hidden with display:none.
  // Snapshot the real viewport at the visibility transition, before layout
  // becomes zero-sized, so the next fit can restore the user's position.
  useEffect(() => {
    if (isActive) return;
    if (terminalService.hasTerminal(sessionId)) {
      terminalService.saveScrollPosition(sessionId);
    }
  }, [isActive, sessionId]);

  // SCAN SECTION PATTERN: Save scroll position when component unmounts
  useEffect(() => {
    // Save scroll position when switching away from this terminal
    return () => {
      if (sessionId) {
        if (terminalService.hasTerminal(sessionId)) {
          terminalService.saveScrollPosition(sessionId);
          terminalService.scheduleTerminalRelease(sessionId);
          console.log(`[Terminal] 🔒 SAVED scroll position for: ${sessionId}`);
          // DO NOT destroy terminal - let it persist
        }
      }
    };
  }, [sessionId]);

  // Restore terminal when it becomes active
  React.useEffect(() => {
    if (restoreRafRef.current !== null) {
      cancelAnimationFrame(restoreRafRef.current);
      restoreRafRef.current = null;
    }
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }

    if (!isActive) return;
    
    const restoreTerminal = () => {
      if (terminalService.hasTerminal(sessionId) && containerRef.current) {
        const terminal = terminalService.getTerminal(sessionId);
        if (!terminal) return;
        
        // Fit against the newly visible container first. Saving here is
        // unsafe: when the section was display:none, xterm may report a
        // zero-sized or synthetic viewport and overwrite the real snapshot.
        if (!disableResize) {
          terminalService.fit(sessionId);
          lastFitAtRef.current = performance.now();
        }

        // Focus terminal
        terminalService.focus(sessionId);
        
        // FIX #3: Restore scroll position AFTER fit completes (distance-from-bottom method)
        restoreTimerRef.current = setTimeout(() => {
          restoreTimerRef.current = null;
          if (terminalService.hasTerminal(sessionId)) {
            terminalService.restoreScrollPosition(sessionId);
          }
        }, 100);
      }
    };
    
    // Use single RAF for speed
    restoreRafRef.current = requestAnimationFrame(() => {
      restoreRafRef.current = null;
      restoreTerminal();
    });

    return () => {
      if (restoreRafRef.current !== null) {
        cancelAnimationFrame(restoreRafRef.current);
        restoreRafRef.current = null;
      }
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, [isActive, sessionId, disableResize, sessionType]);

  // SCAN SECTION PATTERN: Completely disable resize handling for smooth sliding
  // The terminal will auto-fit when it becomes visible
  // React.useEffect(() => {
  //   // Resize handling disabled for performance
  // }, [sessionId, isActive]);

  // BLACK BOX FIX: Add ResizeObserver to detect container size changes
  // FIX: Debounce more aggressively + only fit when container has stabilized
  React.useEffect(() => {
    if (!containerRef.current || !isActive) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = 0;
    let lastHeight = 0;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!isActive || disableResize) return;
      
      const entry = entries[0];
      if (!entry) return;
      
      const { width, height } = entry.contentRect;
      
      // FIX #1: Ignore spurious resize events (< 5px change)
      if (Math.abs(width - lastWidth) < 5 && Math.abs(height - lastHeight) < 5) {
        return;
      }
      
      lastWidth = width;
      lastHeight = height;
      
      // FIX #2: Debounce more aggressively during drag (300ms instead of 150ms)
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!terminalService.hasTerminal(sessionId)) return;
        terminalService.fit(sessionId);
        lastFitAtRef.current = performance.now();
      }, 300);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [sessionId, isActive, disableResize]);

  // Preserve the current scroll position before the terminal is refit.
  const handleClick = async () => {
    if (!isActive) return;
    
    try {
      const terminal = terminalService.getTerminal(sessionId);
      if (!terminal) return;
      
      terminalService.saveScrollPosition(sessionId);
      
      // Fit terminal only when the last fit is stale. Click-to-focus should be
      // cheap during repeated interaction; ResizeObserver handles real layout
      // changes separately.
      if (!disableResize && performance.now() - lastFitAtRef.current > 180) {
        terminalService.fit(sessionId);
        lastFitAtRef.current = performance.now();
      }
      
      // Focus terminal
      terminalService.focus(sessionId);
      
      // FIX: Restore scroll after fit completes
      setTimeout(() => {
        terminalService.restoreScrollPosition(sessionId);
      }, 50);
    } catch (error) {
      console.warn('[Terminal] Click error:', error);
    }
  };

  return (
    <div className="relative w-full h-full min-h-0 min-w-0 overflow-hidden">
      <div
        ref={containerRef}
        className={cn(className, 'min-h-0 min-w-0 overflow-hidden')}
        onClick={handleClick}
        onPasteCapture={handlePaste}
        onKeyDownCapture={handleTerminalKeyDown}
        onFocus={() => {
          console.log('[Terminal] Container focused');
        }}
        onBlur={() => {
          console.log('[Terminal] Container blurred');
        }}
        style={{ 
          cursor: 'text',
          userSelect: 'none',
          // Force proper canvas stacking
          position: 'relative',
          isolation: 'isolate',
        }}
        // ROOT CAUSE FIX: Make container focusable and auto-focus on mount
        tabIndex={-1}
      />
      
      {/* Copy Button for Terminal Selection */}
      {showCopyButton && (
        <div
          className="fixed z-[9999] pointer-events-auto"
          style={{
            left: `${buttonPosition.x}px`,
            top: `${buttonPosition.y}px`,
          }}
        >
          <button
            type="button"
            onClick={handleCopySelection}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg",
              "border border-border backdrop-blur-sm",
              "transition-all duration-200",
              copied
                ? "bg-green-500/90 text-white border-green-600"
                : "bg-card/95 text-foreground hover:bg-primary/90 hover:text-primary-foreground hover:border-primary"
            )}
            title={copied ? "Copied!" : "Copy selected text"}
            aria-label={copied ? "Copied selected text" : "Copy selected text"}
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
      )}
    </div>
  );
}, (prev, next) => {
  return prev.sessionId === next.sessionId && prev.isActive === next.isActive && prev.disableResize === next.disableResize;
});
