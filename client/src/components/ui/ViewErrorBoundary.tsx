/**
 * View Error Boundary
 * Wraps any view and shows error summary at the top
 */

import React from 'react';
import { useErrorStore } from '@/lib/error-store';
import { ErrorSummaryPanel } from '@/components/scanners/ErrorSummaryPanel';

interface ViewErrorBoundaryProps {
  viewName: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function ViewErrorBoundary({ viewName, onRetry, children }: ViewErrorBoundaryProps) {
  // FIX: Use useState + useEffect to avoid selector re-creation issues
  const [errors, setErrors] = React.useState<any[]>([]);
  
  React.useEffect(() => {
    // Subscribe to store changes
    const unsubscribe = useErrorStore.subscribe((state) => {
      const viewErrors = state.errors[viewName];
      setErrors(viewErrors && viewErrors.length > 0 ? viewErrors : []);
    });
    
    // Set initial value
    const initialErrors = useErrorStore.getState().errors[viewName];
    setErrors(initialErrors && initialErrors.length > 0 ? initialErrors : []);
    
    return unsubscribe;
  }, [viewName]);
  
  const clearErrors = useErrorStore((state) => state.clearErrors);

  return (
    <div className="h-full flex flex-col">
      {errors.length > 0 && (
        <div className="p-2 flex-shrink-0">
          <ErrorSummaryPanel
            errors={errors}
            onRetry={onRetry}
            onClear={() => clearErrors(viewName)}
          />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
