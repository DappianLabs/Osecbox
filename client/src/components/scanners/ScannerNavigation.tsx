import React, { useState } from 'react';
import { Target, Globe, Zap, FolderSearch, Settings, Loader2, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScanner } from '@/lib/scanner-context';
import { useNavigationStore } from '@/lib/navigation-store';
import { ScanSaveTrigger } from './ScanSaveTrigger';

export type ScannerType = 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'universal';

interface ScannerNavigationProps {
  activeScanner: ScannerType;
  onScannerChange: (scanner: ScannerType) => void;
}

const SCANNERS = [
  { id: 'nmap' as const, label: 'Nmap', icon: Target, description: 'Network Scanning', settingsId: 'settings-nmap' },
  { id: 'nikto' as const, label: 'Nikto', icon: Globe, description: 'Web Vulnerabilities', settingsId: 'settings-nikto' },
  { id: 'nuclei' as const, label: 'Nuclei', icon: Zap, description: '3000+ CVE Templates', settingsId: 'settings-nuclei' },
  { id: 'dirbuster' as const, label: 'DirBuster', icon: FolderSearch, description: 'Directory Brute-Force', settingsId: 'settings-dirbuster' },
  { id: 'universal' as const, label: 'Custom', icon: Terminal, description: 'Run any supported tool', settingsId: 'settings-universal' },
];

export function ScannerNavigation({ activeScanner, onScannerChange }: ScannerNavigationProps) {
  const { tabs, activeTabId } = useScanner();
  const navigateToSettings = useNavigationStore((state) => state.navigateToSettings);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; scanner: typeof SCANNERS[0] } | null>(null);
  
  // Get active tab to check scanning state
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isScanning = activeTab?.isScanning || false;
  
  const handleScannerClick = (scannerId: ScannerType) => {
    console.log('[ScannerNavigation] Scanner clicked:', scannerId);
    
    // FIX: Switch scanner type on current tab, don't create new tabs
    onScannerChange(scannerId);
  };

  const handleContextMenu = (e: React.MouseEvent, scanner: typeof SCANNERS[0]) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, scanner });
  };

  const handleOpenSettings = () => {
    if (contextMenu) {
      navigateToSettings(contextMenu.scanner.settingsId);
    }
    setContextMenu(null);
  };

  // Close context menu when clicking outside
  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);
  
  return (
    <>
      <div className="flex items-center gap-1 px-1 py-0.5 border-b border-border/60 relative z-20 bg-background">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Scanner tools">
          {/* Scanner Buttons */}
          {SCANNERS.map((scanner) => {
            const Icon = scanner.icon;
            const isActive = scanner.id === activeScanner;
            
            return (
              <button
                type="button"
                key={scanner.id}
                onClick={() => handleScannerClick(scanner.id)}
                onContextMenu={(e) => handleContextMenu(e, scanner)}
                className={cn(
                  "win7-button px-3 py-1.5 h-9 flex items-center gap-2 border-2 transition-all flex-shrink-0 relative",
                  "cursor-pointer select-none", // Ensure proper cursor
                  isActive
                    ? "active ring-2 ring-primary/30 border-primary"
                    : "border-border hover:border-primary/60",
                  isActive && isScanning && "border-primary/80"
                )}
                role="tab"
                aria-selected={isActive}
                aria-label={`${scanner.label}: ${scanner.description}`}
                style={{ 
                  cursor: 'pointer',
                  userSelect: 'none',
                  pointerEvents: 'auto' // Force pointer events
                }}
              >
                {isActive && isScanning && (
                  <div className="absolute inset-0 bg-blue-500/10 rounded pointer-events-none" />
                )}
                <Icon className={cn(
                  "w-4 h-4 relative z-10",
                  isActive ? "text-primary" : "text-foreground"
                )} />
                <span className={cn(
                  "text-sm font-bold leading-none relative z-10",
                  isActive ? "text-primary" : "text-foreground"
                )}>
                  {scanner.label}
                </span>
                {isActive && isScanning && (
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500 relative z-10" />
                )}
              </button>
            );
          })}
        </div>

        <div className="ml-auto shrink-0 pl-2">
          <ScanSaveTrigger className="h-8 px-2.5" />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-card border border-border rounded-lg shadow-2xl py-1 z-50 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={handleOpenSettings}
            className="ui-button w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            {contextMenu.scanner.label} Settings
          </button>
        </div>
      )}
    </>
  );
}
