/**
 * Save Button Component
 * Provides save functionality for terminal content and app state
 */

import React, { useState } from 'react';
import { Save, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { terminalService } from '@/lib/terminal-service';
import { SessionManager } from '@/lib/session-manager';
import { useTerminalTabsStore } from '@/lib/terminal-tabs-store';

interface SaveButtonProps {
  type: 'tab' | 'section' | 'app';
  terminalId?: string;
  sectionName?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function SaveButton({ 
  type, 
  terminalId, 
  sectionName,
  variant = 'ghost',
  size = 'sm'
}: SaveButtonProps) {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const terminalCount = useTerminalTabsStore((state) => state.terminals.length);

  const readTerminalOutput = (id: string): string => {
    let output = terminalService.getOutput(id);
    try {
      const terminal = terminalService.getTerminal(id);
      if (terminal) {
        const buffer = terminal.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        const xtermOutput = lines.join('\n');
        if (xtermOutput.length > output.length) output = xtermOutput;
      }
    } catch (err) {
      console.warn(`[SaveButton] Could not read xterm buffer for ${id}:`, err);
    }
    return output;
  };

  const saveTabContent = async () => {
    try {
      setIsSaving(true);

      if (!terminalId) {
        showToast('No terminal ID provided', 'error');
        return;
      }

      // Electron streams the durable chunk files directly to disk. Do not
      // build a Blob from xterm or the renderer cache: both are intentionally
      // bounded views and cannot represent a multi-hundred-megabyte scan.
      if (window.electron?.terminalHistoryExport) {
        await terminalService.flushPersistedHistory([terminalId]);
        const result = await window.electron.terminalHistoryExport({
          ptyIds: [terminalId],
          suggestedName: 'terminal-' + terminalId,
        });
        if (result.canceled) return;
        if (!result.success) {
          throw new Error(result.error || 'Failed to export terminal transcript');
        }
        showToast('Full terminal transcript saved', 'success');
        return;
      }
      
      // FIX: Get output from BOTH the buffer AND the xterm.js terminal
      let output = terminalService.getOutput(terminalId);
      
      // Also try to get output directly from the xterm.js instance
      try {
        const terminal = terminalService.getTerminal(terminalId);
        if (terminal) {
          // Get all lines from xterm buffer
          const buffer = terminal.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
          const xtermOutput = lines.join('\n');
          
          // Use whichever is longer (more complete)
          if (xtermOutput.length > output.length) {
            output = xtermOutput;
          }
        }
      } catch (err) {
        console.warn('[SaveButton] Could not get xterm buffer, using service buffer:', err);
      }
      
      if (!output || output.length === 0) {
        showToast('No content to save', 'warning');
        return;
      }

      // Use Blob API (works on all platforms)
      const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      // Sanitize filename for Windows/Linux/Mac
      const timestamp = Date.now();
      const sanitizedTerminalId = terminalId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const filename = `terminal-${sanitizedTerminalId}-${timestamp}.txt`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // CLEANUP: Remove element and revoke URL after a delay
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      showToast('Terminal content saved', 'success');
    } catch (error) {
      console.error('[SaveButton] Failed to save tab content:', error);
      showToast('Failed to save content', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveSectionContent = async () => {
    try {
      setIsSaving(true);
      
      // For section save, include every open general terminal when no
      // specific terminal was supplied by the caller.
      const terminalIds = terminalId
        ? [terminalId]
        : useTerminalTabsStore.getState().terminals.map(terminal => terminal.id);

      if (terminalIds.length === 0) {
        showToast('No terminals are open', 'warning');
        return;
      }

      if (window.electron?.terminalHistoryExport) {
        await terminalService.flushPersistedHistory(terminalIds);
        const result = await window.electron.terminalHistoryExport({
          ptyIds: terminalIds,
          suggestedName: sectionName || 'section',
        });
        if (result.canceled) return;
        if (!result.success) {
          throw new Error(result.error || 'Failed to export section transcripts');
        }
        showToast('Full section transcripts saved', 'success');
        return;
      }

      // FIX: Get output from BOTH the buffer AND the xterm.js terminal
      let output = terminalIds
        .map(id => `===== ${id} =====\n${readTerminalOutput(id)}`)
        .join('\n\n');
      
      if (!output || output.length === 0) {
        showToast('No content to save', 'warning');
        return;
      }

      // Use Blob API (works on all platforms)
      const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      // Sanitize filename for Windows/Linux/Mac
      const timestamp = Date.now();
      const sanitizedSectionName = (sectionName || 'section').replace(/[^a-zA-Z0-9-_]/g, '_');
      const filename = `${sanitizedSectionName}-${timestamp}.txt`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // CLEANUP: Remove element and revoke URL after a delay
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      showToast('Section content saved', 'success');
    } catch (error) {
      console.error('[SaveButton] Failed to save section content:', error);
      showToast('Failed to save content', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveAppState = async () => {
    try {
      setIsSaving(true);
      const sessionName = `Session-${new Date().toLocaleString()}`;
      await SessionManager.saveSession(sessionName, 'Auto-saved session');
      showToast('App state saved', 'success');
    } catch (error) {
      console.error('[SaveButton] Failed to save app state:', error);
      showToast(
        error instanceof Error ? error.message : 'Failed to save app state',
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (type === 'tab') {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={saveTabContent}
        disabled={isSaving || !terminalId}
        title="Export full terminal transcript"
      >
        <Save className="w-4 h-4" />
        {size !== 'icon' && <span className="ml-2">Save Tab</span>}
      </Button>
    );
  }

  if (type === 'section') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={isSaving}
            title="Export full section transcripts"
          >
            <Save className="w-4 h-4" />
            {size !== 'icon' && <span className="ml-2">Save</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={saveTabContent} disabled={!terminalId}>
            <FileText className="w-4 h-4 mr-2" />
            Export Full Current Transcript
          </DropdownMenuItem>
           <DropdownMenuItem onClick={saveSectionContent} disabled={!terminalId && terminalCount === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export Full Section Transcripts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (type === 'app') {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={saveAppState}
        disabled={isSaving}
        title="Save entire app state"
      >
        <Save className="w-4 h-4" />
        {size !== 'icon' && <span className="ml-2">Save Session</span>}
      </Button>
    );
  }

  return null;
}
