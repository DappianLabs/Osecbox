import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export type ToastActionElement = React.ReactElement;
export type ToastProps = React.ComponentPropsWithoutRef<'div'>;

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID(); // FIX: Use UUID to prevent ID collisions
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Expose showToast globally for scheduler
  React.useEffect(() => {
    (window as any).showToast = showToast;
    
    // Listen for scheduler toast events
    const handleSchedulerToast = (event: CustomEvent) => {
      const { message, type } = event.detail;
      showToast(message, type);
    };
    
    window.addEventListener('scheduler-toast', handleSchedulerToast as EventListener);
    
    return () => {
      delete (window as any).showToast;
      window.removeEventListener('scheduler-toast', handleSchedulerToast as EventListener);
    };
  }, [showToast]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-4 h-4" />;
      case 'error': return <AlertCircle className="w-4 h-4" />;
      case 'warning': return <AlertTriangle className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  const getColors = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-green-500/90 dark:bg-green-600/90 text-white border-green-600/50';
      case 'error': return 'bg-red-500/90 dark:bg-red-600/90 text-white border-red-600/50';
      case 'warning': return 'bg-yellow-500/90 dark:bg-yellow-600/90 text-white border-yellow-600/50';
      default: return 'bg-blue-500/90 dark:bg-blue-600/90 text-white border-blue-600/50';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Keep transient notifications in the app chrome. A bottom-center
          toast sits directly over terminal output (especially while a scan is
          being inspected) and can hide the exact lines the user needs to read.
          This rail is non-blocking for terminal interaction and stays clear of
          the terminal viewport. */}
      <div className="fixed top-14 right-4 z-[9999] flex max-h-[min(40vh,22rem)] w-[min(24rem,calc(100vw-2rem))] flex-col items-end gap-2 overflow-hidden pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
            className={`${getColors(toast.type)} backdrop-blur-md border rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 min-w-[200px] max-w-full pointer-events-auto ui-reveal`}
          >
            {getIcon(toast.type)}
            <span className="flex-1 font-medium text-xs">{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="hover:bg-white/20 rounded p-0.5 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
