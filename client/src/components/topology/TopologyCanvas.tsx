import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { TopologyNode, TopologyConnection, NodeType } from '@/lib/topology-store';

interface TopologyCanvasProps {
  nodes: TopologyNode[];
  connections: TopologyConnection[];
  selectedNode: TopologyNode | null;
  selectedConnection: TopologyConnection | null;
  onNodeClick: (node: TopologyNode) => void;
  onConnectionClick: (connection: TopologyConnection) => void;
  onNodeDrag: (nodeId: string, x: number, y: number, isDragging: boolean) => void;
  onCanvasClick: (x: number, y: number) => void;
  mode: 'view' | 'edit';
  connectingFrom: string | null;
  onConnectionMove?: (x: number, y: number) => void;
}

const TopologyCanvasComponent = ({
  nodes,
  connections,
  selectedNode,
  selectedConnection,
  onNodeClick,
  onConnectionClick,
  onNodeDrag,
  onCanvasClick,
  mode,
  connectingFrom,
  onConnectionMove
}: TopologyCanvasProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const currentDragPos = useRef<{ x: number; y: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const nodeGroupRefs = useRef<Map<string, SVGGElement>>(new Map());
  const connectionRefs = useRef<Map<string, SVGLineElement>>(new Map());

  const getNodeColor = (node: TopologyNode) => {
    if (node.status === 'down') return '#ef4444';
    switch (node.type) {
      case 'server': return '#22c55e';
      case 'desktop': return '#a855f7';
      case 'firewall': return '#f97316';
      case 'router': return '#3b82f6';
      case 'switch': return '#0ea5e9';
      default: return '#9ca3af';
    }
  };

  const getSVGCoordinates = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: svgP.x, y: svgP.y };
  }, []);

  // Get node position (either dragging position or actual position)
  const getNodePosition = useCallback((nodeId: string) => {
    if (draggingNode === nodeId && currentDragPos.current) {
      return currentDragPos.current;
    }
    const node = nodes.find(n => n.id === nodeId);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }, [draggingNode, nodes]);

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (mode !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    const coords = getSVGCoordinates(e);
    dragStartPos.current = { x: coords.x, y: coords.y };
    currentDragPos.current = { x: node.x, y: node.y };
    setDraggingNode(nodeId);
    isDraggingRef.current = false;
    dragOffset.current = {
      x: coords.x - node.x,
      y: coords.y - node.y
    };
  }, [mode, nodes, getSVGCoordinates]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingNode || mode !== 'edit') return;
    
    e.preventDefault();
    
    // Cancel previous frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(() => {
      const coords = getSVGCoordinates(e);
      
      // Check if we've moved enough to consider it a drag
      if (!isDraggingRef.current && dragStartPos.current) {
        const dx = coords.x - dragStartPos.current.x;
        const dy = coords.y - dragStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 3) {
          isDraggingRef.current = true;
        }
      }
      
      if (isDraggingRef.current) {
        const x = coords.x - dragOffset.current.x;
        const y = coords.y - dragOffset.current.y;
        
        // Store in ref for immediate access
        currentDragPos.current = { x, y };
        
        // Direct DOM update for node position
        const nodeGroup = nodeGroupRefs.current.get(draggingNode);
        if (nodeGroup) {
          nodeGroup.setAttribute('transform', `translate(${x}, ${y})`);
        }
        
        // Direct DOM update for connected lines
        connections.forEach(conn => {
          if (conn.from === draggingNode || conn.to === draggingNode) {
            const line = connectionRefs.current.get(conn.id);
            if (line) {
              const fromPos = conn.from === draggingNode ? { x, y } : getNodePosition(conn.from);
              const toPos = conn.to === draggingNode ? { x, y } : getNodePosition(conn.to);
              if (!fromPos || !toPos) return;
              line.setAttribute('x1', String(fromPos.x));
              line.setAttribute('y1', String(fromPos.y));
              line.setAttribute('x2', String(toPos.x));
              line.setAttribute('y2', String(toPos.y));
            }
          }
        });
      }
    });
  }, [draggingNode, mode, getSVGCoordinates, connections, getNodePosition]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (draggingNode) {
      if (!isDraggingRef.current) {
        // It was a click, not a drag
        const node = nodes.find(n => n.id === draggingNode);
        if (node) {
          onNodeClick(node);
        }
      } else if (currentDragPos.current) {
        // Drag ended, finalize position
        onNodeDrag(draggingNode, currentDragPos.current.x, currentDragPos.current.y, false);
      }
    }
    setDraggingNode(null);
    setDragPosition(null);
    currentDragPos.current = null;
    isDraggingRef.current = false;
    dragStartPos.current = null;
  }, [draggingNode, nodes, onNodeClick, onNodeDrag]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      onCanvasClick(e.clientX - rect.left, e.clientY - rect.top);
    }
  }, [onCanvasClick]);

  // Handle connection line following cursor
  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (connectingFrom && !draggingNode) {
      const coords = getSVGCoordinates(e as any);
      setTempConnectionEnd(coords);
    }
  }, [connectingFrom, draggingNode, getSVGCoordinates]);

  // Clear temp connection when connectingFrom changes
  useEffect(() => {
    if (!connectingFrom) {
      setTempConnectionEnd(null);
    }
  }, [connectingFrom]);

  // Set up global mouse event listeners for smooth dragging
  useEffect(() => {
    if (draggingNode) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
    }
  }, [draggingNode, handleMouseMove, handleMouseUp]);

  // Set up global mouse event listeners for connection drawing
  useEffect(() => {
    if (connectingFrom && !draggingNode) {
      document.body.style.cursor = 'crosshair';
      
      window.addEventListener('mousemove', handleCanvasMouseMove);
      
      return () => {
        window.removeEventListener('mousemove', handleCanvasMouseMove);
        document.body.style.cursor = '';
      };
    }
  }, [connectingFrom, draggingNode, handleCanvasMouseMove]);

  return (
    <svg
      ref={svgRef}
      className="topology-canvas-svg w-full h-full bg-background/50"
      viewBox="-100 -100 1200 800"
      preserveAspectRatio="xMidYMid meet"
      onClick={handleCanvasClick}
      style={{ 
        touchAction: 'none',
        userSelect: 'none',
        overflow: 'visible'
      }}
    >
      <defs>
        {/* Define filters for better text readability */}
        <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="0" dy="1" result="offsetblur"/>
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5"/>
          </feComponentTransfer>
          <feMerge>
            <feMergeNode/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Connections Layer */}
      <g className="connections-layer">
        {connections.map((conn) => {
          const fromNode = nodes.find(node => node.id === conn.from);
          const toNode = nodes.find(node => node.id === conn.to);
          if (!fromNode || !toNode) return null;
          const fromPos = getNodePosition(conn.from);
          const toPos = getNodePosition(conn.to);
          const isSelected = selectedConnection?.id === conn.id;

          return (
            <g 
              key={conn.id} 
              onClick={(e) => { 
                e.stopPropagation(); 
                onConnectionClick(conn); 
              }}
              className="cursor-pointer"
            >
              <line
                ref={(el) => {
                  if (el) connectionRefs.current.set(conn.id, el);
                  else connectionRefs.current.delete(conn.id);
                }}
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke={isSelected ? '#3b82f6' : '#64748b'}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray="5,5"
                className="transition-colors hover:stroke-primary"
                style={{ pointerEvents: 'stroke' }}
              />
              {conn.latency && (
                <text
                  x={(fromPos.x + toPos.x) / 2}
                  y={(fromPos.y + toPos.y) / 2 - 10}
                  fill="#94a3b8"
                  fontSize="12"
                  textAnchor="middle"
                  style={{ pointerEvents: 'none' }}
                >
                  {conn.latency}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Temporary connection line while connecting */}
      {connectingFrom && tempConnectionEnd && (() => {
        const fromNode = nodes.find(n => n.id === connectingFrom);
        if (!fromNode) return null;
        
        const fromPos = getNodePosition(connectingFrom);
        
        return (
          <g className="temp-connection-layer" style={{ pointerEvents: 'none' }}>
            {/* Glow effect */}
            <line
              x1={fromPos.x}
              y1={fromPos.y}
              x2={tempConnectionEnd.x}
              y2={tempConnectionEnd.y}
              stroke="#3b82f6"
              strokeWidth="8"
              opacity="0.2"
              strokeLinecap="round"
            />
            {/* Main line */}
            <line
              x1={fromPos.x}
              y1={fromPos.y}
              x2={tempConnectionEnd.x}
              y2={tempConnectionEnd.y}
              stroke="#3b82f6"
              strokeWidth="3"
              strokeDasharray="10,5"
              strokeLinecap="round"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0"
                to="15"
                dur="0.6s"
                repeatCount="indefinite"
              />
            </line>
            {/* End point indicator */}
            <circle
              cx={tempConnectionEnd.x}
              cy={tempConnectionEnd.y}
              r="8"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="3"
              opacity="0.9"
            >
              <animate
                attributeName="r"
                values="8;10;8"
                dur="1s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.9;0.6;0.9"
                dur="1s"
                repeatCount="indefinite"
              />
            </circle>
            {/* Instruction text */}
            <text
              x={tempConnectionEnd.x}
              y={tempConnectionEnd.y - 20}
              fill="#3b82f6"
              fontSize="13"
              fontWeight="600"
              textAnchor="middle"
              style={{ pointerEvents: 'none' }}
            >
              Click target node
            </text>
          </g>
        );
      })()}

      {/* Nodes Layer */}
      <g className="nodes-layer">
        {nodes.map((node) => {
          const isSelected = selectedNode?.id === node.id;
          const isBeingDragged = draggingNode === node.id;
          const pos = getNodePosition(node.id);

          return (
            <g
              key={node.id}
              ref={(el) => {
                if (el) {
                  nodeGroupRefs.current.set(node.id, el);
                  // Set initial position
                  if (!isBeingDragged) {
                    el.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
                  }
                } else {
                  nodeGroupRefs.current.delete(node.id);
                }
              }}
              style={{ 
                cursor: mode === 'edit' ? (isBeingDragged ? 'grabbing' : 'grab') : 'pointer',
                willChange: isBeingDragged ? 'transform' : 'auto'
              }}
            >
              {/* Invisible larger circle for easier grabbing */}
              <circle
                cx={0}
                cy={0}
                r={50}
                fill="transparent"
                style={{ pointerEvents: 'all' }}
                onMouseDown={(e) => handleMouseDown(e, node.id)}
              />
              
              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={0}
                  cy={0}
                  r={38}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2}
                  opacity={0.6}
                  style={{ pointerEvents: 'none' }}
                >
                  <animate
                    attributeName="r"
                    values="38;42;38"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.6;0.3;0.6"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              
              {/* Main node circle */}
              <circle
                cx={0}
                cy={0}
                r={isSelected ? 35 : 30}
                fill={getNodeColor(node)}
                stroke={isSelected ? '#ffffff' : '#1e293b'}
                strokeWidth={isSelected ? 3 : 2}
                opacity={node.status === 'down' ? 0.5 : 0.9}
                style={{ 
                  pointerEvents: 'none',
                  transition: isBeingDragged ? 'none' : 'r 0.2s ease-out'
                }}
              />
              
              {/* Node name */}
              <NodeText
                text={node.name}
                y={45}
                fontSize={14}
                fontWeight="600"
                maxWidth={150}
              />
              
              {/* IP address */}
              {node.ip && (
                <NodeText
                  text={node.ip}
                  y={65}
                  fontSize={12}
                  color="#9ca3af"
                  maxWidth={150}
                />
              )}
              
              {/* Services count */}
              {typeof node.services === 'string' && node.services && (
                <NodeText
                  text={`🔓 ${node.services.split(',').length} services`}
                  y={82}
                  fontSize={11}
                  fontWeight="600"
                  color="#22c55e"
                  maxWidth={150}
                />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
};

// Optimized text component with auto-sizing background
const NodeText = memo(({ 
  text, 
  y, 
  fontSize = 12, 
  fontWeight = 'normal',
  color = '#ffffff',
  maxWidth = 120
}: { 
  text: string; 
  y: number; 
  fontSize?: number; 
  fontWeight?: string;
  color?: string;
  maxWidth?: number;
}) => {
  const textRef = useRef<SVGTextElement>(null);
  const [textWidth, setTextWidth] = useState(maxWidth);
  const safeText = typeof text === 'string' ? text : String(text ?? '');

  useEffect(() => {
    if (textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(Math.min(bbox.width + 16, maxWidth));
    }
  }, [safeText, maxWidth]);

  // Truncate text if too long
  const displayText = safeText.length > 25 ? safeText.substring(0, 22) + '...' : safeText;

  return (
    <g>
      {/* Background */}
      <rect
        x={-textWidth / 2}
        y={y - fontSize / 2 - 4}
        width={textWidth}
        height={fontSize + 8}
        fill="rgba(0, 0, 0, 0.75)"
        rx={4}
        style={{ pointerEvents: 'none' }}
      />
      {/* Text */}
      <text
        ref={textRef}
        x={0}
        y={y}
        fill={color}
        fontSize={fontSize}
        fontWeight={fontWeight}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ 
          pointerEvents: 'none',
          userSelect: 'none'
        }}
        filter="url(#textShadow)"
      >
        {displayText}
      </text>
    </g>
  );
});

NodeText.displayName = 'NodeText';

// Memoize to prevent unnecessary re-renders
export const TopologyCanvas = memo(TopologyCanvasComponent, (prev, next) => {
  // Only re-render if critical props change
  if (prev.nodes.length !== next.nodes.length) return false;
  if (prev.connections.length !== next.connections.length) return false;
  if (prev.selectedNode?.id !== next.selectedNode?.id) return false;
  if (prev.selectedConnection?.id !== next.selectedConnection?.id) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.connectingFrom !== next.connectingFrom) return false;

  // Compare every rendered node field, not only position/name. Same-ID
  // metadata, type, IP, OS, and service changes must repaint the SVG.
  const prevNodesMap = new Map(prev.nodes.map(n => [n.id, n]));
  const nodesEqual = next.nodes.every(node => {
    const prevNode = prevNodesMap.get(node.id);
    return Boolean(prevNode && JSON.stringify(prevNode) === JSON.stringify(node));
  });

  if (!nodesEqual) return false;

  const prevConnsMap = new Map(prev.connections.map(c => [c.id, c]));
  const connectionsEqual = next.connections.every(connection => {
    const previous = prevConnsMap.get(connection.id);
    return Boolean(previous && JSON.stringify(previous) === JSON.stringify(connection));
  });

  return connectionsEqual;
});

TopologyCanvas.displayName = 'TopologyCanvas';
