import React, { useState, useEffect } from 'react';
import { X, Play, Info, Lightbulb, AlertCircle, Network, Clipboard, ChevronDown, ChevronUp, Target, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MetasploitModule } from './ModuleCard';
import { useScanner } from '@/lib/scanner-context';

interface ModuleOption {
  name: string;
  required: boolean;
  default?: string;
  description?: string;
  type?: string;
  currentValue?: string;
}

interface ModuleConfigDialogProps {
  module: MetasploitModule;
  options: ModuleOption[];
  onClose: () => void;
  onExecute: (config: Record<string, string>) => void;
}

export function ModuleConfigDialog({ module, options, onClose, onExecute }: ModuleConfigDialogProps) {
  const { tabs } = useScanner();
  const { recentTargets, addRecentTarget, exploitContext, setExploitContext } = {
    recentTargets: [] as any[],
    addRecentTarget: (_target: any) => {},
    exploitContext: { modulePath: '', config: {} as Record<string, string>, targetList: [] as string[], currentTargetIndex: 0 },
    setExploitContext: (_ctx: any) => {}
  };
  
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    
    // First, try to use exploit context if same module
    if (exploitContext.modulePath === module.fullPath && Object.keys(exploitContext.config).length > 0) {
      return { ...exploitContext.config };
    }
    
    // Otherwise, use option defaults
    options.forEach(opt => {
      if (opt.currentValue) {
        initial[opt.name] = opt.currentValue;
      } else if (opt.default) {
        initial[opt.name] = opt.default;
      }
    });
    return initial;
  });
  
  const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
  const [showRecentTargets, setShowRecentTargets] = useState(false);
  const [localIP, setLocalIP] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Auto-detect local IP for LHOST
  useEffect(() => {
    const electron = window.electron;
    if (!electron) return;

    const detectLocalIP = async () => {
      // executeCommand is shell-free, so query platform-specific tools in
      // sequence instead of passing a shell fallback chain.
      const isWindows = electron.platform === 'win32';
      const commands = isWindows
        ? ['ipconfig']
        : ['hostname -I', 'ip addr show', 'ifconfig'];
      let output = '';
      for (const command of commands) {
        const result = await electron.executeCommand(command);
        output += `${result?.output || ''}\n`;
        if (result?.success && result.output) break;
      }
      if (output) {
        // Extract first IP address
        const ipMatch = output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        if (ipMatch) {
          setLocalIP(ipMatch[0]);
          // Auto-fill LHOST if empty
          if (!config.LHOST && options.some(opt => opt.name === 'LHOST')) {
            setConfig(prev => ({ ...prev, LHOST: ipMatch[0] }));
          }
        }
      }
    };

    detectLocalIP().catch(err => console.error('Failed to detect local IP:', err));
  }, []);

  // Get target suggestions from nmap results
  const getTargetSuggestions = () => {
    const suggestions: Array<{ ip: string; label: string; confidence: 'high' | 'medium' | 'low' }> = [];
    
    tabs.forEach(tab => {
      tab.results.forEach(result => {
        if (result.ip) {
          let label = result.ip;
          let confidence: 'high' | 'medium' | 'low' = 'medium';
          
          // Add OS info if available
          if (result.os) {
            label += ` (${result.os})`;
            
            // Check if OS matches module type
            if (module.fullPath.includes('windows') && result.os.toLowerCase().includes('windows')) {
              confidence = 'high';
            } else if (module.fullPath.includes('linux') && result.os.toLowerCase().includes('linux')) {
              confidence = 'high';
            }
          }
          
          // Add port info if relevant
          const relevantPorts = result.ports?.filter(p => p.state === 'open');
          if (relevantPorts && relevantPorts.length > 0) {
            const portList = relevantPorts.slice(0, 3).map(p => p.port).join(', ');
            label += ` - Ports: ${portList}`;
          }
          
          suggestions.push({ ip: result.ip, label, confidence });
        }
      });
    });
    
    // Sort by confidence
    return suggestions.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    });
  };

  // Validate field value
  const validateField = (name: string, value: string): string | null => {
    if (!value.trim()) {
      return null; // Empty is handled by required check
    }
    
    // IP address validation for RHOSTS, RHOST, LHOST
    if (name === 'RHOSTS' || name === 'RHOST' || name === 'LHOST') {
      // Allow single IP, CIDR, or range
      const ipPattern = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;
      const rangePattern = /^(?:\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
      
      if (!ipPattern.test(value) && !rangePattern.test(value)) {
        return 'Invalid IP address format';
      }
    }
    
    // Port validation
    if (name.includes('PORT')) {
      const port = parseInt(value);
      if (isNaN(port) || port < 1 || port > 65535) {
        return 'Port must be between 1 and 65535';
      }
    }
    
    return null;
  };

  const handleFieldChange = (name: string, value: string) => {
    setConfig({ ...config, [name]: value });
    
    // Clear validation error when user types
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
    
    // Validate on change
    const error = validateField(name, value);
    if (error) {
      setValidationErrors(prev => ({ ...prev, [name]: error }));
    }
  };

  const handleExecute = () => {
    // Final validation
    const errors: Record<string, string> = {};
    
    options.forEach(opt => {
      if (opt.required && !config[opt.name]?.trim()) {
        errors[opt.name] = 'This field is required';
      } else if (config[opt.name]) {
        const error = validateField(opt.name, config[opt.name]);
        if (error) {
          errors[opt.name] = error;
        }
      }
    });
    
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    // Save to exploit context for quick switching
    setExploitContext({
      modulePath: module.fullPath,
      config: config,
      targetList: config.RHOSTS ? [config.RHOSTS] : [],
      currentTargetIndex: 0,
    });
    
    // Add to recent targets
    if (config.RHOSTS) {
      addRecentTarget({
        ip: config.RHOSTS,
        lastUsed: Date.now(),
        successCount: 0,
        failCount: 0,
      });
    }
    
    onExecute(config);
    onClose();
  };

  // Paste from clipboard
  const handlePasteFromClipboard = async (fieldName: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        handleFieldChange(fieldName, text.trim());
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  const canExecute = options
    .filter(opt => opt.required)
    .every(opt => config[opt.name]?.trim()) && 
    Object.keys(validationErrors).length === 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter to execute
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canExecute) {
        e.preventDefault();
        handleExecute();
      }
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      // Ctrl+V to paste in RHOSTS field
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        const activeElement = document.activeElement;
        if (activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          handlePasteFromClipboard('RHOSTS');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canExecute, config]);

  const targetSuggestions = getTargetSuggestions();

  return (
    <div
      className="ui-dialog-overlay fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="module-config-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-popover-enter bg-card rounded-lg border border-border shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex-1 min-w-0">
            <h3 id="module-config-title" className="text-lg font-bold text-foreground truncate">{module.name}</h3>
            <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{module.fullPath}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {options.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
              <p>Loading module options...</p>
            </div>
          ) : (
            options.map((option) => {
              const isTargetField = option.name === 'RHOSTS' || option.name === 'RHOST';
              const isLHOSTField = option.name === 'LHOST';
              const hasError = validationErrors[option.name];
              
              return (
                <div key={option.name} className="relative">
                  <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-2">
                    {option.name}
                    {option.required && <span className="text-red-500 text-xs">*</span>}
                    {isTargetField && targetSuggestions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowSuggestions(showSuggestions === option.name ? null : option.name)}
                        className="ml-auto text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                      >
                        <Lightbulb className="w-3 h-3" />
                        {targetSuggestions.length} from scan
                      </button>
                    )}
                    {isTargetField && recentTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRecentTargets(!showRecentTargets)}
                        className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
                      >
                        <Target className="w-3 h-3" />
                        {recentTargets.length} recent
                      </button>
                    )}
                    {isLHOSTField && localIP && (
                      <button
                        type="button"
                        onClick={() => handleFieldChange(option.name, localIP)}
                        className="ml-auto text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                      >
                        <Network className="w-3 h-3" />
                        Use {localIP}
                      </button>
                    )}
                  </label>
                  {option.description && (
                    <p className="text-xs text-muted-foreground mb-2">{option.description}</p>
                  )}
                  
                  {/* Input with paste button */}
                  <div className="relative">
                    <input
                      type="text"
                      value={config[option.name] || ''}
                      onChange={(e) => handleFieldChange(option.name, e.target.value)}
                      placeholder={option.default || `Enter ${option.name}`}
                      className={`w-full px-3 py-2.5 pr-10 bg-background border rounded text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 focus:outline-none transition-all font-mono ${
                        hasError ? 'border-red-500' : 'border-input'
                      }`}
                    />
                    {isTargetField && (
                      <button
                        type="button"
                        onClick={() => handlePasteFromClipboard(option.name)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        title="Paste from clipboard (Ctrl+V)"
                      >
                        <Clipboard className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  {hasError && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-red-500">
                      <AlertCircle className="w-3 h-3" />
                      {hasError}
                    </div>
                  )}
                  
                  {/* Scan results suggestions dropdown */}
                  {showSuggestions === option.name && isTargetField && (
                    <div className="mt-2 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {targetSuggestions.map((suggestion, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => {
                            handleFieldChange(option.name, suggestion.ip);
                            setShowSuggestions(null);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-accent transition-colors flex items-center justify-between group"
                        >
                          <span className="text-sm text-foreground font-mono">{suggestion.label}</span>
                          {suggestion.confidence === 'high' && (
                            <span className="text-xs text-green-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              Recommended
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Recent targets dropdown */}
                  {showRecentTargets && isTargetField && (
                    <div className="mt-2 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      <div className="px-3 py-2 border-b border-border bg-muted/30">
                        <p className="text-xs font-medium text-muted-foreground">Recent Targets</p>
                      </div>
                      {recentTargets.slice(0, 10).map((target, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => {
                            handleFieldChange(option.name, target.ip);
                            setShowRecentTargets(false);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-accent transition-colors flex items-center justify-between group"
                        >
                          <div className="flex-1">
                            <span className="text-sm text-foreground font-mono block">{target.ip}</span>
                            {target.os && (
                              <span className="text-xs text-muted-foreground">{target.os}</span>
                            )}
                          </div>
                          {target.successCount > 0 && (
                            <span className="text-xs text-green-500">
                              ✓ {target.successCount}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          
          {/* Info box */}
          {options.length > 0 && (
            <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-500">
                <p className="font-medium mb-1">Execution will run in terminal</p>
                <p className="text-blue-500/80">
                  You can monitor the output and interact with sessions in the terminal below.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-xs">Ctrl+Enter</kbd>
                Execute
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-xs">Esc</kbd>
                Cancel
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-xs">Ctrl+V</kbd>
                Paste target
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={!canExecute}
              className="bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4 mr-2" />
              Execute
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
