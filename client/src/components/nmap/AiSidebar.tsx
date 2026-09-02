/**
 * AI Sidebar - Always Free
 * Full AI functionality available to all users
 */

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Loader2, User, Zap, Layers, MessageSquare, Settings, Activity, Brain, Database, FileSearch, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useScanner, AIMessage } from '@/lib/scanner-context';
import { cn } from '@/lib/utils';
import { useAttackState } from '@/lib/attack-state-store';
import { useSettingsStore } from '@/lib/settings-store';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';
import { useToast } from '@/components/ui/toast';
import { AiDiagnostics } from './AiDiagnostics';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { aiAnalyzer } from '@/lib/ai-analyzer';

// Full AI Sidebar - Always Free
export function AiSidebar() {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<'building' | 'analyzing' | 'responding' | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const forceScrollRef = useRef(false);
  const streamFrameRef = useRef<number | null>(null);
  const streamTextRef = useRef('');
  const streamedResponseRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestGenerationRef = useRef(0);
  const activeTabIdRef = useRef<string | null>(null);
  const { showToast } = useToast();
  const { tabs, activeTabId, addAIMessage, clearAIConversation, setTabs } = useScanner();
  activeTabIdRef.current = activeTabId;
  const { session, manager } = useAttackState();
  const { settings } = useSettingsStore();

  // Get current tab
  const currentTab = tabs.find(t => t.id === activeTabId);
  
  // Get mode from tab state, default to compact
  const mode = (currentTab as any)?.aiMode || 'compact';
  const scopeMode: 'engagement' | 'focused' = (currentTab as any)?.aiScope === 'focused'
    ? 'focused'
    : 'engagement';
  
  // Update mode in tab state
  const setMode = (newMode: 'compact' | 'ultra') => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab => 
      tab.id === activeTabId 
        ? { ...tab, aiMode: newMode } as any
        : tab
    ));
  };

  const setScopeMode = (newScope: 'engagement' | 'focused') => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, aiScope: newScope } as any
        : tab
    ));
  };
  
  // Get messages from scanner context (persisted across section switches)
  const messages = currentTab?.aiConversation || [];

  const getScrollViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') || null;

  const scheduleScrollToBottom = (force = false) => {
    if (force) forceScrollRef.current = true;
    if (!autoScrollRef.current && !forceScrollRef.current) return;
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const viewport = getScrollViewport();
      if (!viewport) return;

      if (autoScrollRef.current || forceScrollRef.current) {
        // Direct assignment avoids a smooth-scroll animation for every streamed
        // token, which was the source of the visible scroll lag.
        viewport.scrollTop = viewport.scrollHeight;
      }
      forceScrollRef.current = false;
    });
  };

  // Auto-scroll only while the user is already near the bottom. If they scroll
  // upward to inspect evidence, streaming must not yank the viewport away.
  useEffect(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      autoScrollRef.current = distanceFromBottom <= 72;
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    scheduleScrollToBottom();

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    scheduleScrollToBottom();
  }, [messages, streamingText, isLoading]);

  // Reveal the completed answer smoothly without blocking the main thread.
  // The final message is still stored in full, so Markdown/code blocks render
  // normally once the reveal finishes.
  const streamAssistantResponse = (content: string, isCurrent: () => boolean = () => true): Promise<void> => {
    setStreamingText('');

    if (!content) return Promise.resolve();

    return new Promise((resolve) => {
      const start = performance.now();
      // The provider response is already complete when this reveal starts;
      // keep the polished type-on effect without making a short answer feel
      // delayed by another full second.
      const duration = Math.min(700, Math.max(180, content.length * 0.35));
      let lastIndex = 0;
      let lastPaint = 0;

      const reveal = (now: number) => {
        if (!isCurrent()) {
          resolve();
          return;
        }
        const progress = Math.min(1, (now - start) / duration);
        const nextIndex = progress >= 1
          ? content.length
          : Math.min(content.length, Math.max(lastIndex, Math.floor(content.length * progress)));

        // Cap React updates at roughly 30fps while preserving a smooth reveal.
        if (nextIndex !== lastIndex && (now - lastPaint >= 32 || progress >= 1)) {
          lastIndex = nextIndex;
          lastPaint = now;
          setStreamingText(content.slice(0, nextIndex));
        }

        if (progress < 1) {
          window.requestAnimationFrame(reveal);
        } else {
          setStreamingText(content);
          resolve();
        }
      };

      window.requestAnimationFrame(reveal);
    });
  };

  // Handle message submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeTabId) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: input.trim(),
    };

    const requestGeneration = ++requestGenerationRef.current;
    const requestState = useAttackState.getState();
    const requestSessionId = requestState.session?.id;
    const requestManager = requestState.manager;
    const isCurrentRequest = () => {
      const currentState = useAttackState.getState();
      return requestGenerationRef.current === requestGeneration
        && activeTabIdRef.current === activeTabId
        && currentState.manager === requestManager
        && currentState.session?.id === requestSessionId;
    };

    addAIMessage(activeTabId, userMessage);
    setInput('');
    setIsLoading(true);
    setLoadingStage('building');
    streamedResponseRef.current = false;
    streamTextRef.current = '';

    try {
      // Stage 1: Building context
      const commandCount = manager?.commandOutputStore?.getAllOutputs?.()?.length || 0;
      if (commandCount > 0) {
        setLoadingDetails(`Reading ${commandCount} command${commandCount > 1 ? 's' : ''} from terminals...`);
      } else {
        setLoadingDetails('Scanning terminal output...');
      }
      
      // FIX: Don't duplicate user message - it's already in messages array
      // conversationHistory should contain ALL messages including the current one
      const fullHistory = [...messages, userMessage];
      
      setLoadingStage('analyzing');
      setLoadingDetails('Compressing scan data and extracting critical findings...');
      
      const analysisRequest = {
        query: userMessage.content,
        conversationHistory: fullHistory, // Already includes current message
        mode, // compact or ultra
        tabId: activeTabId,
        terminalId: `${activeTabId}::${currentTab?.scannerType || 'nmap'}`,
        target: currentTab?.target || undefined,
        additionalContext: JSON.stringify({
          target: currentTab?.target || undefined,
          scannerType: currentTab?.scannerType || 'nmap',
          scanSummary: currentTab?.scanSummary || undefined,
          structuredResults: Array.isArray(currentTab?.results) ? currentTab.results.slice(0, mode === 'compact' ? 80 : 160) : [],
          errors: Array.isArray(currentTab?.errors) ? currentTab.errors.slice(-(mode === 'compact' ? 20 : 40)) : [],
          executionContext: {
            terminalDestination: 'Active terminal beside the AI panel',
            instruction: 'Commands labeled Active terminal beside the AI panel should be pasted into the terminal currently open next to this AI panel. Commands labeled Target session shell belong in an acquired target shell instead.',
          },
        }),
        // Engagement keeps the current target's evidence across scanners,
        // shells, listeners, and tunnels; focused limits it to this tab/PTY.
        globalContext: scopeMode === 'engagement',
        scopeMode,
        contextScope: scopeMode === 'focused'
          ? {
            sessionId: session?.id,
            tabId: activeTabId,
            terminalId: `${activeTabId}::${currentTab?.scannerType || 'nmap'}`,
            target: currentTab?.target || undefined,
          }
          : {
            sessionId: session?.id,
            target: currentTab?.target || undefined,
          },
        onStreamChunk: (content: string) => {
          if (!isCurrentRequest()) return;
          if (!streamedResponseRef.current) {
            streamedResponseRef.current = true;
            setLoadingDetails('Streaming findings and recommendations...');
          }
          streamTextRef.current = content;
          if (streamFrameRef.current !== null) return;

          streamFrameRef.current = window.requestAnimationFrame(() => {
            streamFrameRef.current = null;
            setStreamingText(streamTextRef.current);
          });
        },
        attackState: { session: requestState.session, manager: requestState.manager },
        settings: {
          aiModel: settings.selectedModel,
          aiApiKey: settings.aiApiKey,
          aiEndpoint: settings.apiEndpoint,
          provider: settings.provider,
          cloudflareAccountId: settings.cloudflareAccountId,
          aiTokenLimit: settings.aiTokenLimit,
        }
      };

      setLoadingStage('responding');
      setLoadingDetails('Waiting for AI response...');
      
      // Get AI response
      (window as any).__activeAiTerminalId = `${activeTabId}::${currentTab?.scannerType || 'nmap'}`;
      const response = await aiAnalyzer.analyze(analysisRequest);
      if (!isCurrentRequest()) return;
      const answer = response.answer || 'No response from AI';

      setLoadingDetails('Writing findings and recommendations...');
      forceScrollRef.current = true;
      if (streamedResponseRef.current) {
        if (streamFrameRef.current !== null) {
          window.cancelAnimationFrame(streamFrameRef.current);
          streamFrameRef.current = null;
        }
        // Commit the cumulative stream directly; rendering the same complete
        // answer in both the transient bubble and history caused a visible
        // duplicate/re-render at the end of every response.
      } else {
        await streamAssistantResponse(answer, isCurrentRequest);
      }

      if (!isCurrentRequest()) return;
      const aiMessage: AIMessage = {
        role: 'assistant',
        content: answer,
      };

      addAIMessage(activeTabId, aiMessage);
      if (streamedResponseRef.current) setStreamingText('');
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('[AiSidebar] Analysis failed:', error);
      console.error('[AiSidebar] Error stack:', error instanceof Error ? error.stack : 'No stack');
      console.error('[AiSidebar] Settings:', {
        provider: settings.provider,
        hasApiKey: !!settings.aiApiKey,
        hasModel: !!settings.selectedModel,
        hasAccountId: !!settings.cloudflareAccountId,
      });
      showToast(
        error instanceof Error ? error.message : 'AI analysis failed',
        'error'
      );

      const errorMessage: AIMessage = {
        role: 'assistant',
        content: `💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\nCheck:\n- AI provider is selected\n- API key is entered\n- ${settings.provider === 'cloudflare' ? 'Account ID is entered' : 'Endpoint is correct'}`,
      };

      addAIMessage(activeTabId, errorMessage);
    } finally {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      setStreamingText('');
      setIsLoading(false);
      setLoadingStage(null);
      setLoadingDetails('');
    }
  };

  // Handle input key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  // Clear conversation
  const clearConversation = () => {
    if (!activeTabId) return;
    clearAIConversation(activeTabId);
    aiAnalyzer.clearCache();
  };

  return (
    <div className="flex min-w-0 flex-col h-full overflow-hidden bg-sidebar border-l border-sidebar-border">
      {/* Header */}
      <div className="flex min-h-10 items-center justify-between px-3 py-2 border-b border-sidebar-border bg-sidebar-accent/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-slate-300" />
          <span className="font-semibold text-sm text-sidebar-foreground">OsecBox AI V2</span>
          <span className="text-[10px] text-slate-300 bg-slate-500/10 px-1.5 py-0.5 rounded border border-slate-500/40">
            Free Access
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          {/* Diagnostics Toggle */}
          <Popover open={showDiagnostics} onOpenChange={setShowDiagnostics}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2" title="AI Diagnostics">
                <Activity className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="end">
              <AiDiagnostics />
            </PopoverContent>
          </Popover>

          {/* Mode Selector */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2" title="AI Mode">
                <Settings className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="end">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">AI Mode</div>
                <div className="space-y-1">
                  {[
                    { value: 'compact', label: 'Compact', icon: MessageSquare, desc: 'Fast, compressed' },
                    { value: 'ultra', label: 'Ultra', icon: Zap, desc: 'Full, uncompressed' }
                  ].map(({ value, label, icon: Icon, desc }) => (
                    <Button
                      key={value}
                      variant={mode === value ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start h-auto py-2 flex-col items-start"
                      onClick={() => setMode(value as any)}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Icon className="w-3 h-3" />
                        <span>{label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{desc}</span>
                    </Button>
                  ))}
                </div>
                <div className="border-t border-border pt-2 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Context scope</div>
                  <Button
                    variant={scopeMode === 'engagement' ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-start h-auto py-1.5 flex-col items-start"
                    onClick={() => setScopeMode('engagement')}
                  >
                    <span>Engagement</span>
                    <span className="text-[10px] text-muted-foreground">Current target across terminals</span>
                  </Button>
                  <Button
                    variant={scopeMode === 'focused' ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-start h-auto py-1.5 flex-col items-start"
                    onClick={() => setScopeMode('focused')}
                  >
                    <span>Focused</span>
                    <span className="text-[10px] text-muted-foreground">Active tab and scanner terminal</span>
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2"
            onClick={clearConversation}
            title="Clear conversation"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-5">
            <Bot className="w-12 h-12 text-slate-300 mb-3" />
            <h3 className="font-semibold text-sm text-foreground mb-2">AI Assistant Ready</h3>
            <p className="text-xs text-muted-foreground mb-4 max-w-xs">
              Ask about scan results, attack strategies, or security analysis.
            </p>
            
            <div className="space-y-2 text-left text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3 h-3 text-slate-400" />
                <span>Analyzes your scan data</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-slate-400" />
                <span>Ultra: Full outputs + graph</span>
              </div>
              <div className="flex items-center gap-2">
                <Layers className="w-3 h-3 text-slate-400" />
                <span>Compact: Compressed + critical issues</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex gap-2 text-sm',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <Bot className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                )}
                
                <div
                  className={cn(
                    'max-w-[88%] rounded-lg px-3 py-2.5',
                    message.role === 'user'
                      ? 'bg-slate-700/90 text-slate-100 border border-slate-500/40'
                      : 'bg-slate-800/80 text-slate-100 border border-slate-600/35'
                  )}
                >
                  <MarkdownMessage
                    content={message.content}
                    commandDestination="active terminal beside AI"
                  />
                </div>
                
                {message.role === 'user' && (
                  <User className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                )}
              </div>
            ))}
            
            {/* Smooth assistant response reveal */}
            {isLoading && streamingText && (
              <div className="flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
                <Bot className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                  <div className="max-w-[88%] rounded-lg px-3 py-2.5 bg-slate-800/80 text-slate-100 border border-slate-600/35">
                  <MarkdownMessage
                    content={streamingText}
                    commandDestination="active terminal beside AI"
                  />
                  <span className="inline-block w-1.5 h-4 ml-1 align-[-2px] rounded-sm bg-slate-300 animate-pulse" />
                </div>
              </div>
            )}

            {/* Multi-Agent AI Loading Animation */}
            {isLoading && !streamingText && (
              <div className="flex gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="w-8 h-8 rounded-lg bg-slate-700/40 border border-slate-500/40 flex items-center justify-center flex-shrink-0">
                  {loadingStage === 'building' && <FileSearch className="w-4 h-4 text-slate-300 animate-pulse" />}
                  {loadingStage === 'analyzing' && <Database className="w-4 h-4 text-slate-300 animate-pulse" />}
                  {loadingStage === 'responding' && <Brain className="w-4 h-4 text-slate-300 animate-pulse" />}
                  {!loadingStage && <Cpu className="w-4 h-4 text-gray-400 animate-pulse" />}
                </div>
                
                <div className="flex-1 space-y-1.5 min-w-0">
                  {/* Stable agent activity rail */}
                  <div className="space-y-1.5">
                    {[
                      { key: 'building', label: 'Reading terminals and attack state' },
                      { key: 'analyzing', label: 'Finding critical ports, services, and issues' },
                      { key: 'responding', label: 'Writing findings and next steps' },
                    ].map((stage, index) => {
                      const stageOrder = { building: 0, analyzing: 1, responding: 2 };
                      const activeIndex = loadingStage ? stageOrder[loadingStage] : 0;
                      const complete = index < activeIndex;
                      const active = index === activeIndex;

                      return (
                        <div key={stage.key} className="flex items-center gap-2 text-[10px]">
                          <span className={cn(
                            'flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] transition-all duration-300',
                            complete && 'border-slate-400/60 bg-slate-500/20 text-slate-200',
                            active && 'border-slate-300 bg-slate-500/20 text-slate-100 animate-pulse',
                            !complete && !active && 'border-muted-foreground/20 text-muted-foreground/40'
                          )}>
                            {complete ? '✓' : active ? '•' : index + 1}
                          </span>
                          <span className={cn(
                            'truncate transition-colors duration-300',
                            active ? 'text-foreground' : complete ? 'text-muted-foreground' : 'text-muted-foreground/50'
                          )}>
                            {stage.label}{active && <span className="ml-1 animate-pulse">···</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-sidebar-border px-3 py-3 flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about scan results, attack strategies..."
            className="flex-1 min-h-[36px] max-h-24 resize-none text-sm"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            size="sm" 
            disabled={!input.trim() || isLoading}
            className="px-3"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
