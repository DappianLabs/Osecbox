/**
 * ViewWithSidebar - Reusable layout wrapper that adds AI sidebar to any view
 * Provides consistent layout across all sections
 */

import React, { Suspense, lazy } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { usePanelLayoutStore } from '@/lib/panel-layout-store';

const AiSidebar = lazy(() =>
  import('@/components/nmap/AiSidebar').then(m => ({ default: m.AiSidebar }))
);

const LoadingFallback = () => (
  <div className="h-full w-full flex items-center justify-center bg-background ui-view-enter" role="status" aria-live="polite">
    <div className="text-center">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" aria-hidden="true"></div>
      <div className="text-sm text-muted-foreground">Loading AI Assistant...</div>
    </div>
  </div>
);

interface ViewWithSidebarProps {
  children: React.ReactNode;
  sectionId: string; // e.g., 'exploit', 'foothold', 'tunneling'
  showSidebar?: boolean;
}

export function ViewWithSidebar({ 
  children, 
  sectionId,
  showSidebar = true 
}: ViewWithSidebarProps) {
  const { getPanelSize, isCollapsed, setCollapsed } = usePanelLayoutStore();
  const layoutId = `${sectionId}-layout`;
  const sidebarPanelId = 'ai-sidebar';
  
  const sidebarCollapsed = isCollapsed(layoutId, sidebarPanelId);

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <ResizablePanelGroup 
      direction="horizontal" 
      className="h-full w-full min-h-0 min-w-0 overflow-hidden"
    >
      {/* Main Content */}
      <ResizablePanel 
        defaultSize={getPanelSize(layoutId, 'main-content', 75)}
        minSize={50}
        maxSize={85}
        className="min-h-0 min-w-0 overflow-hidden flex flex-col"
      >
        {children}
      </ResizablePanel>

      {/* AI Sidebar */}
      <ResizableHandle withHandle />
      <ResizablePanel 
        defaultSize={sidebarCollapsed ? 0 : getPanelSize(layoutId, sidebarPanelId, 25)}
        minSize={15}
        maxSize={50}
        collapsible={true}
        collapsedSize={0}
        onCollapse={() => setCollapsed(layoutId, sidebarPanelId, true)}
        onExpand={() => setCollapsed(layoutId, sidebarPanelId, false)}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <Suspense fallback={<LoadingFallback />}>
          <AiSidebar />
        </Suspense>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
