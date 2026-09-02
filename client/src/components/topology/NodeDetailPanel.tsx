import React from 'react';
import { TopologyNode, NodeType } from '@/lib/topology-store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface NodeDetailPanelProps {
  node: TopologyNode;
  onUpdate: (updates: Partial<TopologyNode>) => void;
  readOnly?: boolean;
}

export function NodeDetailPanel({ node, onUpdate, readOnly = false }: NodeDetailPanelProps) {
  const nodeTypes: { value: NodeType; label: string }[] = [
    { value: 'server', label: 'Server' },
    { value: 'desktop', label: 'Desktop' },
    { value: 'firewall', label: 'Firewall' },
    { value: 'router', label: 'Router' },
    { value: 'switch', label: 'Switch' },
    { value: 'unknown', label: 'Unknown' },
  ];

  return (
    <div className="p-4 bg-card border-t border-border space-y-3 animate-slide-in">
      <h3 className="text-sm font-semibold text-foreground">Node Details</h3>
      
      {/* Common Fields */}
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={node.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          disabled={readOnly}
          className="text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ip">IP Address</Label>
        <Input
          id="ip"
          value={node.ip || ''}
          onChange={(e) => onUpdate({ ip: e.target.value })}
          disabled={readOnly}
          placeholder="192.168.1.1"
          className="text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select
          value={node.type}
          onValueChange={(value) => onUpdate({ type: value as NodeType })}
          disabled={readOnly}
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {nodeTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Type-specific Fields */}
      {(node.type === 'server' || node.type === 'desktop') && (
        <>
          <div className="space-y-2">
            <Label htmlFor="os">Operating System</Label>
            <Input
              id="os"
              value={node.os || ''}
              onChange={(e) => onUpdate({ os: e.target.value })}
              disabled={readOnly}
              placeholder="Linux Ubuntu 20.04"
              className="text-sm"
            />
          </div>
        </>
      )}

      {node.type === 'server' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="ports">Open Ports</Label>
            <Input
              id="ports"
              value={node.ports || ''}
              onChange={(e) => onUpdate({ ports: e.target.value })}
              disabled={readOnly}
              placeholder="22, 80, 443"
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="services">Services</Label>
            <Input
              id="services"
              value={node.services || ''}
              onChange={(e) => onUpdate({ services: e.target.value })}
              disabled={readOnly}
              placeholder="SSH, Apache, MySQL"
              className="text-sm"
            />
          </div>
        </>
      )}

      {node.type === 'desktop' && (
        <div className="space-y-2">
          <Label htmlFor="user">User</Label>
          <Input
            id="user"
            value={node.user || ''}
            onChange={(e) => onUpdate({ user: e.target.value })}
            disabled={readOnly}
            placeholder="john.doe"
            className="text-sm"
          />
        </div>
      )}

      {(node.type === 'firewall' || node.type === 'router' || node.type === 'switch') && (
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            value={node.model || ''}
            onChange={(e) => onUpdate({ model: e.target.value })}
            disabled={readOnly}
            placeholder="Cisco ASA 5505"
            className="text-sm"
          />
        </div>
      )}

      {node.type === 'firewall' && (
        <div className="space-y-2">
          <Label htmlFor="rules">Firewall Rules</Label>
          <Textarea
            id="rules"
            value={node.rules || ''}
            onChange={(e) => onUpdate({ rules: e.target.value })}
            disabled={readOnly}
            placeholder="Allow 80, 443&#10;Block 22"
            className="text-sm min-h-[60px]"
          />
        </div>
      )}

      {node.type === 'router' && (
        <div className="space-y-2">
          <Label htmlFor="routes">Routes</Label>
          <Textarea
            id="routes"
            value={node.routes || ''}
            onChange={(e) => onUpdate({ routes: e.target.value })}
            disabled={readOnly}
            placeholder="192.168.1.0/24 via 10.0.0.1"
            className="text-sm min-h-[60px]"
          />
        </div>
      )}

      {node.type === 'switch' && (
        <div className="space-y-2">
          <Label htmlFor="vlans">VLANs</Label>
          <Input
            id="vlans"
            value={node.vlans || ''}
            onChange={(e) => onUpdate({ vlans: e.target.value })}
            disabled={readOnly}
            placeholder="VLAN 10, 20, 30"
            className="text-sm"
          />
        </div>
      )}

      {/* Notes - Always available */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={node.notes || ''}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          disabled={readOnly}
          placeholder="Additional notes..."
          className="text-sm min-h-[80px]"
        />
      </div>
    </div>
  );
}
