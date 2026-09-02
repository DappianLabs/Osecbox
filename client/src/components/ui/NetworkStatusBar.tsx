/**
 * Network Status Bar
 * Shows network connectivity status at the top of the app
 */

import React, { useEffect, useState } from 'react';
import { networkResilience, NetworkHealth } from '@/lib/network-resilience';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Shield, Target } from 'lucide-react';

export const NetworkStatusBar: React.FC = () => {
  const [health, setHealth] = useState<NetworkHealth>(networkResilience.getHealth());
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const unsubscribe = networkResilience.subscribe((newHealth) => {
      setHealth(newHealth);
      
      // Show bar if not online
      setIsVisible(newHealth.status !== 'online');
    });
    
    return unsubscribe;
  }, []);
  
  if (!isVisible) {
    return null;
  }
  
  const getStatusConfig = () => {
    switch (health.status) {
      case 'online':
        return {
          icon: Wifi,
          color: 'bg-green-500',
          textColor: 'text-green-100',
          message: 'Connected',
        };
      case 'degraded':
        return {
          icon: AlertTriangle,
          color: 'bg-yellow-500',
          textColor: 'text-yellow-100',
          message: `Slow connection (${health.latency}ms)`,
        };
      case 'offline':
        return {
          icon: WifiOff,
          color: 'bg-red-500',
          textColor: 'text-red-100',
          message: health.lastError || 'No network connection',
        };
      case 'reconnecting':
        return {
          icon: RefreshCw,
          color: 'bg-orange-500',
          textColor: 'text-orange-100',
          message: `Reconnecting... (attempt ${health.retryCount}/5)`,
        };
    }
  };
  
  const config = getStatusConfig();
  const Icon = config.icon;
  
  return (
    <div className={`w-full ${config.color} ${config.textColor} px-4 py-2 flex items-center justify-between pointer-events-auto`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${health.status === 'reconnecting' ? 'animate-spin' : ''}`} />
        <span className="font-medium">{config.message}</span>
        
        {/* VPN Status */}
        {health.vpnConnected && (
          <div className="flex items-center gap-1 ml-4 px-2 py-0.5 bg-white/20 rounded">
            <Shield className="w-4 h-4" />
            <span className="text-sm">VPN</span>
          </div>
        )}
        
        {/* Lab Status */}
        {health.labConnected && (
          <div className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-white/20 rounded">
            <Target className="w-4 h-4" />
            <span className="text-sm">Lab</span>
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        {health.status === 'offline' && (
          <button
            type="button"
            onClick={() => networkResilience.forceCheck()}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm font-medium transition-colors"
          >
            Retry Now
          </button>
        )}
        
        <button
          type="button"
          onClick={() => setIsVisible(false)}
          className="px-2 py-1 hover:bg-white/20 rounded text-sm transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
