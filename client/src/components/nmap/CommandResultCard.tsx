import React from 'react';
import { CommandResult } from '@/lib/command-parser';
import { Server, Network, Activity, Globe, Route } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface CommandResultCardProps {
  result: CommandResult;
}

export function CommandResultCard({ result }: CommandResultCardProps) {
  return (
    <div className="bg-card border-2 border-border rounded-lg p-4 space-y-4 shadow-lg hover:shadow-xl transition-shadow">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        {getIcon(result.type)}
        <div className="flex-1">
          <div className="font-mono text-sm text-muted-foreground">{result.command}</div>
        </div>
        <Badge variant="outline" className="text-xs uppercase">{result.type}</Badge>
      </div>

      {/* Content based on type */}
      <div>
        {result.type === 'nslookup' && <NslookupContent data={result.data} />}
        {result.type === 'ipconfig' && <IpconfigContent data={result.data} />}
        {result.type === 'arp' && <ArpContent data={result.data} />}
        {result.type === 'netstat' && <NetstatContent data={result.data} />}
        {result.type === 'ping' && <PingContent data={result.data} />}
        {result.type === 'route' && <RouteContent data={result.data} />}
      </div>
    </div>
  );
}

function getIcon(type: string) {
  switch (type) {
    case 'nslookup': return <Globe className="w-5 h-5 text-blue-500" />;
    case 'ipconfig': return <Network className="w-5 h-5 text-green-500" />;
    case 'arp': return <Server className="w-5 h-5 text-purple-500" />;
    case 'netstat': return <Activity className="w-5 h-5 text-orange-500" />;
    case 'ping': return <Activity className="w-5 h-5 text-cyan-500" />;
    case 'route': return <Route className="w-5 h-5 text-pink-500" />;
    default: return <Server className="w-5 h-5" />;
  }
}

function NslookupContent({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {data.names.length > 0 && (
        <div className="bg-muted/20 rounded-lg p-3">
          <div className="text-sm font-bold text-muted-foreground mb-2 uppercase tracking-wide">Names</div>
          {data.names.map((name: string, i: number) => (
            <div key={i} className="font-mono text-base text-foreground mb-1">{name}</div>
          ))}
        </div>
      )}
      {data.addresses.length > 0 && (
        <div className="bg-blue-500/10 rounded-lg p-3">
          <div className="text-sm font-bold text-blue-400 mb-2 uppercase tracking-wide">Addresses</div>
          {data.addresses.map((addr: string, i: number) => (
            <div key={i} className="font-mono text-base text-blue-400 mb-1">{addr}</div>
          ))}
        </div>
      )}
      {data.servers.length > 0 && (
        <div className="bg-muted/20 rounded-lg p-3">
          <div className="text-sm font-bold text-muted-foreground mb-2 uppercase tracking-wide">DNS Servers</div>
          {data.servers.map((server: string, i: number) => (
            <div key={i} className="font-mono text-sm text-muted-foreground mb-1">{server}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function IpconfigContent({ data }: { data: any }) {
  return (
    <div className="space-y-3">
      {data.interfaces.slice(0, 3).map((iface: any, i: number) => (
        <div key={i} className="space-y-1">
          <div className="text-xs font-bold text-foreground">{iface.name}</div>
          {iface.properties.slice(0, 5).map((prop: any, j: number) => (
            <div key={j} className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{prop.key}:</span>
              <span className="font-mono text-foreground">{prop.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ArpContent({ data }: { data: any }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-bold text-muted-foreground mb-2">{data.entries.length} ARP Entries</div>
      {data.entries.slice(0, 10).map((entry: any, i: number) => (
        <div key={i} className="flex justify-between text-[11px] py-1 border-b border-border/50">
          <span className="font-mono text-blue-400">{entry.ip}</span>
          <span className="font-mono text-muted-foreground">{entry.mac}</span>
        </div>
      ))}
    </div>
  );
}

function NetstatContent({ data }: { data: any }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-bold text-muted-foreground mb-2">{data.connections.length} Active Connections</div>
      {data.connections.slice(0, 10).map((conn: any, i: number) => (
        <div key={i} className="text-[11px] py-1 border-b border-border/50">
          <div className="flex justify-between">
            <span className="text-orange-400">{conn.protocol}</span>
            <span className="text-green-400">{conn.state}</span>
          </div>
          <div className="font-mono text-muted-foreground">{conn.local} → {conn.remote}</div>
        </div>
      ))}
    </div>
  );
}

function PingContent({ data }: { data: any }) {
  const avgTime = data.times.length > 0 
    ? Math.round(data.times.reduce((a: number, b: number) => a + b, 0) / data.times.length)
    : 0;
    
  return (
    <div className="space-y-2">
      {data.host && (
        <div className="text-xs">
          <span className="text-muted-foreground">Host: </span>
          <span className="font-mono text-foreground">{data.host}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] text-muted-foreground">Sent</div>
          <div className="text-sm font-bold text-foreground">{data.packets.sent}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Received</div>
          <div className="text-sm font-bold text-green-400">{data.packets.received}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Lost</div>
          <div className="text-sm font-bold text-red-400">{data.packets.lost}</div>
        </div>
      </div>
      {avgTime > 0 && (
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground">Avg Time</div>
          <div className="text-sm font-bold text-cyan-400">{avgTime}ms</div>
        </div>
      )}
    </div>
  );
}

function RouteContent({ data }: { data: any }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-bold text-muted-foreground mb-2">{data.routes.length} Routes</div>
      {data.routes.slice(0, 10).map((route: any, i: number) => (
        <div key={i} className="flex justify-between text-[11px] py-1 border-b border-border/50">
          <span className="font-mono text-foreground">{route.destination}</span>
          <span className="font-mono text-blue-400">{route.gateway}</span>
        </div>
      ))}
    </div>
  );
}
