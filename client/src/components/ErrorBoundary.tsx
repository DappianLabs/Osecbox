import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: any;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Log the error immediately when caught
    console.error('[ErrorBoundary] getDerivedStateFromError:', error);
    console.error('[ErrorBoundary] Error name:', error.name);
    console.error('[ErrorBoundary] Error message:', error.message);
    console.error('[ErrorBoundary] Error stack:', error.stack);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // AGGRESSIVE LOGGING - Show in UI and console
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      name: error.name,
      timestamp: new Date().toISOString(),
    };
    
    console.error('═══════════════════════════════════════════════════════');
    console.error('🔴 ERROR BOUNDARY CAUGHT ERROR');
    console.error('═══════════════════════════════════════════════════════');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Component Stack:', errorInfo.componentStack);
    console.error('Timestamp:', errorDetails.timestamp);
    console.error('═══════════════════════════════════════════════════════');
    
    // Store error details for display
    this.setState({ error, errorInfo: errorDetails });
    this.props.onError?.(error, errorInfo);
    
    // Also log to electron main process if available
    if (typeof window !== 'undefined' && (window as any).electron) {
      try {
        console.error('[ErrorBoundary] Sending error to main process');
        // Log to main process console
      } catch (e) {
        console.error('[ErrorBoundary] Failed to send to main:', e);
      }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="h-full w-full flex items-center justify-center bg-background p-8 overflow-auto">
          <div className="max-w-2xl w-full text-center space-y-4">
            <div className="text-destructive text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
            
            {/* Error Message */}
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-left">
              <div className="font-mono text-sm text-destructive font-bold mb-2">
                {this.state.error?.name || 'Error'}
              </div>
              <div className="font-mono text-xs text-foreground">
                {this.state.error?.message || 'An unexpected error occurred'}
              </div>
            </div>
            
            {/* Error Stack */}
            {this.state.error?.stack && (
              <details className="bg-muted/50 border border-border rounded-lg p-4 text-left">
                <summary className="cursor-pointer font-semibold text-sm mb-2">
                  📋 Error Stack Trace (click to expand)
                </summary>
                <pre className="font-mono text-xs text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            
            {/* Component Stack */}
            {this.state.errorInfo?.componentStack && (
              <details className="bg-muted/50 border border-border rounded-lg p-4 text-left">
                <summary className="cursor-pointer font-semibold text-sm mb-2">
                  🧩 Component Stack (click to expand)
                </summary>
                <pre className="font-mono text-xs text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            
            {/* Timestamp */}
            {this.state.errorInfo?.timestamp && (
              <div className="text-xs text-muted-foreground">
                Occurred at: {this.state.errorInfo.timestamp}
              </div>
            )}
            
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
