import React, { useState, useMemo } from 'react';
import { ScannerNavigation } from './ScannerNavigation';
import { ScannerControlPanel } from './ScannerControlPanel';
import { NmapPanel } from './NmapPanel';
import { ChevronDown } from 'lucide-react';
import { useScanner } from '@/lib/scanner-context';

export function ScannerCarousel() {
  const { tabs, activeTabId, updateTabTarget, runScan, stopScan, setTabs } = useScanner();
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // FIX: Get activeTab after all hooks
  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeScanner = activeTab?.scannerType || 'nmap';

  const handleScannerChange = React.useCallback((scanner: 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'universal') => {
    if (!activeTab) return;
    
    // Each scanner type has its own independent terminal/PTY,
    // so switching while another scanner is running is fine - they run in parallel.
    console.log('[ScannerCarousel] Switching scanner type to:', scanner, 'in tab:', activeTab.id);
    setTabs((prev) => prev.map(t => {
      if (t.id !== activeTab.id) return t;
      // Restore the per-scanner stored results and scanning state for the newly-selected scanner
      const storedResults = t.resultsByScanner?.[scanner] || [];
      const storedScanning = t.scanningByScanner?.[scanner] || false;
      return { 
        ...t, 
        scannerType: scanner, 
        title: scanner.charAt(0).toUpperCase() + scanner.slice(1),
        showAdvanced: true,
        results: storedResults,
        isScanning: storedScanning,
      };
    }));
  }, [activeTab, setTabs]);
  
  // Memoize handlers to prevent re-execution on tab switch
  const handleRunScan = React.useCallback((options: string[]) => {
    if (activeTab) {
      runScan(activeTab.id, activeTab.target, false, options);
    }
  }, [activeTab, runScan]);
  
  const handleStopScan = React.useCallback(() => {
    if (activeTab) {
      stopScan(activeTab.id, activeScanner);
    }
  }, [activeTab, stopScan]);

  // Memoize target change handler to prevent re-renders
  const handleTargetChange = React.useCallback((target: string) => {
    if (activeTab) {
      updateTabTarget(activeTab.id, target);
    }
  }, [activeTab, updateTabTarget]);

  // Memoize panel rendering to prevent unnecessary re-renders
  const activePanel = useMemo(() => {
    if (!activeTab) {
      // Show default nmap panel when no tabs exist
      return <NmapPanel isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(!isCollapsed)} />;
    }
    
    switch (activeScanner) {
      case 'nmap':
        return <NmapPanel isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(!isCollapsed)} />;
      case 'nikto':
        return <ScannerControlPanel
          scannerType="nikto"
          target={activeTab.target}
          onTargetChange={handleTargetChange}
          onRunScan={handleRunScan}
          onStopScan={handleStopScan}
          isScanning={!!activeTab.scanningByScanner?.[activeScanner]}
        />;
      case 'nuclei':
        return <ScannerControlPanel
          scannerType="nuclei"
          target={activeTab.target}
          onTargetChange={handleTargetChange}
          onRunScan={handleRunScan}
          onStopScan={handleStopScan}
          isScanning={!!activeTab.scanningByScanner?.[activeScanner]}
        />;
      case 'dirbuster':
        return <ScannerControlPanel
          scannerType="dirbuster"
          target={activeTab.target}
          onTargetChange={handleTargetChange}
          onRunScan={handleRunScan}
          onStopScan={handleStopScan}
          isScanning={!!activeTab.scanningByScanner?.[activeScanner]}
        />;
      case 'universal':
        return <ScannerControlPanel
          scannerType="universal"
          isCustomCommand
          target={activeTab.target}
          onTargetChange={handleTargetChange}
          onRunScan={handleRunScan}
          onStopScan={handleStopScan}
          isScanning={!!activeTab.scanningByScanner?.[activeScanner]}
        />;
      default:
        return <NmapPanel isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(!isCollapsed)} />;
    }
  }, [activeScanner, isCollapsed, activeTab, handleTargetChange, handleRunScan, handleStopScan]);

  return (
    <div className="flex flex-col z-10 relative bg-background">
      {!isCollapsed && (
        <>
          {/* ALWAYS show navigation - user needs to see scanner options */}
          <div className="relative z-30">
            <ScannerNavigation 
              activeScanner={activeScanner}
              onScannerChange={handleScannerChange}
            />
          </div>
          
          <div className="animate-fade-in relative z-20" key={activeScanner}>
            {activePanel}
          </div>
        </>
      )}
      
      {isCollapsed && (
        <div className="relative py-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="px-2 py-0.5 rounded-full bg-muted border border-border hover:bg-muted/80 text-xs font-medium text-muted-foreground hover:text-foreground transition-all shadow-md flex items-center gap-1"
          >
            <ChevronDown className="w-3 h-3" />
            <span className="text-[10px]">EXPAND</span>
          </button>
        </div>
      )}
    </div>
  );
}
