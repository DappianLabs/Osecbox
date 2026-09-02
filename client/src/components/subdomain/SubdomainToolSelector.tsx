import React from 'react';

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

interface SubdomainToolSelectorProps {
  tools: Tool[];
  selectedTool: string | null;
  onToolSelect: (toolId: string) => void;
  onToolContextMenu: (e: React.MouseEvent, toolId: string) => void;
  isScanning: boolean;
}

export const SubdomainToolSelector = React.memo(({
  tools,
  selectedTool,
  onToolSelect,
  onToolContextMenu,
  isScanning,
}: SubdomainToolSelectorProps) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-foreground uppercase tracking-wider">Tools</span>
        <div className="flex-1 h-px bg-border"></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => {
          const isActive = selectedTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onToolSelect(tool.id)}
              onContextMenu={(e) => onToolContextMenu(e, tool.id)}
              disabled={isScanning}
              className={`px-3 py-1.5 border-2 rounded-md transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 flex items-center text-xs ${
                isActive 
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30' 
                  : 'bg-card border-border hover:bg-blue-600 hover:border-blue-500 hover:text-white hover:shadow-lg hover:shadow-blue-500/30'
              }`}
              title={tool.description}
              aria-pressed={isActive}
            >
              <span className="mr-1.5 flex items-center">{tool.icon}</span>
              <span className="font-bold">{tool.name}</span>
              {isActive && <span className="ml-1.5 text-xs">✓</span>}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
        Tools must be installed (Linux/Kali/WSL2)
      </p>
    </div>
  );
});

SubdomainToolSelector.displayName = 'SubdomainToolSelector';
