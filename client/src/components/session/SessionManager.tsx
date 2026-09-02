// Session Manager UI - Save/Load/Manage workspace sessions

import React, { useState, useEffect } from 'react';
import { SessionManager, SessionMetadata } from '@/lib/session-manager';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Save, FolderOpen, Trash2, Download, Upload, Clock, Layers, Database, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMonetizationEnabled } from '@/lib/feature-flags';

interface SessionManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'save' | 'load';
}

export function SessionManagerDialog({ open, onOpenChange, mode }: SessionManagerDialogProps) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    if (open) {
      loadSessions();
    }
  }, [open]);

  const loadSessions = async () => {
    try {
      const metadata = await SessionManager.getSessionMetadata();
      setSessions(metadata);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSave = async () => {
    if (!sessionName.trim()) {
      setError('Please enter a session name');
      return;
    }

    setLoading(true);
    setError(null);

    // Sessions are always free - no upgrade prompts
    try {
      await SessionManager.saveSession(sessionName.trim(), sessionDescription.trim() || undefined);

      // Show success toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `Session "${sessionName}" saved successfully`, type: 'success' }
      }));

      // Reset form
      setSessionName('');
      setSessionDescription('');
      await loadSessions();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    if (!selectedSession) {
      setError('Please select a session to load');
      return;
    }

    setLoading(true);
    setError(null);

    // Sessions are always free - no upgrade prompts
    try {
      await SessionManager.loadSession(selectedSession);

      const session = sessions.find(s => s.id === selectedSession);

      // Show success toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `Session "${session?.name}" loaded successfully`, type: 'success' }
      }));

      // SessionManager restores the live stores in place. Avoid a full page
      // reload: it recreated terminals, delayed the UI, and could race the
      // pending terminal snapshot restore.
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (!window.confirm(`Delete session "${session.name}"?`)) {
      return;
    }

    try {
      await SessionManager.deleteSession(sessionId);
      await loadSessions();
      
      if (selectedSession === sessionId) {
        setSelectedSession(null);
      }
      
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `Session "${session.name}" deleted`, type: 'success' }
      }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExport = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      await SessionManager.exportSession(sessionId);
      
      const session = sessions.find(s => s.id === sessionId);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `Session "${session?.name}" exported`, type: 'success' }
      }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      setLoading(true);
      setError(null);

      try {
        await SessionManager.importSession(file);
        await loadSessions();
        
        window.dispatchEvent(new CustomEvent('show-toast', {
          detail: { message: 'Session imported successfully', type: 'success' }
        }));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    input.click();
  };

  const formatDate = (timestamp: string | number) => {
    // FIX: Handle both string (ISO) and number (timestamp) formats
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
    
    // Format as date
    return date.toLocaleDateString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'save' ? (
              <>
                <Save className="w-5 h-5" />
                Save Workspace Session
              </>
            ) : (
              <>
                <FolderOpen className="w-5 h-5" />
                Load Workspace Session
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === 'save' 
              ? 'Save your current workspace including all tabs, scans, configurations, and history'
              : 'Load a previously saved workspace session'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {mode === 'save' ? (
            // Save Mode
            <div className="space-y-4">
              <div>
                <Label htmlFor="session-name">Session Name *</Label>
                <Input
                  id="session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g., Pentest Project Alpha"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="session-description">Description (Optional)</Label>
                <Textarea
                  id="session-description"
                  value={sessionDescription}
                  onChange={(e) => setSessionDescription(e.target.value)}
                  placeholder="Add notes about this session..."
                  className="mt-1"
                  rows={3}
                />
              </div>
              
              {/* Existing Sessions */}
              {sessions.length > 0 && (
                <div>
                  <Label>Existing Sessions ({sessions.length})</Label>
                  <ScrollArea className="h-48 mt-2 border rounded-lg">
                    <div className="p-2 space-y-2">
                      {sessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          selected={false}
                          onSelect={() => {}}
                          onDelete={handleDelete}
                          onExport={handleExport}
                          formatDate={formatDate}
                          formatSize={formatSize}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 If a session with the same name exists, it will be updated
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Load Mode
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <Label>Select a Session ({sessions.length})</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleImport}
                  disabled={loading}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </Button>
              </div>
              
              {sessions.length === 0 ? (
                <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/20">
                  <div className="text-center max-w-md p-8">
                    <Database className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No Saved Sessions</h3>
                    <p className="text-sm text-muted-foreground">
                      Save your first workspace session to get started
                    </p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="flex-1 border rounded-lg">
                  <div className="p-2 space-y-2">
                    {sessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        selected={selectedSession === session.id}
                        onSelect={() => setSelectedSession(session.id)}
                        onDelete={handleDelete}
                        onExport={handleExport}
                        formatDate={formatDate}
                        formatSize={formatSize}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          {mode === 'save' ? (
            <Button onClick={handleSave} disabled={loading || !sessionName.trim()}>
              {loading ? 'Saving...' : 'Save Session'}
            </Button>
          ) : (
            <Button onClick={handleLoad} disabled={loading || !selectedSession}>
              {loading ? 'Loading...' : 'Load Session'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SessionCardProps {
  session: SessionMetadata;
  selected: boolean;
  onSelect: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onExport: (id: string, e: React.MouseEvent) => void;
  formatDate: (timestamp: string | number) => string; // FIX: Accept both string and number
  formatSize: (bytes: number) => string;
}

function SessionCard({ session, selected, onSelect, onDelete, onExport, formatDate, formatSize }: SessionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full p-3 rounded-lg border text-left transition-all relative group",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">
            {session.name}
          </h3>
          {session.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {session.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => onExport(session.id, e)}
            className="h-7 w-7 p-0"
            title="Export"
          >
            <Download className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => onDelete(session.id, e)}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{formatDate(session.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Layers className="w-3 h-3" />
          <span>{session.tabCount} tabs</span>
        </div>
        <div className="flex items-center gap-1">
          <Database className="w-3 h-3" />
          <span>{formatSize(session.size)}</span>
        </div>
      </div>
    </button>
  );
}
