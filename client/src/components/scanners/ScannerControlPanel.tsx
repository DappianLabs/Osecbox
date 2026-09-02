import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Loader2, Settings2 } from 'lucide-react';
import { ScannerType } from '@/lib/scanner-context';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface ScannerOption {
  id: string;
  label: string;
  flag: string;
  description: string;
  requiresValue?: boolean;
  placeholder?: string;
}

// Nikto options
const NIKTO_OPTIONS: ScannerOption[] = [
  { id: 'ssl', label: 'Force SSL', flag: '-ssl', description: 'Force SSL mode on port 443' },
  { id: 'no404', label: 'No 404 Checks', flag: '-no404', description: 'Disable 404 guessing' },
  { id: 'evasion', label: 'IDS Evasion', flag: '-evasion 1', description: 'Enable IDS evasion techniques' },
  { id: 'tuning', label: 'Interesting Files', flag: '-Tuning 2', description: 'Only check for interesting files' },
  { id: 'plugins', label: 'All Plugins', flag: '-Plugins @@ALL', description: 'Run all plugins' },
];

// Nuclei options
const NUCLEI_OPTIONS: ScannerOption[] = [
  { id: 'severity', label: 'Critical/High Only', flag: '-severity critical,high', description: 'Only run critical and high severity templates' },
  { id: 'tags', label: 'CVE Templates', flag: '-tags cve', description: 'Only run CVE templates' },
  { id: 'rate-limit', label: 'Rate Limit', flag: '-rate-limit 150', description: 'Limit requests per second' },
  { id: 'silent', label: 'Silent Mode', flag: '-silent', description: 'Display only results' },
  { id: 'json', label: 'JSON Output', flag: '-json', description: 'Output in JSON format' },
];

// DirBuster/Gobuster options
const DIRBUSTER_OPTIONS: ScannerOption[] = [
  { id: 'threads', label: '50 Threads', flag: '-t 50', description: 'Use 50 concurrent threads' },
  { id: 'extensions', label: 'PHP/HTML/JS', flag: '-x php,html,js,txt', description: 'Check common extensions' },
  { id: 'status', label: 'Show All Status', flag: '-s 200,204,301,302,307,401,403', description: 'Show all interesting status codes' },
  { id: 'no-error', label: 'Hide Errors', flag: '-q', description: 'Don\'t print errors' },
  { id: 'follow', label: 'Follow Redirects', flag: '-r', description: 'Follow redirects' },
];

interface ScannerControlPanelProps {
  scannerType: ScannerType;
  target: string;
  onTargetChange: (target: string) => void;
  onRunScan: (options: string[]) => void;
  onStopScan: () => void;
  isScanning: boolean;
  isCustomCommand?: boolean; // Flag for custom command mode
}

export function ScannerControlPanel({
  scannerType,
  target,
  onTargetChange,
  onRunScan,
  onStopScan,
  isScanning,
  isCustomCommand = false,
}: ScannerControlPanelProps) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [showOptions, setShowOptions] = useState(false);

  // Get options based on scanner type
  const getOptions = (): ScannerOption[] => {
    if (isCustomCommand || scannerType === 'universal') {
      return []; // No predefined options for custom commands
    }
    
    switch (scannerType) {
      case 'nikto':
        return NIKTO_OPTIONS;
      case 'nuclei':
        return NUCLEI_OPTIONS;
      case 'dirbuster':
        return DIRBUSTER_OPTIONS;
      default:
        return [];
    }
  };

  const options = getOptions();

  const toggleOption = (flag: string) => {
    setSelectedOptions(prev =>
      prev.includes(flag)
        ? prev.filter(f => f !== flag)
        : [...prev, flag]
    );
  };

  const handleRunScan = () => {
    if (!target || !target.trim()) return;
    onRunScan(selectedOptions);
  };

  const getScannerInfo = () => {
    if (isCustomCommand || scannerType === 'universal') {
      return {
        name: 'Custom Command',
        icon: '⚙️',
        description: 'Run any pentesting tool or custom command',
        placeholder: 'Enter full command (e.g., sqlmap -u http://target.com --dbs)',
      };
    }
    
    switch (scannerType) {
      case 'nikto':
        return {
          name: '',
          icon: '',
          description: '',
          placeholder: 'https://example.com or http://192.168.1.1',
        };
      case 'nuclei':
        return {
          name: '',
          icon: '',
          description: '',
          placeholder: 'https://example.com or http://192.168.1.1',
        };
      case 'dirbuster':
        return {
          name: '',
          icon: '',
          description: '',
          placeholder: 'https://example.com or http://192.168.1.1',
        };
      default:
        return {
          name: 'Scanner',
          icon: '🔧',
          description: 'Security scanner',
          placeholder: 'Enter target...',
        };
    }
  };

  const info = getScannerInfo();

  return (
    <div className="border-b border-border bg-card">
      {/* Header - NO PADDING to match Nmap */}
      <div className="px-2 py-2">
        {/* Target Input + Run Button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={target}
              onChange={(e) => onTargetChange(e.target.value)}
              placeholder={info.placeholder}
              className={cn(
                "font-mono text-sm border-2",
                isScanning 
                  ? "border-blue-500 bg-blue-500/5" 
                  : "border-gray-400"
              )}
              disabled={isScanning}
            />
            {isScanning && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              </div>
            )}
          </div>
          {isScanning ? (
              <Button
                onClick={onStopScan}
                variant="destructive"
                className="min-w-[120px]"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Scan
              </Button>
            ) : (
              <Button
                onClick={handleRunScan}
                disabled={!target || !target.trim()}
                className="min-w-[120px] bg-green-600 hover:bg-green-700"
                title={!target || !target.trim() ? 'Enter a target first' : 'Start scan'}
              >
                <Play className="w-4 h-4 mr-2" />
                Run Scan
              </Button>
          )}
        </div>
      </div>

      {/* Options Panel */}
      {options.length > 0 && (
        <Collapsible open={showOptions} onOpenChange={setShowOptions}>
          <CollapsibleTrigger asChild>
            <button type="button" className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted/50 transition-colors border-t border-border" aria-expanded={showOptions}>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Settings2 className="w-4 h-4" />
                <span>Scan Options</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {showOptions ? 'Hide' : 'Show'} options
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-2 pt-2 border-t border-border bg-muted/20">
              <div className="grid grid-cols-2 gap-1.5">
                {options.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => toggleOption(option.flag)}
                    disabled={isScanning}
                    className={cn(
                      "p-2 rounded-lg border-2 text-left transition-all",
                      selectedOptions.includes(option.flag)
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-primary/50"
                    )}
                    aria-pressed={selectedOptions.includes(option.flag)}
                  >
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-foreground">
                        {option.label}
                      </span>
                      {selectedOptions.includes(option.flag) && (
                        <Badge variant="default" className="text-[9px] h-3 px-1">
                          ✓
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-0.5 leading-tight">
                      {option.description}
                    </p>
                    <code className="text-[9px] text-primary font-mono">
                      {option.flag}
                    </code>
                  </button>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}


    </div>
  );
}
