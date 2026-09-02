import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  sectionName: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Section-specific error boundary with refresh capability
 * Allows users to reload just the broken section without affecting others
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[${this.props.sectionName}] Error caught:`, error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    console.log(`[${this.props.sectionName}] Resetting section...`);
    
    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
    
    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-background p-8">
          <div className="max-w-md w-full bg-card border border-destructive/50 rounded-lg p-6 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {this.props.sectionName} Error
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Something went wrong in this section. You can refresh it without affecting other sections.
                </p>
                
                {this.state.error && (
                  <div className="mb-4 p-3 bg-muted rounded text-xs font-mono text-muted-foreground overflow-auto max-h-32">
                    {this.state.error.toString()}
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh {this.props.sectionName}
                </button>
                
                <p className="text-xs text-muted-foreground mt-4">
                  If the problem persists, check the console for more details.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
