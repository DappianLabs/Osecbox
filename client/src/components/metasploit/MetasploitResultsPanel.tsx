import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ModuleCard, MetasploitModule } from './ModuleCard';
import { ModuleConfigDialog } from './ModuleConfigDialog';
import { Package, AlertCircle, Target, CheckCircle } from 'lucide-react';
import { useScanner } from '@/lib/scanner-context';

interface MetasploitResultsPanelProps {
  modules: MetasploitModule[];
  isSearching: boolean;
  onExecuteModule: (module: MetasploitModule, config: Record<string, string>) => void;
}

export function MetasploitResultsPanel({ modules, isSearching, onExecuteModule }: MetasploitResultsPanelProps) {
  const { tabs } = useScanner();
  const [selectedModule, setSelectedModule] = useState<MetasploitModule | null>(null);
  const [moduleOptions, setModuleOptions] = useState<any[]>([]);

  // Get compatible targets from scan results
  const getCompatibleTargets = (module: MetasploitModule) => {
    const compatible: Array<{ ip: string; reason: string; confidence: 'high' | 'medium' }> = [];
    
    tabs.forEach(tab => {
      tab.results.forEach(result => {
        if (!result.ip || result.status !== 'up') return;
        
        let isCompatible = false;
        let reason = '';
        let confidence: 'high' | 'medium' = 'medium';
        
        // Check OS compatibility
        if (result.os) {
          const os = result.os.toLowerCase();
          const modulePath = module.fullPath.toLowerCase();
          
          if (modulePath.includes('windows') && os.includes('windows')) {
            isCompatible = true;
            reason = 'Windows OS match';
            confidence = 'high';
          } else if (modulePath.includes('linux') && os.includes('linux')) {
            isCompatible = true;
            reason = 'Linux OS match';
            confidence = 'high';
          } else if (modulePath.includes('unix') && (os.includes('unix') || os.includes('linux'))) {
            isCompatible = true;
            reason = 'Unix-like OS';
            confidence = 'high';
          }
        }
        
        // Check port/service compatibility
        if (result.ports && result.ports.length > 0) {
          const modulePath = module.fullPath.toLowerCase();
          const openPorts = result.ports.filter(p => p.state === 'open');
          
          openPorts.forEach(port => {
            const service = port.service.toLowerCase();
            
            // SMB exploits
            if ((modulePath.includes('smb') || modulePath.includes('ms17_010')) && 
                (port.port === 445 || port.port === 139)) {
              isCompatible = true;
              reason = `SMB port ${port.port} open`;
              confidence = 'high';
            }
            // RDP exploits
            else if (modulePath.includes('rdp') && port.port === 3389) {
              isCompatible = true;
              reason = 'RDP port 3389 open';
              confidence = 'high';
            }
            // SSH exploits
            else if (modulePath.includes('ssh') && port.port === 22) {
              isCompatible = true;
              reason = 'SSH port 22 open';
              confidence = 'high';
            }
            // HTTP/Web exploits
            else if ((modulePath.includes('http') || modulePath.includes('web')) && 
                     (port.port === 80 || port.port === 443 || port.port === 8080)) {
              isCompatible = true;
              reason = `HTTP port ${port.port} open`;
              confidence = 'medium';
            }
          });
        }
        
        if (isCompatible) {
          compatible.push({ ip: result.ip, reason, confidence });
        }
      });
    });
    
    return compatible;
  };

  const handleModuleClick = async (module: MetasploitModule) => {
    if (!window.electron) {
      console.error('Electron API not available');
      return;
    }

    // Show dialog immediately with loading state
    setSelectedModule(module);
    setModuleOptions([]);

    // Fetch options in background
    try {
      const result = await window.electron.msfModuleInfo(module.fullPath);
      if (result.success && result.options) {
        setModuleOptions(result.options);
      } else {
        console.error('Failed to get module options:', result.error);
        // Fallback to basic options
        setModuleOptions([
          { name: 'RHOSTS', required: true, description: 'Target host(s)', default: '' },
          { name: 'RPORT', required: false, description: 'Target port', default: '' },
        ]);
      }
    } catch (error) {
      console.error('Error fetching module options:', error);
      // Fallback to basic options
      setModuleOptions([
        { name: 'RHOSTS', required: true, description: 'Target host(s)', default: '' },
        { name: 'RPORT', required: false, description: 'Target port', default: '' },
      ]);
    }
  };

  const handleExecute = (config: Record<string, string>) => {
    if (selectedModule) {
      onExecuteModule(selectedModule, config);
    }
  };

  if (isSearching) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Searching modules...</p>
        </div>
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <Package className="w-20 h-20 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Modules Found</h3>
          <p className="text-sm text-muted-foreground">
            Search for exploits, auxiliary modules, or payloads to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full bg-background">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">
              Found {modules.length} module{modules.length !== 1 ? 's' : ''}
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((module, idx) => {
              const compatibleTargets = getCompatibleTargets(module);
              
              return (
                <div key={idx} className="relative">
                  <ModuleCard
                    module={module}
                    onClick={() => handleModuleClick(module)}
                  />
                  
                  {/* Compatibility badge */}
                  {compatibleTargets.length > 0 && (
                    <div className="absolute top-2 right-2 bg-green-500/90 text-white px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 shadow-lg">
                      <CheckCircle className="w-3 h-3" />
                      {compatibleTargets.length} target{compatibleTargets.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      {selectedModule && (
        <ModuleConfigDialog
          module={selectedModule}
          options={moduleOptions}
          onClose={() => setSelectedModule(null)}
          onExecute={handleExecute}
        />
      )}
    </>
  );
}
