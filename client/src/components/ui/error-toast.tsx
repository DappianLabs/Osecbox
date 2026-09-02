/**
 * Error Toast Component
 * Shows scan errors and other critical errors in the GUI
 */

import React from 'react';
import { AlertCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ErrorToastProps {
  title: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  details?: string; // Technical details (collapsed by default)
  action?: {
    label: string;
    onClick: () => void;
  };
  onClose: () => void;
}

export function ErrorToast({ title, message, type, details, action, onClose }: ErrorToastProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  const icons = {
    error: <XCircle className="w-5 h-5 text-red-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };

  const colors = {
    error: 'border-red-500/50 bg-red-950/50',
    warning: 'border-yellow-500/50 bg-yellow-950/50',
    info: 'border-blue-500/50 bg-blue-950/50',
  };

  return (
    <div className={cn(
      "rounded-lg border-2 p-4 shadow-lg backdrop-blur-sm",
      colors[type]
    )}>
      <div className="flex items-start gap-3">
        {icons[type]}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-foreground">{title}</h4>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {details && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-primary hover:underline"
              >
                {showDetails ? 'Hide' : 'Show'} technical details
              </button>
              {showDetails && (
                <pre className="mt-2 p-2 bg-black/50 rounded text-xs text-green-400 overflow-x-auto font-mono">
                  {details}
                </pre>
              )}
            </div>
          )}

          {action && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={action.onClick}
                className="text-xs"
              >
                {action.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
