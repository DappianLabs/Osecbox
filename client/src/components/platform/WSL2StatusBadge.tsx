/**
 * WSL2 Status Badge Component
 * 
 * Displays WSL2 availability status with visual indicators
 */

import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { usePlatform } from '@/hooks/usePlatform';

interface WSL2StatusBadgeProps {
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function WSL2StatusBadge({ 
  showLabel = true, 
  size = 'md',
  className = '' 
}: WSL2StatusBadgeProps) {
  const { platformInfo, isLoading } = usePlatform();

  // Don't show on non-Windows platforms
  if (!platformInfo?.isWindows) {
    return null;
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  if (isLoading) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-md bg-muted ${sizeClasses[size]} ${className}`}>
        <Loader2 className={`${iconSizes[size]} animate-spin text-muted-foreground`} />
        {showLabel && <span className="text-muted-foreground">Checking WSL2...</span>}
      </div>
    );
  }

  const status = platformInfo.wsl2Status;

  switch (status) {
    case 'available':
      return (
        <div 
          className={`inline-flex items-center gap-1.5 rounded-md bg-green-500/10 border border-green-500/20 ${sizeClasses[size]} ${className}`}
          title={`WSL2 ${platformInfo.wsl2Version || ''} - ${platformInfo.defaultDistro || 'Default distro'}`}
        >
          <CheckCircle className={`${iconSizes[size]} text-green-500`} />
          {showLabel && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              WSL2 Ready
            </span>
          )}
        </div>
      );

    case 'not-installed':
      return (
        <div 
          className={`inline-flex items-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/20 ${sizeClasses[size]} ${className}`}
          title="WSL2 not detected - Linux tools will not work"
        >
          <XCircle className={`${iconSizes[size]} text-red-500`} />
          {showLabel && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              WSL2 Not Found
            </span>
          )}
        </div>
      );

    case 'unavailable':
      return (
        <div
          className={`inline-flex items-center gap-1.5 rounded-md bg-orange-500/10 border border-orange-500/20 ${sizeClasses[size]} ${className}`}
          title={platformInfo.wsl2Error || 'WSL2 is installed but the service could not execute a command'}
        >
          <AlertCircle className={`${iconSizes[size]} text-orange-500`} />
          {showLabel && (
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              WSL2 Unavailable
            </span>
          )}
        </div>
      );

    case 'checking':
      return (
        <div className={`inline-flex items-center gap-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 ${sizeClasses[size]} ${className}`}>
          <AlertCircle className={`${iconSizes[size]} text-yellow-500`} />
          {showLabel && (
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">
              Checking...
            </span>
          )}
        </div>
      );

    default:
      return null;
  }
}
