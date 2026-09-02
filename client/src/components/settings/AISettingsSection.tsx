import React, { useEffect, useState } from 'react';
import { Sparkles, Layers, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAIProviderPreset } from '@/lib/ai-provider-presets';

interface AISettingsSectionProps {
  settings: any;
  updateSetting: (key: string, value: any) => void | Promise<void>;
  updateSettings?: (updates: Record<string, any>) => void | Promise<void>;
  groqStatus: { configured: boolean; hasKey: boolean; verified?: boolean };
  onSaveGroqKey: () => void;
}

export function AISettingsSection({ settings, updateSetting, updateSettings, groqStatus, onSaveGroqKey }: AISettingsSectionProps) {
  const providerPreset = getAIProviderPreset(settings.provider);
  const [endpointDraft, setEndpointDraft] = useState(String(settings.apiEndpoint || ''));
  const [accountIdDraft, setAccountIdDraft] = useState(String(settings.cloudflareAccountId || ''));
  const [modelDraft, setModelDraft] = useState(String(settings.selectedModel || 'custom'));

  useEffect(() => {
    setEndpointDraft(String(settings.apiEndpoint || ''));
  }, [settings.apiEndpoint]);

  useEffect(() => {
    setAccountIdDraft(String(settings.cloudflareAccountId || ''));
  }, [settings.cloudflareAccountId]);

  useEffect(() => {
    setModelDraft(String(settings.selectedModel || 'custom'));
  }, [settings.selectedModel]);

  const commitDraft = (key: string, value: string) => {
    const normalized = value.trim();
    if (normalized !== String(settings[key] || '')) {
      void updateSetting(key, normalized);
    }
  };

  const commitProvider = (provider: string) => {
    const nextPreset = getAIProviderPreset(provider);
    setEndpointDraft(nextPreset.endpoint);
    setModelDraft(nextPreset.defaultModel);
    if (updateSettings) {
      void updateSettings({
        provider,
        apiEndpoint: nextPreset.endpoint,
        selectedModel: nextPreset.defaultModel,
      });
    } else {
      void updateSetting('provider', provider);
      void updateSetting('apiEndpoint', nextPreset.endpoint);
      void updateSetting('selectedModel', nextPreset.defaultModel);
    }
  };

  const modelSelectValue = providerPreset.models.some((model) => model.id === modelDraft)
    ? modelDraft
    : 'custom';

  return (
    <section id="settings-ai" className="mb-8 scroll-mt-8">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-primary/30">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">AI Assistant</h2>
          <p className="text-xs text-muted-foreground">Configure AI models and API settings</p>
        </div>
      </div>
      <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border shadow-lg">
        {settings.provider !== 'cloudflare' && (
          <div className="space-y-2">
            <Label htmlFor="apiEndpoint" className="text-foreground font-semibold">API Endpoint</Label>
            <Input
              id="apiEndpoint"
              value={endpointDraft}
              onChange={(e) => setEndpointDraft(e.target.value)}
              onBlur={() => commitDraft('apiEndpoint', endpointDraft)}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="https://api.groq.com/openai/v1/chat/completions"
            />
            <p className="text-xs text-muted-foreground">
              Provider endpoint. It is prefilled for the selected provider; custom endpoints can be used for local models.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="apiKey" className="text-foreground font-semibold">
            {settings.provider === 'cloudflare' ? 'Cloudflare API Token' : 'API Key'}
          </Label>
          <div className="flex gap-2">
            <Input
              id="apiKey"
              type="password"
              value={settings.aiApiKey}
              onChange={(e) => updateSetting('aiApiKey', e.target.value)}
              className="font-mono flex-1 bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder={settings.provider === 'cloudflare' ? 'cfut_...' : 'gsk_... or sk-...'}
            />
            <button type="button" onClick={onSaveGroqKey} className="win7-button px-5 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
               Test & Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {settings.provider === 'cloudflare' ? (
              <>Get your API token from <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Cloudflare Dashboard → API Tokens</a> (use "Workers AI" template)</>
            ) : settings.provider === 'groq' ? (
              <>Get your free API key from <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.groq.com</a></>
            ) : (
              <>Enter your {settings.provider} API key</>
            )}
          </p>
          {groqStatus.configured && groqStatus.verified && (
            <p className="text-xs text-green-500 font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              AI connection verified and ready
            </p>
          )}
          {groqStatus.configured && !groqStatus.verified && (
            <p className="text-xs text-amber-400 font-semibold">
              Credentials saved. Use Test &amp; Save to verify this provider.
            </p>
          )}
        </div>

        {settings.provider === 'cloudflare' && (
          <div className="space-y-2">
            <Label htmlFor="cloudflareAccountId" className="text-foreground font-semibold">Cloudflare Account ID</Label>
            <Input
              id="cloudflareAccountId"
              value={accountIdDraft}
              onChange={(e) => setAccountIdDraft(e.target.value)}
              onBlur={() => commitDraft('cloudflareAccountId', accountIdDraft)}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="1a2b3c4d5e6f7890abcdef1234567890"
            />
            <p className="text-xs text-muted-foreground">
              Get from <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Cloudflare Dashboard</a> (right sidebar)
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="provider" className="text-foreground font-semibold">Provider</Label>
          <select
            id="provider"
            value={settings.provider}
            onChange={(e) => commitProvider(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
          >
            <option value="groq">Groq (Free, Fast)</option>
            <option value="cloudflare">⚡ Cloudflare (FREE 10k/day)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="google">Google (Gemini)</option>
            <option value="mistral">Mistral AI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom Endpoint</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="model" className="text-foreground font-semibold">Model</Label>
          <select
            id="model"
            value={modelSelectValue}
            onChange={(e) => {
              const nextModel = e.target.value;
              setModelDraft(nextModel);
              void updateSetting('selectedModel', nextModel);
            }}
            className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
          >
            <option value="custom">Custom / manual model ID</option>
            {providerPreset.models.length > 0 && (
              <optgroup label={`${settings.provider} Models`}>
                {providerPreset.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="text-xs text-gray-400">
            Select the AI model to use for analysis and chat
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="modelId" className="text-foreground font-semibold">Model ID</Label>
          <Input
            id="modelId"
            value={modelDraft === 'custom' ? '' : modelDraft}
            onChange={(e) => setModelDraft(e.target.value || 'custom')}
            onBlur={() => commitDraft('selectedModel', modelDraft || 'custom')}
            className="font-mono bg-background border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            placeholder="Use the exact model ID from the provider"
          />
          <p className="text-xs text-muted-foreground">
            The list is a convenience. You can paste any current model ID supported by your provider.
          </p>
        </div>

        {/* AI Context Settings */}
        <div className="space-y-2">
          <Label htmlFor="aiTokenLimit" className="text-foreground font-semibold">Token Limit</Label>
          <Input
            id="aiTokenLimit"
            type="number"
            value={settings.aiTokenLimit}
            onChange={(e) => updateSetting('aiTokenLimit', parseInt(e.target.value) || 8000)}
            className="font-mono bg-background/50 border-2 border-border/60 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-border transition-all rounded-lg shadow-sm"
            min="1000"
            max="200000"
            step="1000"
          />
          <p className="text-xs text-muted-foreground">
            Max tokens per AI query (based on your model's limit). Default: 8000
          </p>
        </div>

        <div className="space-y-3">
          <Label className="text-foreground font-semibold text-base">Context Mode</Label>
          <p className="text-xs text-muted-foreground mb-4">Choose how the AI processes your pentest session data</p>
          
          {/* Modern Card-Based Selection */}
          <div className="grid grid-cols-2 gap-4">
            {/* Ultra Mode Card */}
            <button
              type="button"
              onClick={() => updateSetting('aiContextMode', 'ultra')}
              className={`
                group relative p-5 rounded-xl border-2 transition-all duration-300 text-left
                ${settings.aiContextMode === 'ultra'
                  ? 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20 scale-[1.02]'
                  : 'border-border bg-card hover:border-green-500/50 hover:bg-green-500/5 hover:scale-[1.01]'
                }
              `}
            >
              {/* Selected Indicator */}
              {settings.aiContextMode === 'ultra' && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              
              <div className="flex flex-col gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                  settings.aiContextMode === 'ultra' 
                    ? 'bg-green-500 text-white' 
                    : 'bg-green-500/20 text-green-400 group-hover:bg-green-500/30'
                }`}>
                  <Layers className="w-6 h-6" />
                </div>
                
                <div>
                  <h3 className="font-bold text-base text-foreground mb-1">Ultra Mode</h3>
                  <p className="text-xs text-muted-foreground mb-2">Deep analysis with 300 terminal lines</p>
                  
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px] font-semibold">COMPREHENSIVE</span>
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-semibold">300 LINES</span>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Full terminal outputs (last 300 lines)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Detailed attack state analysis</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Advanced exploitation techniques</span>
                    </div>
                  </div>
                </div>
              </div>
            </button>

            {/* Compact Mode Card */}
            <button
              type="button"
              onClick={() => updateSetting('aiContextMode', 'compact')}
              className={`
                group relative p-5 rounded-xl border-2 transition-all duration-300 text-left
                ${settings.aiContextMode === 'compact'
                  ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20 scale-[1.02]'
                  : 'border-border bg-card hover:border-blue-500/50 hover:bg-blue-500/5 hover:scale-[1.01]'
                }
              `}
            >
              {/* Selected Indicator */}
              {settings.aiContextMode === 'compact' && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              
              <div className="flex flex-col gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                  settings.aiContextMode === 'compact' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-blue-500/20 text-blue-400 group-hover:bg-blue-500/30'
                }`}>
                  <Zap className="w-6 h-6" />
                </div>
                
                <div>
                  <h3 className="font-bold text-base text-foreground mb-1">Compact Mode</h3>
                  <p className="text-xs text-muted-foreground mb-2">Fast responses with 50 terminal lines</p>
                  
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-semibold">FAST</span>
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px] font-semibold">50 LINES</span>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Recent terminal output (last 50 lines)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Quick attack state summary</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Faster response times</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>Best for complex analysis & detailed questions</span>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
