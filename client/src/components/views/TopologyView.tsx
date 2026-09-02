import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Save, Trash2, Link as LinkIcon, Zap, RefreshCw, Upload, Download } from 'lucide-react';
import { TopologyStore, TopologyNode, TopologyConnection, NodeType, TOPOLOGY_LIMITS } from '@/lib/topology-store';
import { TopologyCanvas } from '@/components/topology/TopologyCanvas';
import { NodeDetailPanel } from '@/components/topology/NodeDetailPanel';
import { useScanner } from '@/lib/scanner-context';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TopologyAutoMapper } from '@/lib/topology-auto-mapper';
import { useFootholdStore } from '@/lib/foothold-store';
import { useTunnelingStore } from '@/lib/tunneling-store';
import { useConnectionStore } from '@/lib/connection-store';

function topologyContentEqual(left: TopologyNode[] | TopologyConnection[], right: TopologyNode[] | TopologyConnection[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function topologyDiagramContentEqual(left: ReturnType<typeof TopologyStore.getActiveDiagram>, right: ReturnType<typeof TopologyStore.getActiveDiagram>): boolean {
  if (!left || !right) return left === right;
  return left.id === right.id
    && left.name === right.name
    && left.mode === right.mode
    && left.sourceTabId === right.sourceTabId
    && topologyContentEqual(left.nodes, right.nodes)
    && topologyContentEqual(left.connections, right.connections);
}

export function TopologyView() {
  const { showToast } = useToast();
  const { tabs, activeTabId, addTab, runScan, stopScan, setActiveTabId } = useScanner();
  const footholdStore = useFootholdStore();
  const tunnelingStore = useTunnelingStore();
  const connectionStore = useConnectionStore();
  
  const [mode, setMode] = useState<'auto' | 'custom'>('custom');
  const [diagram, setDiagram] = useState(() => {
    const existing = TopologyStore.getActiveDiagram();
    if (existing) {
      // Deduplicate on load
      const uniqueNodes = Array.from(
        new Map(existing.nodes.map(n => [n.id, n])).values()
      );
      const uniqueConnections = Array.from(
        new Map(existing.connections.map(c => [c.id, c])).values()
      );
      return {
        ...existing,
        nodes: uniqueNodes,
        connections: uniqueConnections
      };
    }
    return TopologyStore.createDiagram('Network Topology', 'custom');
  });
  
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<TopologyConnection | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const draggedNodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Keep the mounted view synchronized with session restore/imports and edits
  // made by another topology consumer. Content comparison prevents the view's
  // own persistence effect from creating a notification loop.
  useEffect(() => {
    let creatingReplacement = false;
    const syncFromStore = () => {
      let activeDiagram = TopologyStore.getActiveDiagram();
      if (!activeDiagram && !creatingReplacement) {
        creatingReplacement = true;
        activeDiagram = TopologyStore.createDiagram('Network Topology', 'custom');
        creatingReplacement = false;
      }
      if (!activeDiagram) return;

      setMode(activeDiagram.mode);
      setDiagram(current => topologyDiagramContentEqual(current, activeDiagram) ? current : activeDiagram!);
    };

    syncFromStore();
    return TopologyStore.subscribe(syncFromStore);
  }, []);

  // Save diagram whenever it changes
  useEffect(() => {
    if (diagram) {
      // Deduplicate nodes before saving to prevent duplicate key errors
      const uniqueNodes = Array.from(
        new Map(diagram.nodes.map(n => [n.id, n])).values()
      );
      const uniqueConnections = Array.from(
        new Map(diagram.connections.map(c => [c.id, c])).values()
      );

      // If duplicates were found, fix the state
      if (uniqueNodes.length !== diagram.nodes.length || uniqueConnections.length !== diagram.connections.length) {
        console.error('[TopologyView] Duplicates detected in diagram state! Fixing...', {
          nodesBefore: diagram.nodes.length,
          nodesAfter: uniqueNodes.length,
          connectionsBefore: diagram.connections.length,
          connectionsAfter: uniqueConnections.length,
          duplicateNodeIds: diagram.nodes.map(n => n.id).filter((id, i, arr) => arr.indexOf(id) !== i)
        });
        
        // Fix the state immediately
        setDiagram({
          ...diagram,
          nodes: uniqueNodes,
          connections: uniqueConnections
        });
        return;
      }

      TopologyStore.updateDiagram(diagram.id, {
        nodes: uniqueNodes,
        connections: uniqueConnections,
      });
    }
  }, [diagram]);

  const handleAddNode = (type: NodeType = 'server') => {
    const nodeNumber = diagram.nodes.length + 1;
    // Use a more unique ID with random component to prevent duplicates
    const uniqueId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNode: TopologyNode = {
      id: uniqueId,
      type,
      x: 400 + Math.random() * 100 - 50,
      y: 250 + Math.random() * 100 - 50,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${nodeNumber}`,
      ip: `192.168.1.${100 + nodeNumber}`,
      status: 'unknown',
      model: type === 'router' ? 'Generic Router' : type === 'firewall' ? 'Generic Firewall' : 'Generic Server',
      routes: type === 'router' ? '192.168.1.0/24 via 10.0.0.1' : undefined,
    };
    
    TopologyStore.addNode(diagram.id, newNode);
    setDiagram({ ...diagram, nodes: [...diagram.nodes, newNode] });
    setSelectedNode(newNode);
    
    // Auto-switch to custom mode when user adds nodes manually
    if (mode === 'auto') {
      setMode('custom');
    }
  };

  const handleNodeClick = (node: TopologyNode) => {
    if (connectingFrom) {
      // Complete connection
      if (connectingFrom !== node.id) {
        const newConnection: TopologyConnection = {
          id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          from: connectingFrom,
          to: node.id,
        };
        TopologyStore.addConnection(diagram.id, newConnection);
        setDiagram({ ...diagram, connections: [...diagram.connections, newConnection] });
      }
      setConnectingFrom(null);
    } else {
      setSelectedNode(node);
      setSelectedConnection(null);
    }
  };

  const handleConnectionClick = (connection: TopologyConnection) => {
    setSelectedConnection(connection);
    setSelectedNode(null);
  };

  const handleNodeDrag = (nodeId: string, x: number, y: number, isDragging: boolean) => {
    // Only update React state when drag is complete
    if (!isDragging) {
      const updatedNodes = diagram.nodes.map(n =>
        n.id === nodeId ? { ...n, x, y } : n
      );
      setDiagram({ ...diagram, nodes: updatedNodes });
      TopologyStore.updateNode(diagram.id, nodeId, { x, y });
      
      if (selectedNode?.id === nodeId) {
        setSelectedNode({ ...selectedNode, x, y });
      }
    }
  };

  const handleCanvasClick = (x: number, y: number) => {
    if (connectingFrom) {
      setConnectingFrom(null);
    } else {
      setSelectedNode(null);
      setSelectedConnection(null);
    }
  };

  const handleUpdateNode = (updates: Partial<TopologyNode>) => {
    if (!selectedNode) return;
    
    const updatedNode = { ...selectedNode, ...updates };
    const updatedNodes = diagram.nodes.map(n =>
      n.id === selectedNode.id ? updatedNode : n
    );
    
    setDiagram({ ...diagram, nodes: updatedNodes });
    setSelectedNode(updatedNode);
    TopologyStore.updateNode(diagram.id, selectedNode.id, updates);
  };

  const handleDeleteNode = () => {
    if (!selectedNode) return;
    
    TopologyStore.deleteNode(diagram.id, selectedNode.id);
    setDiagram({
      ...diagram,
      nodes: diagram.nodes.filter(n => n.id !== selectedNode.id),
      connections: diagram.connections.filter(c => c.from !== selectedNode.id && c.to !== selectedNode.id),
    });
    setSelectedNode(null);
  };

  const handleDeleteConnection = () => {
    if (!selectedConnection) return;
    
    TopologyStore.deleteConnection(diagram.id, selectedConnection.id);
    setDiagram({
      ...diagram,
      connections: diagram.connections.filter(c => c.id !== selectedConnection.id),
    });
    setSelectedConnection(null);
  };

  const handleStartConnection = () => {
    if (selectedNode) {
      setConnectingFrom(selectedNode.id);
      setSelectedNode(null);
    }
  };

  const handleAutoGenerate = () => {
    try {
      // Get current tab's scan results
      const activeTab = tabs.find(t => t.id === activeTabId);
      const scanResults = activeTab?.results || [];

      // Get auto-generated topology from all active infrastructure
      const { nodes: autoNodes, connections: autoConnections } = 
        TopologyAutoMapper.getFullTopologyWithScans(activeTabId, scanResults);
      
      console.log('[TopologyView] Auto-generated:', {
        nodes: autoNodes.length,
        connections: autoConnections.length,
        listeners: footholdStore.tabs.find((t: any) => t.id === footholdStore.activeTabId)?.listeners.length || 0,
        tunnels: tunnelingStore.tabs.find((t: any) => t.id === tunnelingStore.activeTabId)?.sessions.length || 0,
        scans: scanResults.length,
      });

      // Convert auto-mapper nodes to topology nodes
      const topologyNodes: TopologyNode[] = autoNodes.map(node => ({
        id: node.id,
        type: node.type === 'attacker' ? 'desktop' :
              node.type === 'listener' ? 'server' :
              node.type === 'tunnel' ? 'router' :
              node.type === 'pivot' ? 'server' : 'server',
        x: node.position?.x ?? 500,
        y: node.position?.y ?? 300,
        name: node.metadata?.customName || node.label,
        ip: node.ip,
        status: node.status === 'active' ? 'up' : node.status === 'inactive' ? 'down' : 'unknown',
        model: node.metadata?.tool || 'Unknown',
      }));

      // Deduplicate nodes by ID (critical for React keys)
      const uniqueNodes = Array.from(
        new Map(topologyNodes.map(node => [node.id, node])).values()
      );

      // Log if duplicates were found
      if (topologyNodes.length !== uniqueNodes.length) {
        console.error('[TopologyView] DUPLICATE NODES DETECTED!', {
          original: topologyNodes.length,
          unique: uniqueNodes.length,
          duplicates: topologyNodes.length - uniqueNodes.length,
          allIds: topologyNodes.map(n => n.id),
          duplicateIds: topologyNodes.map(n => n.id).filter((id, i, arr) => arr.indexOf(id) !== i)
        });
      }

      // Convert auto-mapper connections to topology connections
      const topologyConnections: TopologyConnection[] = autoConnections.map(conn => ({
        id: conn.id,
        from: conn.from,
        to: conn.to,
        type: conn.type,
        notes: [conn.label, conn.bidirectional ? 'bidirectional' : undefined].filter(Boolean).join(' · ') || undefined,
        latency: undefined,
        protocol: undefined,
      }));

      // Deduplicate connections by ID
      const uniqueConnections = Array.from(
        new Map(topologyConnections.map(conn => [conn.id, conn])).values()
      );

      // Replace the diagram atomically. The store validates endpoints and
      // normalizes duplicate/malformed entries before notifying subscribers.
      const updatedDiagram = TopologyStore.updateDiagram(diagram.id, {
        nodes: uniqueNodes,
        connections: uniqueConnections,
      });
      if (!updatedDiagram) throw new Error('The topology diagram is no longer available');

      setDiagram(updatedDiagram);

      showToast(
        `Generated ${uniqueNodes.length} nodes and ${uniqueConnections.length} connections`,
        'success'
      );
    } catch (error: any) {
      console.error('[TopologyView] Auto-generate error:', error);
      showToast(`Failed to auto-generate topology: ${error.message}`, 'error');
    }
  };

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    diagram.nodes.forEach(node => TopologyStore.deleteNode(diagram.id, node.id));
    setDiagram({ ...diagram, nodes: [], connections: [] });
    setSelectedNode(null);
    setSelectedConnection(null);
    setShowClearConfirm(false);
    showToast('Topology cleared', 'success');
  };

  const handleSave = () => {
    const json = TopologyStore.exportDiagram(diagram.id);
    if (!json) {
      showToast('Nothing to save yet', 'warning');
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topology-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 250);
    showToast('Topology JSON exported', 'success');
  };

  const handleExportPNG = () => {
    const svgElement = document.querySelector('.topology-canvas-svg') as SVGSVGElement | null;
    if (!svgElement) {
      showToast('Topology canvas is not ready', 'warning');
      return;
    }
    
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const svgUrl = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));
    
    img.onload = () => {
      URL.revokeObjectURL(svgUrl);
      canvas.width = 1200;
      canvas.height = 800;
      ctx?.fillRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `topology-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 250);
          showToast('Topology PNG exported', 'success');
        }
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      showToast('Could not render topology PNG', 'error');
    };
    img.src = svgUrl;
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > TOPOLOGY_LIMITS.maxJsonChars) {
      showToast(`Topology file is larger than ${Math.floor(TOPOLOGY_LIMITS.maxJsonChars / (1024 * 1024))} MB`, 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imported = TopologyStore.importDiagram(String(reader.result || ''));
      if (!imported) {
        showToast('Invalid topology JSON', 'error');
        return;
      }
      setDiagram(imported);
      setMode(imported.mode);
      setSelectedNode(null);
      setSelectedConnection(null);
      setConnectingFrom(null);
      showToast('Topology imported', 'success');
    };
    reader.onerror = () => showToast('Could not read topology file', 'error');
    reader.readAsText(file);
  };

  const generateFromScan = () => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    const scanResults = Array.isArray(activeTab?.results) ? activeTab.results : [];
    if (scanResults.length === 0) {
      showToast('No scan data available. Please run a scan first.', 'warning');
      return;
    }

    // Use the live ScannerContext as the single scan source of truth. The
    // auto-mapper validates malformed results and keeps all generated edges
    // within the same node namespace.
    setMode('auto');
    handleAutoGenerate();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Network Topology</h2>
            <p className="text-sm text-muted-foreground">
              {mode === 'auto' ? 'Auto-generate from scan results' : 'Custom network diagram'}
            </p>
          </div>
          
          {/* Mode Toggle */}
          <div className="flex gap-1 bg-muted p-1 rounded-md">
            <Button
              variant={mode === 'auto' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('auto')}
              className="text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
            >
              Auto-Generate
            </Button>
            <Button
              variant={mode === 'custom' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('custom')}
              className="text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
            >
              Custom Draw
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
            {mode === 'auto' ? (
              <>
                <Button
                  onClick={generateFromScan}
                  size="sm"
                  variant="default"
                  disabled={!activeTabId}
                  className="shadow-[0_4px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all disabled:shadow-none disabled:translate-y-0"
                >
                  <Zap className="w-4 h-4 mr-1" />
                  Generate from Active Scan
                </Button>
              
                <Button
                  onClick={() => {
                    // Clear all nodes and connections
                    diagram.nodes.forEach(node => TopologyStore.deleteNode(diagram.id, node.id));
                    diagram.connections.forEach(conn => TopologyStore.deleteConnection(diagram.id, conn.id));
                    setDiagram({ ...diagram, nodes: [], connections: [] });
                    setSelectedNode(null);
                    setSelectedConnection(null);
                  }}
                  size="sm"
                  variant="outline"
                  className="border-red-500 text-red-500 hover:bg-red-500/10 shadow-[0_4px_0_0_rgba(220,38,38,0.3)] hover:shadow-[0_2px_0_0_rgba(220,38,38,0.3)] active:shadow-[0_1px_0_0_rgba(220,38,38,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              
              <div className="text-xs text-muted-foreground ml-2">
                {tabs.find(t => t.id === activeTabId)?.results.length || 0} hosts in active scan
              </div>
            </>
          ) : (
            <>
          <Button
            onClick={handleAutoGenerate}
            size="sm"
            variant="default"
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all bg-primary"
            title="Auto-generate topology from active listeners, tunnels, and connections"
          >
            <Zap className="w-4 h-4 mr-1" />
            Auto-Generate
          </Button>

          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAddNode(e.target.value as NodeType);
                e.target.value = '';
              }
            }}
            className="px-3 py-1.5 text-sm bg-background border border-border rounded-md"
          >
            <option value="">Add Node...</option>
            <option value="server">🖥️ Server</option>
            <option value="desktop">💻 Desktop</option>
            <option value="firewall">🛡️ Firewall</option>
            <option value="router">📡 Router</option>
            <option value="switch">🔌 Switch</option>
            <option value="unknown">❓ Unknown</option>
          </select>

          <Button
            onClick={() => handleAddNode()}
            size="sm"
            variant="outline"
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
          >
            <Plus className="w-4 h-4 mr-1" />
            Custom Node
          </Button>

          <Button
            onClick={handleStartConnection}
            size="sm"
            variant={connectingFrom ? 'default' : 'outline'}
            disabled={!selectedNode}
            title={connectingFrom ? 'Click another node to connect' : 'Select a node first, then click this to start connecting'}
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all disabled:shadow-none disabled:translate-y-0"
          >
            <LinkIcon className="w-4 h-4 mr-1" />
            {connectingFrom ? 'Click target node...' : 'Add Connection'}
          </Button>

          {selectedConnection && (
            <Button
              onClick={handleDeleteConnection}
              size="sm"
              variant="outline"
              className="text-red-500 hover:text-red-600 shadow-[0_3px_0_0_rgba(220,38,38,0.3)] hover:shadow-[0_1px_0_0_rgba(220,38,38,0.3)] active:shadow-[0_0px_0_0_rgba(220,38,38,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete Connection
            </Button>
          )}

          <div className="flex-1" />

          <Button
            onClick={handleClear}
            variant="outline"
            size="sm"
            disabled={diagram.nodes.length === 0}
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all disabled:shadow-none disabled:translate-y-0"
          >
            Clear
          </Button>

          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImport}
          />

          <Button
            onClick={() => importInputRef.current?.click()}
            variant="outline"
            size="sm"
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
          >
            <Upload className="w-4 h-4 mr-1" />
            Import
          </Button>

          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            disabled={diagram.nodes.length === 0}
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all disabled:shadow-none disabled:translate-y-0"
          >
            <Save className="w-4 h-4 mr-1" />
            Export JSON
          </Button>

          <Button
            onClick={handleExportPNG}
            variant="outline"
            size="sm"
            disabled={diagram.nodes.length === 0}
            className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all disabled:shadow-none disabled:translate-y-0"
          >
            📸 Export PNG
          </Button>
            </>
          )}
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {diagram.nodes.length === 0 ? (
            <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
              <div className="text-center space-y-4">
                <div className="w-24 h-24 bg-card rounded-full flex items-center justify-center mx-auto border border-border">
                  <span className="text-4xl">🗺️</span>
                </div>
                <h3 className="text-xl font-semibold text-foreground">Network Topology Map</h3>
                <p className="max-w-md mx-auto text-sm">
                  Start by adding nodes using the dropdown above, then connect them by selecting a node and clicking "Add Connection".
                </p>
                <Button 
                  onClick={() => handleAddNode('server')} 
                  className="mt-4 shadow-[0_5px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[3px] active:translate-y-[4px] transition-all"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Node
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full" style={{ minHeight: '500px' }}>
              <TopologyCanvas
                nodes={diagram.nodes}
                connections={diagram.connections}
                selectedNode={selectedNode}
                selectedConnection={selectedConnection}
                onNodeClick={handleNodeClick}
                onConnectionClick={handleConnectionClick}
                onNodeDrag={handleNodeDrag}
                onCanvasClick={handleCanvasClick}
                mode="edit"
                connectingFrom={connectingFrom}
              />
            </div>
          )}
        </div>

        {/* Side Panel */}
        {selectedNode && (
          <div className="w-80 border-l border-border bg-card overflow-y-auto">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Node Details</h3>
              <div className="flex gap-1">
                <Button
                  onClick={handleDeleteNode}
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => setSelectedNode(null)}
                  variant="ghost"
                  size="sm"
                >
                  ✕
                </Button>
              </div>
            </div>
            <NodeDetailPanel
              node={selectedNode}
              onUpdate={handleUpdateNode}
              readOnly={false}
            />
          </div>
        )}
      </div>

      {/* Clear Confirmation Dialog */}
      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear all nodes and connections?"
        description="This will permanently delete all nodes and connections from the topology diagram. This action cannot be undone."
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
        confirmText="Clear"
        cancelText="Cancel"
        variant="destructive"
      />
    </div>
  );
}
