import React, { useRef, useEffect } from 'react';
import { ArrowRight, Copy, ExternalLink, Download, Settings } from 'lucide-react';

interface Subdomain {
  subdomain: string;
  ip: string;
  status: 'active' | 'inactive' | 'unknown';
  ports?: string;
}

interface SubdomainContextMenuProps {
  contextMenu: { x: number; y: number; subdomain: Subdomain } | null;
  toolContextMenu: { x: number; y: number; toolId: string } | null;
  onClose: () => void;
  onScanWithNmap: (subdomain: Subdomain) => void;
  onCopySubdomain: (subdomain: string) => void;
  onCopyIP: (ip: string) => void;
  onOpenInBrowser: (subdomain: string) => void;
  onOpenToolSettings: () => void;
  onCopyAsCSV: (subdomain: Subdomain) => void;
}

export const SubdomainContextMenu = React.memo(({
  contextMenu,
  toolContextMenu,
  onClose,
  onScanWithNmap,
  onCopySubdomain,
  onCopyIP,
  onOpenInBrowser,
  onOpenToolSettings,
  onCopyAsCSV,
}: SubdomainContextMenuProps) => {
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (contextMenu || toolContextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu, toolContextMenu, onClose]);

  if (!contextMenu && !toolContextMenu) {
    return null;
  }

  // Subdomain Context Menu
  if (contextMenu) {
    return (
      <div
        ref={contextMenuRef}
        className="fixed bg-card border-2 border-border rounded-lg shadow-2xl py-1 z-[9999] min-w-[200px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <button
          type="button"
          onClick={() => onScanWithNmap(contextMenu.subdomain)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <ArrowRight className="w-4 h-4" />
          Scan with Nmap
        </button>
        <button
          type="button"
          onClick={() => onCopySubdomain(contextMenu.subdomain.subdomain)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <Copy className="w-4 h-4" />
          Copy Subdomain
        </button>
        <button
          type="button"
          onClick={() => onCopyIP(contextMenu.subdomain.ip)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <Copy className="w-4 h-4" />
          Copy IP Address
        </button>
        <button
          type="button"
          onClick={() => onOpenInBrowser(contextMenu.subdomain.subdomain)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <ExternalLink className="w-4 h-4" />
          Open in Browser
        </button>
        <div className="border-t border-border my-1"></div>
        <button
          type="button"
          onClick={() => onCopyAsCSV(contextMenu.subdomain)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <Download className="w-4 h-4" />
          Copy as CSV
        </button>
      </div>
    );
  }

  // Tool Context Menu
  if (toolContextMenu) {
    return (
      <div
        ref={contextMenuRef}
        className="fixed bg-card border-2 border-border rounded-lg shadow-2xl py-1 z-[9999] min-w-[180px]"
        style={{ left: toolContextMenu.x, top: toolContextMenu.y }}
      >
        <button
          type="button"
          onClick={onOpenToolSettings}
          className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 text-foreground"
        >
          <Settings className="w-4 h-4" />
          Tool Settings
        </button>
      </div>
    );
  }

  return null;
});

SubdomainContextMenu.displayName = 'SubdomainContextMenu';
