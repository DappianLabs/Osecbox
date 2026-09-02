import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Network, Terminal, Database, Bell, Shield, Folder, Sparkles, Download, RefreshCw, Zap, Layers } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { useUpdateStore } from '@/lib/update-store';
import { useSettingsStore } from '@/lib/settings-store';
import { WSL2StatusBadge } from '@/components/platform/WSL2StatusBadge';
import { AISettingsSection } from '@/components/settings/AISettingsSection';
import { WSL2SettingsSection } from '@/components/settings/WSL2SettingsSection';
import { NotificationSettingsSection } from '@/components/settings/NotificationSettingsSection';

interface SettingsViewProps {
  scrollToSection?: string;
}

export function SettingsView({ scrollToSection }: SettingsViewProps = {}) {
  const { showToast } = useToast();
  const { updateAvailable, updateInfo } = useUpdateStore();
  const { settings, updateSetting: _updateSetting, updateSettings: _updateSettings, resetSettings } = useSettingsStore();
  
  // Widen types for child components that expect string-keyed settings callbacks
  const updateSetting = _updateSetting as (key: string, value: any) => Promise<void>;
  const updateSettings = _updateSettings as (updates: Record<string, any>) => Promise<void>;

  const [groqStatus, setGroqStatus] = useState({ configured: false, hasKey: false, verified: false });
  const [appVersion, setAppVersion] = useState('1.0.0'); // Default version
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>('');
  
  // Track last synced config and request generations so stale AI responses
  // cannot publish status, toasts, or sync markers after a newer request.
  const lastSyncedConfig = useRef<string>('');
  const aiRequestGeneration = useRef(0);
  const [aiSyncNonce, setAiSyncNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const bridge = window.electron;
    if (!bridge) return () => { alive = false; };

    void bridge.getGroqStatus().then((status) => {
      if (!alive) return;
      setGroqStatus({
        ...status,
        verified: Boolean(status.verified),
      });
    }).catch(() => undefined);

    if (bridge.getAppVersion) {
      void bridge.getAppVersion().then(data => {
        if (alive && data.version) {
          setAppVersion(data.version);
        }
      }).catch(() => undefined);
    }

    return () => {
      alive = false;
    };
  }, []);

  // Scroll to specific section when requested
  useEffect(() => {
    if (scrollToSection) {
      setTimeout(() => {
        const element = document.getElementById(scrollToSection);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [scrollToSection]);

  // Sync AI config to electron when settings change
  useEffect(() => {
    const requestId = ++aiRequestGeneration.current;
    const bridge = window.electron;

    // Only sync if we have all required fields. The explicit Test & Save
    // action remains available for incomplete or intentionally custom drafts.
    if (!bridge?.invoke || !settings.aiApiKey || !settings.apiEndpoint || !settings.selectedModel) {
      return;
    }

    if (settings.provider === 'cloudflare' && !settings.cloudflareAccountId?.trim()) {
      return;
    }

    const selectedModel = String(settings.selectedModel || '').trim();
    if (!selectedModel || selectedModel === 'custom') {
      console.warn('[Settings] Model ID is required for provider:', settings.provider);
      return;
    }

    const isValidEndpoint = () => {
      if (settings.provider === 'cloudflare' && settings.apiEndpoint === 'cloudflare') return true;
      try {
        const url = new URL(settings.apiEndpoint);
        const isLocalCustomEndpoint = settings.provider === 'custom' &&
          ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
        return (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalCustomEndpoint)) && url.hostname.length > 0;
      } catch {
        return false;
      }
    };

    if (!isValidEndpoint()) {
      console.warn('[Settings] Invalid API endpoint:', settings.apiEndpoint);
      return;
    }

    const currentConfig = JSON.stringify({
      provider: settings.provider,
      apiKey: settings.aiApiKey,
      endpoint: settings.apiEndpoint,
      model: selectedModel,
      accountId: settings.cloudflareAccountId || '',
      maxTokens: settings.aiTokenLimit,
    });

    if (currentConfig === lastSyncedConfig.current) {
      return;
    }

    const syncAIConfig = async () => {
      if (requestId !== aiRequestGeneration.current) return;
      try {
        console.log('[Settings] Syncing AI config to electron:', {
          provider: settings.provider,
          model: selectedModel,
          endpoint: settings.apiEndpoint,
          hasApiKey: !!settings.aiApiKey,
          maxTokens: settings.aiTokenLimit,
        });

        const result = await bridge.invoke('set-ai-config', {
          provider: settings.provider,
          apiKey: settings.aiApiKey,
          endpoint: settings.apiEndpoint,
          model: selectedModel,
          accountId: settings.cloudflareAccountId || '',
          maxTokens: settings.aiTokenLimit,
          temperature: 0.5,
        });

        if (requestId !== aiRequestGeneration.current) return;
        if (result?.success) {
          lastSyncedConfig.current = currentConfig;
          showToast('AI configuration updated successfully', 'success');
        } else {
          console.error('[Settings] Failed to sync AI config:', result?.error);
          showToast(`Failed to update AI config: ${result?.error || 'Unknown error'}`, 'error');
        }
      } catch (error: any) {
        if (requestId !== aiRequestGeneration.current) return;
        console.error('[Settings] Failed to sync AI config:', error);
        showToast(`Failed to update AI config: ${error?.message || 'Network error'}`, 'error');
      }
    };

    const timeoutId = setTimeout(() => { void syncAIConfig(); }, 500);
    return () => {
      clearTimeout(timeoutId);
      if (aiRequestGeneration.current === requestId) {
        aiRequestGeneration.current += 1;
      }
    };
  }, [settings.provider, settings.aiApiKey, settings.apiEndpoint, settings.selectedModel, settings.cloudflareAccountId, settings.aiTokenLimit, aiSyncNonce, showToast]);

  // OPTIMIZATION: Wrap handler with useCallback
  const handleSaveGroqKey = useCallback(async () => {
    const requestId = ++aiRequestGeneration.current;
    const bridge = window.electron;
    if (!bridge?.invoke) {
      showToast('AI settings are unavailable in web mode.', 'error');
      return;
    }

    const apiKey = String(settings.aiApiKey || '').trim();
    if (!apiKey) {
      showToast('Enter the provider API key before testing the connection.', 'error');
      return;
    }
    if (settings.provider === 'cloudflare' && !settings.cloudflareAccountId?.trim()) {
      showToast('Enter the Cloudflare Account ID before testing the connection.', 'error');
      return;
    }
    const selectedModel = String(settings.selectedModel || '').trim();
    if (!selectedModel || selectedModel === 'custom') {
      showToast('Enter a provider model ID before testing the connection.', 'error');
      return;
    }

    try {
      const result = await bridge.invoke('test-ai-config', {
        provider: settings.provider,
        apiKey,
        endpoint: settings.apiEndpoint,
        model: selectedModel,
        accountId: settings.cloudflareAccountId || '',
        maxTokens: settings.aiTokenLimit,
        temperature: 0.5,
      });
      if (requestId !== aiRequestGeneration.current) return;

      if (result?.success) {
        lastSyncedConfig.current = JSON.stringify({
          provider: settings.provider,
          apiKey,
          endpoint: settings.apiEndpoint,
          model: selectedModel,
          accountId: settings.cloudflareAccountId || '',
          maxTokens: settings.aiTokenLimit,
        });
        setGroqStatus({ configured: true, hasKey: true, verified: true });
        showToast('AI connection verified and saved', 'success');
      } else {
        showToast('AI connection failed: ' + (result?.error || 'Unknown provider error'), 'error');
      }
    } catch (error: any) {
      if (requestId !== aiRequestGeneration.current) return;
      showToast('AI connection failed: ' + (error?.message || 'Provider request failed'), 'error');
    }
  }, [settings.provider, settings.aiApiKey, settings.apiEndpoint, settings.selectedModel, settings.cloudflareAccountId, settings.aiTokenLimit, showToast]);

  const handleSaveSettings = useCallback(() => {
    // Individual controls persist through the settings store. Incrementing a
    // nonce makes this explicit confirmation retrigger validation/sync even if
    // the last edit did not change a dependency value.
    lastSyncedConfig.current = '';
    setAiSyncNonce((nonce) => nonce + 1);
    showToast('Settings saved', 'success');
  }, [showToast]);

  const handleResetSettings = useCallback(async () => {
    aiRequestGeneration.current += 1;
    await resetSettings();
    lastSyncedConfig.current = '';
    setAiSyncNonce((nonce) => nonce + 1);
    showToast('Settings reset to defaults', 'success');
  }, [resetSettings, showToast]);

  const handleCheckForUpdates = async () => {
    if (!window.electron?.checkForUpdates) {
      setUpdateStatus('Updates not available in web mode');
      return;
    }
    
    setCheckingUpdate(true);
    setUpdateStatus('Checking for updates...');
    
    const result = await window.electron.checkForUpdates();
    setCheckingUpdate(false);
    
    if (result.success) {
      if (result.updateInfo) {
        setUpdateStatus(`Update available: v${result.updateInfo.version}`);
        showToast('Update available!', 'success');
      } else {
        setUpdateStatus('You\'re up to date!');
        showToast('No updates available', 'success');
      }
    } else {
      setUpdateStatus('Failed to check for updates');
      showToast(result.error || 'Update check failed', 'error');
    }
  };

  return (
    <div 
      className="h-full bg-background overflow-y-auto" 
      style={{ 
        zoom: 1.1,
        backgroundImage: 'radial-gradient(circle, rgba(100, 100, 100, 0.15) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8 pb-6 border-b-4 border-primary/20">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center border-2 border-primary/30">
              <Settings className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-1">Settings</h1>
              <p className="text-muted-foreground text-base">Configure your pentesting tool preferences and paths</p>
            </div>
          </div>
        </div>

        {/* AI Configuration - Using Split Component */}
        <AISettingsSection
          settings={settings}
          updateSetting={updateSetting}
          updateSettings={updateSettings}
          groqStatus={groqStatus}
          onSaveGroqKey={handleSaveGroqKey}
        />

        <Separator className="my-8" />

        {/* Terminal Settings */}
        <section id="settings-terminal" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-emerald-500/30">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Terminal Settings</h2>
              <p className="text-xs text-muted-foreground">Configure terminal buffer, scrollback, and limits</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="terminalBufferSize" className="text-foreground font-semibold">Buffer Size Limit (MB)</Label>
              <Input
                id="terminalBufferSize"
                type="number"
                value={settings.terminalBufferSize}
                onChange={(e) => updateSetting('terminalBufferSize', parseInt(e.target.value) || 0)}
                className="font-mono bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                min="0"
                max="8"
                step="1"
              />
              <p className="text-xs text-muted-foreground">
                Maximum recovery buffer size per terminal in MB. Set to <span className="font-bold text-emerald-400">0 for managed mode</span> (4MB). 
                Larger values are capped for renderer stability. The full
                transcript is retained on disk and is available through Save.
              </p>
              {settings.terminalBufferSize === 0 ? (
                <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Managed 4MB renderer view - older output remains available in the full transcript
                </p>
              ) : (
                <p className="text-xs text-yellow-400 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                  {settings.terminalBufferSize}MB renderer view - older output remains available in the full transcript
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="terminalScrollback" className="text-foreground font-semibold">Scrollback Lines</Label>
              <Input
                id="terminalScrollback"
                type="number"
                value={settings.terminalScrollback}
                onChange={(e) => updateSetting('terminalScrollback', parseInt(e.target.value) || 10000)}
                className="font-mono bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                min="1000"
                max="50000"
                step="1000"
              />
              <p className="text-xs text-muted-foreground">
                Number of lines to keep in terminal scrollback buffer. Default: 10,000 lines. 
                Higher values allow more scrolling but use more memory.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="terminalMaxTerminals" className="text-foreground font-semibold">Max Terminals</Label>
              <Input
                id="terminalMaxTerminals"
                type="number"
                value={settings.terminalMaxTerminals}
                onChange={(e) => updateSetting('terminalMaxTerminals', parseInt(e.target.value) || 50)}
                className="font-mono bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                min="10"
                max="50"
                step="10"
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of terminals you can create. Default: 50, hard limit: 50. 
                Each terminal uses ~2-5MB of memory.
              </p>
            </div>

            <div className="bg-emerald-500/10 border-2 border-emerald-500/40 rounded-lg p-4 shadow-sm">
              <p className="text-sm text-foreground font-medium mb-2">
                <strong className="text-emerald-400">Recommended Settings:</strong>
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                <li><strong>Buffer Size: 0 (managed)</strong> - Keep the newest renderer tail responsive; the full transcript remains exportable</li>
                <li><strong>Scrollback: 10,000 lines</strong> - Good balance for most scans</li>
                <li><strong>Max Terminals: 50</strong> - Plenty for most pentests</li>
              </ul>
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* WSL2 Configuration - Using Split Component */}
        <WSL2SettingsSection
          settings={settings}
          updateSetting={updateSetting}
        />

        <Separator className="my-8" />

        {/* Nmap Configuration */}
        <section id="settings-nmap" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-blue-500/30">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Nmap Configuration</h2>
              <p className="text-xs text-muted-foreground">Network scanning tool settings</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="nmapPath" className="text-foreground font-semibold">Nmap Executable Path</Label>
              <Input
                id="nmapPath"
                value={settings.nmapPath}
                onChange={(e) => updateSetting('nmapPath', e.target.value)}
                className="font-mono"
                placeholder="nmap or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to the nmap binary on your system</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeout" className="text-foreground font-semibold">Default Scan Timeout (seconds)</Label>
              <Input
                id="timeout"
                type="number"
                value={settings.defaultTimeout}
                onChange={(e) => updateSetting('defaultTimeout', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Maximum time to wait for scan completion</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="concurrent" className="text-foreground font-semibold">Max Concurrent Scans</Label>
              <Input
                id="concurrent"
                type="number"
                value={settings.maxConcurrentScans}
                onChange={(e) => updateSetting('maxConcurrentScans', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Number of scans that can run simultaneously</p>
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Output & Display */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-cyan-500/30">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Network className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Output & Display</h2>
              <p className="text-xs text-muted-foreground">Interface and output preferences</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Verbose Terminal Output</Label>
                <p className="text-xs text-muted-foreground">Show detailed nmap command output in terminal</p>
              </div>
              <Switch
                checked={settings.verboseOutput}
                onCheckedChange={(checked) => updateSetting('verboseOutput', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Dark Mode</Label>
                <p className="text-xs text-muted-foreground">Use dark theme for the interface</p>
              </div>
              <Switch
                checked={settings.darkMode}
                onCheckedChange={(checked) => updateSetting('darkMode', checked)}
              />
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Data & Storage */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-indigo-500/30">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Data & Storage</h2>
              <p className="text-xs text-muted-foreground">Workspace persistence and export settings</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 border-2 border-primary/40 rounded-lg p-4 mb-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Database className="w-6 h-6 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-primary mb-1">Session Persistence</p>
                  <p className="text-xs text-muted-foreground">
                    Control whether your work (sessions, listeners, tabs) is saved between app restarts.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border-2 border-border/60 shadow-sm">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold text-base">Persist Workspace on Boot</Label>
                <p className="text-xs text-muted-foreground max-w-md">
                  When enabled, all your sessions, listeners, tunnels, and tabs will be restored when you restart the app. 
                  When disabled, you start with a clean slate every time.
                </p>
              </div>
              <Switch
                checked={settings.persistWorkspace}
                onCheckedChange={(checked) => {
                  updateSetting('persistWorkspace', checked);
                  showToast(
                    checked 
                      ? 'Workspace will be saved on next restart' 
                      : 'Workspace will reset on next restart',
                    'success'
                  );
                }}
              />
            </div>

            <Separator className="my-4" />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Auto-Save Results</Label>
                <p className="text-xs text-muted-foreground">Automatically save scan results after completion</p>
              </div>
              <Switch
                checked={settings.autoSaveResults}
                onCheckedChange={(checked) => updateSetting('autoSaveResults', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Save Scan History</Label>
                <p className="text-xs text-muted-foreground">Keep a history of all scans performed</p>
              </div>
              <Switch
                checked={settings.saveHistory}
                onCheckedChange={(checked) => updateSetting('saveHistory', checked)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="historyItems" className="text-foreground font-semibold">Max History Items</Label>
              <Input
                id="historyItems"
                type="number"
                value={settings.maxHistoryItems}
                onChange={(e) => updateSetting('maxHistoryItems', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Maximum number of scans to keep in history</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exportPath" className="text-foreground font-semibold">Export Directory</Label>
              <div className="flex gap-2">
                <Input
                  id="exportPath"
                  value={settings.exportPath}
                  onChange={(e) => updateSetting('exportPath', e.target.value)}
                  className="font-mono flex-1 bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                  placeholder="~/nmap-exports"
                />
                <button type="button" className="win7-button px-4">
                  <Folder className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Default location for exported scan results (currently uses browser downloads)</p>
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Subdomain Tools */}
        <section id="settings-subdomain" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-green-500/30">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Network className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Subdomain Enumeration</h2>
              <p className="text-xs text-muted-foreground">Subdomain discovery tool paths</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="subfinderPath" className="text-foreground font-semibold">Subfinder Path</Label>
              <Input
                id="subfinderPath"
                value={settings.subfinderPath || 'subfinder'}
                onChange={(e) => updateSetting('subfinderPath', e.target.value)}
                className="font-mono"
                placeholder="subfinder or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to subfinder binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amassPath" className="text-foreground font-semibold">Amass Path</Label>
              <Input
                id="amassPath"
                value={settings.amassPath || 'amass'}
                onChange={(e) => updateSetting('amassPath', e.target.value)}
                className="font-mono"
                placeholder="amass or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to amass binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assetfinderPath" className="text-foreground font-semibold">Assetfinder Path</Label>
              <Input
                id="assetfinderPath"
                value={settings.assetfinderPath || 'assetfinder'}
                onChange={(e) => updateSetting('assetfinderPath', e.target.value)}
                className="font-mono"
                placeholder="assetfinder or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to assetfinder binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ffufPath" className="text-foreground font-semibold">ffuf Path</Label>
              <Input
                id="ffufPath"
                value={settings.ffufPath || 'ffuf'}
                onChange={(e) => updateSetting('ffufPath', e.target.value)}
                className="font-mono"
                placeholder="ffuf or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to ffuf binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subdomainTimeout" className="text-foreground font-semibold">Subdomain Scan Timeout (seconds)</Label>
              <Input
                id="subdomainTimeout"
                type="number"
                value={settings.subdomainTimeout || 600}
                onChange={(e) => updateSetting('subdomainTimeout', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Maximum time for subdomain enumeration</p>
            </div>

            <Separator className="my-4" />

            {/* Subfinder Settings */}
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg border-2 border-border/60 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Network className="w-4 h-4 text-green-400" />
                <h3 className="text-sm font-bold text-foreground">Subfinder Options</h3>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Use All Sources</Label>
                  <p className="text-xs text-muted-foreground">Query all available data sources</p>
                </div>
                <Switch
                  checked={settings.subfinderAllSources ?? true}
                  onCheckedChange={(checked) => updateSetting('subfinderAllSources', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Recursive Search</Label>
                  <p className="text-xs text-muted-foreground">Find subdomains of subdomains</p>
                </div>
                <Switch
                  checked={settings.subfinderRecursive ?? false}
                  onCheckedChange={(checked) => updateSetting('subfinderRecursive', checked)}
                />
              </div>
            </div>

            {/* Amass Settings */}
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg border-2 border-border/60 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-green-400" />
                <h3 className="text-sm font-bold text-foreground">Amass Options</h3>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="amassMode" className="text-foreground font-semibold text-sm">Scan Mode</Label>
                <select
                  id="amassMode"
                  value={settings.amassMode || 'passive'}
                  onChange={(e) => updateSetting('amassMode', e.target.value as 'passive' | 'active')}
                  className="w-full h-9 px-3 rounded-lg border-2 border-border/60 bg-background/50 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary hover:border-border transition-all shadow-sm"
                >
                  <option value="passive">Passive (Safe, Fast)</option>
                  <option value="active">Active (Thorough, Slower)</option>
                </select>
                <p className="text-xs text-muted-foreground">Passive mode uses only OSINT sources</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Brute Force</Label>
                  <p className="text-xs text-muted-foreground">Enable DNS brute forcing</p>
                </div>
                <Switch
                  checked={settings.amassBruteForce ?? false}
                  onCheckedChange={(checked) => updateSetting('amassBruteForce', checked)}
                />
              </div>
            </div>

            {/* ffuf Settings */}
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg border-2 border-border/60 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-green-400" />
                <h3 className="text-sm font-bold text-foreground">ffuf Options</h3>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="ffufThreads" className="text-foreground font-semibold text-sm">Threads</Label>
                <Input
                  id="ffufThreads"
                  type="number"
                  value={settings.ffufThreads || 40}
                  onChange={(e) => updateSetting('ffufThreads', parseInt(e.target.value))}
                  className="font-mono h-9 bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                />
                <p className="text-xs text-muted-foreground">Number of concurrent threads</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ffufWordlist" className="text-foreground font-semibold text-sm">Wordlist Path</Label>
                <Input
                  id="ffufWordlist"
                  value={settings.ffufWordlist || ''}
                  onChange={(e) => updateSetting('ffufWordlist', e.target.value)}
                  className="font-mono h-9 text-xs bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
                  placeholder="Auto-detected in the selected runtime"
                />
                <p className="text-xs text-muted-foreground">Wordlist for subdomain fuzzing</p>
              </div>
            </div>

            {/* General Subdomain Settings */}
            <div className="space-y-3 p-4 bg-primary/5 rounded-lg border-2 border-primary/30 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">General Options</h3>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Auto DNS Resolution</Label>
                  <p className="text-xs text-muted-foreground">Automatically resolve IPs for found subdomains</p>
                </div>
                <Switch
                  checked={settings.subdomainAutoResolve ?? true}
                  onCheckedChange={(checked) => updateSetting('subdomainAutoResolve', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Remove Duplicates</Label>
                  <p className="text-xs text-muted-foreground">Filter duplicate subdomains from results</p>
                </div>
                <Switch
                  checked={settings.subdomainRemoveDuplicates ?? true}
                  onCheckedChange={(checked) => updateSetting('subdomainRemoveDuplicates', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-foreground font-semibold text-sm">Verify Alive</Label>
                  <p className="text-xs text-muted-foreground">Check if subdomains are responding</p>
                </div>
                <Switch
                  checked={settings.subdomainVerifyAlive ?? true}
                  onCheckedChange={(checked) => updateSetting('subdomainVerifyAlive', checked)}
                />
              </div>
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Nikto Configuration */}
        <section id="settings-nikto" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-orange-500/30">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Nikto Scanner</h2>
              <p className="text-xs text-muted-foreground">Web vulnerability scanner settings</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="niktoPath" className="text-foreground font-semibold">Nikto Path</Label>
              <Input
                id="niktoPath"
                value={settings.niktoPath || 'nikto'}
                onChange={(e) => updateSetting('niktoPath', e.target.value)}
                className="font-mono"
                placeholder="nikto or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to nikto binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="niktoTimeout" className="text-foreground font-semibold">Nikto Scan Timeout (seconds)</Label>
              <Input
                id="niktoTimeout"
                type="number"
                value={settings.niktoTimeout || 1800}
                onChange={(e) => updateSetting('niktoTimeout', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Maximum time for Nikto scans (default: 30 minutes)</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Enable SSL Checks</Label>
                <p className="text-xs text-muted-foreground">Perform SSL/TLS vulnerability checks</p>
              </div>
              <Switch
                checked={settings.niktoSSL ?? true}
                onCheckedChange={(checked) => updateSetting('niktoSSL', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Aggressive Mode</Label>
                <p className="text-xs text-muted-foreground">Use more aggressive scanning techniques</p>
              </div>
              <Switch
                checked={settings.niktoAggressive ?? false}
                onCheckedChange={(checked) => updateSetting('niktoAggressive', checked)}
              />
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Nuclei Configuration */}
        <section id="settings-nuclei" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-purple-500/30">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Nuclei Scanner</h2>
              <p className="text-xs text-muted-foreground">Template-based vulnerability scanner</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="nucleiPath" className="text-foreground font-semibold">Nuclei Path</Label>
              <Input
                id="nucleiPath"
                value={settings.nucleiPath || 'nuclei'}
                onChange={(e) => updateSetting('nucleiPath', e.target.value)}
                className="font-mono"
                placeholder="nuclei or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to nuclei binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nucleiTemplatesPath" className="text-foreground font-semibold">Templates Directory</Label>
              <Input
                id="nucleiTemplatesPath"
                value={settings.nucleiTemplatesPath || '~/nuclei-templates'}
                onChange={(e) => updateSetting('nucleiTemplatesPath', e.target.value)}
                className="font-mono"
                placeholder="~/nuclei-templates"
              />
              <p className="text-xs text-muted-foreground">Path to nuclei templates directory</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nucleiConcurrency" className="text-foreground font-semibold">Concurrency</Label>
              <Input
                id="nucleiConcurrency"
                type="number"
                value={settings.nucleiConcurrency || 25}
                onChange={(e) => updateSetting('nucleiConcurrency', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Number of concurrent template executions</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nucleiRateLimit" className="text-foreground font-semibold">Rate Limit (requests/second)</Label>
              <Input
                id="nucleiRateLimit"
                type="number"
                value={settings.nucleiRateLimit || 150}
                onChange={(e) => updateSetting('nucleiRateLimit', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Maximum requests per second</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Auto-Update Templates</Label>
                <p className="text-xs text-muted-foreground">Automatically update templates before scanning</p>
              </div>
              <Switch
                checked={settings.nucleiAutoUpdate ?? true}
                onCheckedChange={(checked) => updateSetting('nucleiAutoUpdate', checked)}
              />
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* DirBuster Configuration */}
        <section id="settings-dirbuster" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-yellow-500/30">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Folder className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Directory Brute Force</h2>
              <p className="text-xs text-muted-foreground">Directory and file discovery settings</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="gobusterPath" className="text-foreground font-semibold">Gobuster Path</Label>
              <Input
                id="gobusterPath"
                value={settings.gobusterPath || 'gobuster'}
                onChange={(e) => updateSetting('gobusterPath', e.target.value)}
                className="font-mono"
                placeholder="gobuster or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to gobuster binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wordlistPath" className="text-foreground font-semibold">Default Wordlist</Label>
              <Input
                id="wordlistPath"
                value={settings.wordlistPath || ''}
                onChange={(e) => updateSetting('wordlistPath', e.target.value)}
                className="font-mono"
                placeholder="Auto-detected common.txt wordlist"
              />
              <p className="text-xs text-muted-foreground">Default wordlist for directory brute forcing</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dirThreads" className="text-foreground font-semibold">Threads</Label>
              <Input
                id="dirThreads"
                type="number"
                value={settings.dirThreads || 10}
                onChange={(e) => updateSetting('dirThreads', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Number of concurrent threads</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dirTimeout" className="text-foreground font-semibold">Request Timeout (seconds)</Label>
              <Input
                id="dirTimeout"
                type="number"
                value={settings.dirTimeout || 10}
                onChange={(e) => updateSetting('dirTimeout', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Timeout for each request</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Follow Redirects</Label>
                <p className="text-xs text-muted-foreground">Follow HTTP redirects during scanning</p>
              </div>
              <Switch
                checked={settings.dirFollowRedirects ?? false}
                onCheckedChange={(checked) => updateSetting('dirFollowRedirects', checked)}
              />
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Metasploit Configuration */}
        <section id="settings-metasploit" className="mb-8 scroll-mt-8">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-red-500/30">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Metasploit Framework</h2>
              <p className="text-xs text-muted-foreground">Exploitation framework configuration</p>
            </div>
          </div>
          <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
            <div className="space-y-2">
              <Label htmlFor="msfconsolePath" className="text-foreground font-semibold">Msfconsole Path</Label>
              <Input
                id="msfconsolePath"
                value={settings.msfconsolePath || 'msfconsole'}
                onChange={(e) => updateSetting('msfconsolePath', e.target.value)}
                className="font-mono"
                placeholder="msfconsole or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to msfconsole binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="msfvenomPath" className="text-foreground font-semibold">Msfvenom Path</Label>
              <Input
                id="msfvenomPath"
                value={settings.msfvenomPath || 'msfvenom'}
                onChange={(e) => updateSetting('msfvenomPath', e.target.value)}
                className="font-mono"
                placeholder="msfvenom or an absolute executable path"
              />
              <p className="text-xs text-muted-foreground">Path to msfvenom binary</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lhost" className="text-foreground font-semibold">Default LHOST</Label>
              <Input
                id="lhost"
                value={settings.lhost || ''}
                onChange={(e) => updateSetting('lhost', e.target.value)}
                className="font-mono"
                placeholder="192.168.1.100"
              />
              <p className="text-xs text-muted-foreground">Default local host IP for reverse shells</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lport" className="text-foreground font-semibold">Default LPORT</Label>
              <Input
                id="lport"
                type="number"
                value={settings.lport || 4444}
                onChange={(e) => updateSetting('lport', parseInt(e.target.value))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Default local port for reverse shells</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-foreground font-semibold">Auto-Start Database</Label>
                <p className="text-xs text-muted-foreground">Automatically start PostgreSQL database</p>
              </div>
              <Switch
                checked={settings.msfAutoStartDB ?? true}
                onCheckedChange={(checked) => updateSetting('msfAutoStartDB', checked)}
              />
            </div>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Notifications - Using Split Component */}
        <NotificationSettingsSection
          settings={settings}
          updateSetting={updateSetting}
        />

        <Separator className="my-8" />

        {/* Save Button */}
        <div className="flex justify-end gap-3 mt-8">
           <button type="button" className="win7-button px-6 py-2" onClick={handleResetSettings}>
            Reset to Defaults
          </button>
          <button type="button"
            onClick={handleSaveSettings}
            className="win7-button px-6 py-2 bg-primary text-primary-foreground border-primary hover:bg-primary/90 transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
