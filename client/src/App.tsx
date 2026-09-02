import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateNotification } from "@/components/UpdateNotification";
import { SaveBeforeCloseDialog } from "@/components/session/SaveBeforeCloseDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SelectionCopyButton } from "@/components/ui/SelectionCopyButton";
import { bypassProtection } from "@/lib/bypass-protection";

// PERFORMANCE: Lazy load ALL heavy components
const Home = lazy(() => import("@/pages/Home"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Loading fallback component
const LoadingScreen = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-background" style={{ backgroundColor: '#0f0f14' }}>
    <div className="text-center">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

function Router() {
  useEffect(() => {
    // Global error handlers for unhandled errors
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[App] Unhandled promise rejection:', event.reason);
      // Prevent default browser behavior (console error)
      event.preventDefault();
      
      // Add to error store if available
      import('./lib/error-store').then(({ useErrorStore }) => {
        const { addError } = useErrorStore.getState();
        addError('global', {
          type: 'error',
          title: 'Unhandled Error',
          message: event.reason?.message || 'An unexpected error occurred',
          details: event.reason?.stack
        });
      }).catch(() => {
        // Fallback if error store not available
        console.error('[App] Failed to add error to store');
      });
    };

    const handleError = (event: ErrorEvent) => {
      console.error('[App] Global error:', event.error);
      
      // Add to error store if available
      import('./lib/error-store').then(({ useErrorStore }) => {
        const { addError } = useErrorStore.getState();
        addError('global', {
          type: 'error',
          title: 'JavaScript Error',
          message: event.message || 'An unexpected error occurred',
          details: event.error?.stack
        });
      }).catch(() => {
        // Fallback if error store not available
        console.error('[App] Failed to add error to store');
      });
    };

    // Register global error handlers
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    
    // Cleanup function
    return () => {
      // Cleanup global error handlers
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []); // Empty deps - only run once on mount
  
  return (
    <WouterRouter hook={useHashLocation}>
      <Suspense fallback={<LoadingScreen />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/app" component={Home} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </WouterRouter>
  );
}

function App() {
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // 🔒 SECURITY: Initialize bypass protection
  useEffect(() => {
    bypassProtection.initialize();
  }, []);

  // Prompt user to save session before closing
  useEffect(() => {
    // Listen for save request from Electron main process
    if (window.electron?.onRequestSaveBeforeClose) {
      const cleanup = window.electron.onRequestSaveBeforeClose(() => {
        setShowSavePrompt(true);
      });
      return cleanup;
    }
  }, []);

  // AI TOOL HANDLER: Initialize on mount for function calling support
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      import('./lib/ai-tool-handler').then(({ initializeAIToolHandler }) => {
        if (cancelled) return;
        cleanup = initializeAIToolHandler();
        console.log('[App] AI tool handler initialized');
      }).catch((error) => {
        console.error('[App] Failed to initialize AI tool handler:', error);
      });
    }, 1200);
    
    // Cleanup on unmount
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (cleanup) {
        cleanup();
        console.log('[App] AI tool handler cleaned up');
      }
    };
  }, []);

  // LIVE FOOTHOLD AI CONTEXT: Keep active listener/tunnel evidence visible
  // while their foreground PTY is waiting and the section is hidden.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      import('./lib/live-foothold-context').then(({ initializeLiveFootholdContext }) => {
        if (cancelled) return undefined;
        return initializeLiveFootholdContext();
      }).then((dispose) => {
        if (cancelled) {
          dispose?.();
        } else if (dispose) {
          cleanup = dispose;
          console.log('[App] Live foothold AI context initialized');
        }
      }).catch((error) => {
        console.error('[App] Failed to initialize live foothold AI context:', error);
      });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, []);

  // TOOL OUTPUT CAPTURE: Make listener-based tool output (subdomain tools,
  // long-running listeners) visible to the AI's cross-terminal context.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      import('./lib/tool-output-capture').then(({ initializeToolOutputCapture }) => {
        if (cancelled) return;
        cleanup = initializeToolOutputCapture();
        console.log('[App] Tool output capture initialized');
      }).catch((error) => {
        console.error('[App] Failed to initialize tool output capture:', error);
      });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (cleanup) {
        cleanup();
        console.log('[App] Tool output capture cleaned up');
      }
    };
  }, []);

  const handleSave = () => {
    setShowSavePrompt(false);
    // The save dialog has completed its durable write; continue closing
    // immediately instead of adding an arbitrary renderer delay.
    if (window.electron) {
      window.electron.confirmClose();
    } else {
      window.close();
    }
  };

  const handleDiscard = () => {
    setShowSavePrompt(false);
    // User chose not to save, close immediately
    if (window.electron) {
      window.electron.confirmClose();
    } else {
      window.close();
    }
  };

  const handleCancel = () => {
    setShowSavePrompt(false);
    // User cancelled, stay open
  };

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <UpdateNotification />
          <SelectionCopyButton />
          
          {/* Save prompt dialog on close */}
          <SaveBeforeCloseDialog
            open={showSavePrompt}
            onSave={handleSave}
            onDiscard={handleDiscard}
            onCancel={handleCancel}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
