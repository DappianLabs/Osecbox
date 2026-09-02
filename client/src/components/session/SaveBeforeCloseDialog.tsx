// Save Before Close Dialog - Prompts user to save session before closing app

import React, { useState } from 'react';
import { SessionManager } from '@/lib/session-manager';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Save, X } from 'lucide-react';

interface SaveBeforeCloseDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function SaveBeforeCloseDialog({ open, onSave, onDiscard, onCancel }: SaveBeforeCloseDialogProps) {
  const [sessionName, setSessionName] = useState(`Session ${new Date().toLocaleString()}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SAVE_TIMEOUT_MS = 10000;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    let timeoutId: number | undefined;
    try {
      const savePromise = SessionManager.saveSession(sessionName.trim() || `Session ${new Date().toLocaleString()}`);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Session save timed out after 10 seconds. Choose “Don\'t Save” to close without waiting.'));
        }, SAVE_TIMEOUT_MS);
      });
      await Promise.race([savePromise, timeoutPromise]);
      onSave();
    } catch (saveError: any) {
      console.error('Failed to save session:', saveError);
      setError(saveError?.message || 'The session could not be saved. The window is still open.');
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Save Your Work?
          </DialogTitle>
          <DialogDescription>
            You have unsaved work. Would you like to save your current workspace before closing?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="session-name">Session Name</Label>
            <Input
              id="session-name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Enter session name..."
              className="mt-1"
              autoFocus
            />
          </div>

          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            💡 Your workspace includes all tabs, scans, configurations, AI conversations, and history
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onDiscard}
            disabled={saving}
          >
            <X className="w-4 h-4 mr-2" />
            Don't Save
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save & Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
