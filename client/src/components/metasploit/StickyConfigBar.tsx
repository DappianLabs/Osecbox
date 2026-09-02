import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Settings, Target, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StickyConfigBarProps {
  onExecute: () => void;
  onConfigure: () => void;
}

export function StickyConfigBar({ onExecute, onConfigure }: StickyConfigBarProps) {
  const { exploitContext, nextTarget, previousTarget, setExploitContext } = {
    exploitContext: { modulePath: '', config: {} as Record<string, string>, targetList: [] as string[], currentTargetIndex: 0 },
    nextTarget: () => null as string | null,
    previousTarget: () => null as string | null,
    setExploitContext: (_ctx: any) => {}
  };
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const { modulePath, config, targetList, currentTargetIndex } = exploitContext;
  const currentTarget = config.RHOSTS || '';
  const moduleName = modulePath ? modulePath.split('/').pop() : 'No module selected';

  const handleNextTarget = () => {
    const next = nextTarget();
    if (next) {
      console.log('Switched to next target:', next);
    }
  };

  const handlePreviousTarget = () => {
    const prev = previousTarget();
    if (prev) {
      console.log('Switched to previous target:', prev);
    }
  };

  const handleEditTarget = () => {
    setEditValue(currentTarget);
    setIsEditing(true);
  };

  const handleSaveTarget = () => {
    if (editValue.trim()) {
      setExploitContext({
        config: { ...config, RHOSTS: editValue.trim() }
      });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTarget();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  if (!modulePath) {
    return null; // Don't show if no module selected
  }

  return (
    <div className="h-12 bg-card border-b border-border flex items-center px-4 gap-3 shadow-sm">
      {/* Current Target */}
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-muted-foreground" />
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveTarget}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-48 px-2 py-1 bg-background border border-primary rounded text-sm font-mono focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={handleEditTarget}
            className="px-2 py-1 bg-background border border-input rounded text-sm font-mono hover:border-primary transition-colors"
          >
            {currentTarget || 'No target'}
          </button>
        )}
      </div>

      {/* Target Navigation */}
      {targetList.length > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePreviousTarget}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Previous target"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground">
            {currentTargetIndex + 1}/{targetList.length}
          </span>
          <button
            type="button"
            onClick={handleNextTarget}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Next target"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="h-6 w-px bg-border" />

      {/* Current Module */}
      <div className="flex items-center gap-2 flex-1">
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground truncate">{moduleName}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onConfigure}
          className="h-8"
        >
          <Settings className="w-3 h-3 mr-1" />
          Configure
        </Button>
        <Button
          size="sm"
          onClick={onExecute}
          disabled={!currentTarget}
          className="h-8 bg-primary hover:bg-primary/90"
        >
          <Play className="w-3 h-3 mr-1" />
          Execute
        </Button>
      </div>
    </div>
  );
}
