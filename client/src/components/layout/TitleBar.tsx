import { Minus, Square, X, Sun, Moon } from 'lucide-react';
import { NmapStatus } from '@/components/nmap/NmapStatus';
import { ToolStatusChecker } from '@/components/layout/ToolStatusChecker';
import { WorkingTabsIndicator } from '@/components/layout/WorkingTabsIndicator';
import { PrivilegeBadge } from '@/components/PrivilegeBadge';
import { ConnectionContextBar } from '@/components/layout/ConnectionContextBar';
import { WSL2StatusBadge } from '@/components/platform/WSL2StatusBadge';
// import { LicenseStatusBadge } from '@/components/LicenseStatusBadge';  // HIDDEN: Enable when ready to monetize

interface TitleBarProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

export function TitleBar({ isDarkMode, toggleTheme }: TitleBarProps) {

  const handleMinimize = () => {
    if (window.electron) {
      window.electron.minimize();
    }
  };

  const handleMaximize = () => {
    if (window.electron) {
      window.electron.maximize();
    }
  };

  const handleClose = () => {
    if (window.electron) {
      window.electron.close();
    }
  };

  return (
    <div className="h-8 bg-background border-b border-border flex items-center justify-between px-2 select-none shrink-0 z-50" style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="flex items-center gap-2">
        <img
          src="./osecbox-icon.png"
          alt=""
          width={16}
          height={16}
          draggable={false}
          className="w-4 h-4 rounded-[4px] object-cover shadow-[0_0_10px_rgba(139,92,246,0.35)]"
        />
        <span className="text-[11px] font-semibold text-foreground">OsecBox</span>
        <div className="h-2.5 w-px bg-border" />
        <NmapStatus />
        <div className="h-2.5 w-px bg-border" />
        <ToolStatusChecker />
        <div className="h-2.5 w-px bg-border" />
        <PrivilegeBadge />
        <div className="h-2.5 w-px bg-border" />
        <WSL2StatusBadge size="sm" showLabel={true} />
      </div>
      
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {/* HIDDEN: Uncomment when ready to monetize */}
        {/* <LicenseStatusBadge /> */}
        {/* <div className="h-2.5 w-px bg-border" /> */}
        <ConnectionContextBar />
        <div className="h-2.5 w-px bg-border" />
        <button
          type="button"
          onClick={toggleTheme}
          className="w-9 h-5 flex items-center justify-center hover:bg-accent/80 rounded transition-colors"
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          aria-pressed={!isDarkMode}
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4 text-orange-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-500" />
          )}
        </button>
        <div className="h-2.5 w-px bg-border" />
        <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleMinimize}
          className="w-9 h-5 flex items-center justify-center hover:bg-accent/80 rounded transition-colors"
          title="Minimize"
          aria-label="Minimize window"
        >
          <Minus className="w-3.5 h-3.5 text-foreground" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="w-9 h-5 flex items-center justify-center hover:bg-accent/80 rounded transition-colors"
          title="Maximize"
          aria-label="Maximize window"
        >
          <Square className="w-3 h-3 text-foreground" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-5 flex items-center justify-center hover:bg-red-600 hover:text-white rounded transition-colors"
          title="Close"
          aria-label="Close window"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        </div>
      </div>
    </div>
  );
}
