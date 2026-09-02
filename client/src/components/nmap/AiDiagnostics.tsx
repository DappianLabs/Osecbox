import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { useSettingsStore } from '@/lib/settings-store';
import { useAttackState } from '@/lib/attack-state-store';

export function AiDiagnostics() {
  const { settings } = useSettingsStore();
  const { session, manager, isLoading } = useAttackState();
  const [electronStatus, setElectronStatus] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(true);

  // PERFORMANCE: Only poll when visible and reduce frequency
  useEffect(() => {
    const checkStatus = async () => {
      // Check electron API
      const electronAvailable = typeof window !== 'undefined' && !!window.electron;
      const chatAIAvailable = electronAvailable && window.electron && !!window.electron.chatAI;
      
      setElectronStatus({
        available: electronAvailable,
        chatAI: chatAIAvailable
      });

      // Check AI status
      if (electronAvailable && window.electron?.invoke) {
        try {
          const status = await window.electron.invoke('get-ai-status');
          setAiStatus(status);
        } catch (error) {
          console.error('[Diagnostics] Failed to get AI status:', error);
        }
      }
    };

    // Initial check
    checkStatus();
    
    if (!isVisible) {
      return; // Don't set up interval if not visible
    }
    
    // PERFORMANCE: Reduce polling frequency to 10s
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [isVisible]);
  
  // Detect visibility using Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    
    const element = document.getElementById('ai-diagnostics-panel');
    if (element) {
      observer.observe(element);
    }
    
    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, []);

  const checks = [
    {
      name: 'Electron API',
      status: electronStatus?.available ? 'ok' : 'error',
      message: electronStatus?.available ? 'Available' : 'Not available'
    },
    {
      name: 'Chat AI Function',
      status: electronStatus?.chatAI ? 'ok' : 'error',
      message: electronStatus?.chatAI ? 'Available' : 'Not available'
    },
    {
      name: 'API Key',
      status: settings.aiApiKey ? 'ok' : 'error',
      message: settings.aiApiKey ? `Configured (${settings.aiApiKey.length} chars)` : 'Not configured'
    },
    {
      name: 'API Endpoint',
      status: settings.apiEndpoint ? 'ok' : 'error',
      message: settings.apiEndpoint || 'Not configured'
    },
    {
      name: 'Model',
      status: settings.selectedModel ? 'ok' : 'error',
      message: settings.selectedModel || 'Not selected'
    },
    {
      name: 'Provider',
      status: settings.provider ? 'ok' : 'error',
      message: settings.provider || 'Not selected'
    },
    {
      name: 'AI Client (Electron)',
      status: aiStatus?.configured ? 'ok' : 'error',
      message: aiStatus?.configured ? `Configured (${aiStatus.config?.provider} - ${aiStatus.config?.model})` : 'Not configured'
    },
    {
      name: 'Attack State Session',
      status: isLoading ? 'warning' : (session ? 'ok' : 'error'),
      message: isLoading ? 'Initializing...' : (session ? `Active (${session.hosts?.size || 0} hosts)` : 'Not initialized')
    },
    {
      name: 'Attack State Manager',
      status: isLoading ? 'warning' : (manager ? 'ok' : 'error'),
      message: isLoading ? 'Initializing...' : (manager ? 'Active' : 'Not initialized')
    }
  ];

  return (
    <div id="ai-diagnostics-panel" className="p-4 bg-card border border-border rounded-lg space-y-2">
      <h3 className="font-bold text-sm mb-3">AI Diagnostics</h3>
      {checks.map((check, idx) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          {check.status === 'ok' ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : check.status === 'warning' ? (
            <AlertCircle className="w-4 h-4 text-yellow-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="font-medium">{check.name}:</span>
          <span className="text-muted-foreground">{check.message}</span>
        </div>
      ))}
    </div>
  );
}
