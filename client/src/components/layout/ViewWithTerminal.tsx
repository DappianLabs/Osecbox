import React, { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { GlobalTerminal } from './GlobalTerminal';

interface ViewWithTerminalProps {
  children: ReactNode;
  hasAISidebar?: boolean;
}

export function ViewWithTerminal({ children, hasAISidebar = false }: ViewWithTerminalProps) {
  if (!hasAISidebar) {
    // Simple case: no AI sidebar, just add terminal at bottom
    return (
      <ResizablePanelGroup 
        direction="vertical" 
        className="flex-1"
        style={{
          // Use GPU acceleration for smooth resizing
          willChange: 'transform',
          transform: 'translateZ(0)',
        }}
      >
        <ResizablePanel defaultSize={70} minSize={30}>
          {children}
        </ResizablePanel>
        <ResizableHandle 
          withHandle 
          style={{
            // Optimize handle rendering
            willChange: 'transform',
          }}
        />
        <ResizablePanel 
          defaultSize={30} 
          minSize={10} 
          maxSize={70}
          style={{
            // Use GPU acceleration for terminal panel
            willChange: 'transform',
            transform: 'translateZ(0)',
          }}
        >
          <GlobalTerminal />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  // Complex case: View has AI sidebar, we need to inject terminal into the left panel only
  // The children is expected to be a ResizablePanelGroup with horizontal direction
  // We'll wrap it and intercept the first panel to add terminal
  return <>{children}</>;
}
