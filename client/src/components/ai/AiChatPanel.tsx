import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Play, Loader2, Zap, Database } from 'lucide-react';
import { useScanner } from '@/lib/scanner-context';
import { useAttackState, waitForEvidenceReady, getEvidenceRevision } from '@/lib/attack-state-store';
import { buildAIContext, type ContextMode } from '@/lib/attack-state/ai-context-builder';
import { targetsMatch } from '@/lib/attack-state/command-output-store';
import { redactSensitiveText } from '@/lib/ai-data-policy';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';
import {
  getAiChatHistorySync,
  loadAiChatHistory,
  persistAiChatHistory,
} from '@/lib/ai-chat-history';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME_MESSAGE = 'Hi! I\'m OsecBox AI, your pentesting assistant.\n\nI have global context of everything you do across all sections - scanning, exploitation, enumeration, and more.\n\nAsk me anything about your current activity or any pentesting task!';

export function AiChatPanel() {
  const storedMessages = getAiChatHistorySync();
  const hydratedRef = useRef(storedMessages.length > 0);
  const [messages, setMessages] = useState<Message[]>(() => {
    return storedMessages.length > 0
      ? storedMessages
      : [{ role: 'assistant', content: WELCOME_MESSAGE }];
  });

  // IndexedDB is the large-history source of truth; localStorage is only the
  // synchronous first paint mirror used by older session files.
  useEffect(() => {
    let active = true;
    void loadAiChatHistory().then(stored => {
      if (!active) return;
      hydratedRef.current = true;
      if (stored.length > 0) setMessages(stored);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (hydratedRef.current) void persistAiChatHistory(messages);
  }, [messages]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('ultra');
  const [scopeMode, setScopeMode] = useState<'engagement' | 'focused'>('engagement');
  const [lastContextStats, setLastContextStats] = useState<{ commands: number; chars: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestGenerationRef = useRef(0);
  const { activeTabId, tabs, updateTabTarget, runScan } = useScanner();
  const activeTab = tabs.find(t => t.id === activeTabId);
  // Global cross-terminal attack state (all commands from all terminals)
  const { session, manager } = useAttackState();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const parseNmapCommand = (text: string): { command: string; target: string; flags: string[] } | null => {
    const nmapRegex = /```nmap\s*\n(nmap\s+[^\n]+)\n```/i;
    const match = text.match(nmapRegex);
    
    if (match) {
      const fullCommand = match[1].trim();
      const parts = fullCommand.replace('nmap', '').trim().split(/\s+/);
      const target = parts[parts.length - 1];
      const flags = parts.slice(0, -1);
      
      return { command: fullCommand, target, flags };
    }
    
    return null;
  };

  const executeCommand = (command: string, target: string) => {
    if (activeTab) {
      updateTabTarget(activeTab.id, target);
      // Give a moment for state to update, then run scan
      setTimeout(() => {
        runScan(activeTab.id);
      }, 100);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const question = input;
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    const requestGeneration = ++requestGenerationRef.current;
    const requestSessionId = useAttackState.getState().session?.id;

    try {
      await waitForEvidenceReady();
      const evidenceRevision = getEvidenceRevision();
      const contextSession = useAttackState.getState().session || session;
      const contextManager = useAttackState.getState().manager || manager;

      // FULL CONTEXT: Build cross-terminal context from the global attack state.
      // This reads EVERY command from EVERY terminal (scans, exploitation, enum, etc.),
      // finds the ones relevant to the question, compresses huge outputs, and includes
      // discovered hosts/loot/findings — not just the last 20 lines of the active tab.
      let scanContext = '';
      const commandOutputStore = contextManager?.commandOutputStore;
      const allOutputs = commandOutputStore?.getAllOutputs?.() || [];
      const activeTerminalId = activeTab?.id
        ? `${activeTab.id}::${activeTab.scannerType || 'nmap'}`
        : null;
      const focusedScope = {
        sessionId: contextSession?.id,
        tabId: activeTab?.id,
        terminalId: activeTerminalId || undefined,
        target: activeTab?.target || undefined,
      };
      const engagementScope = {
        sessionId: contextSession?.id,
        target: activeTab?.target || contextSession?.target_ip || undefined,
      };
      const aiContextScope = scopeMode === 'focused' ? focusedScope : engagementScope;
      const requestContextScope = scopeMode === 'focused'
        ? focusedScope
        : engagementScope;
      const hasGlobalData = Boolean(contextSession && commandOutputStore && allOutputs.length > 0);

      console.log(`[AiChatPanel] 🔍 DIAGNOSTICS:`, {
        hasSession: !!session,
        hasManager: !!manager,
        hasCommandStore: !!commandOutputStore,
        hasGetAllOutputs: !!commandOutputStore?.getAllOutputs,
        commandCount: allOutputs.length,
        mode: contextMode,
        scope: scopeMode,
      });

      if (hasGlobalData && contextSession && commandOutputStore) {
        try {
          scanContext = buildAIContext(
            contextSession,
            commandOutputStore,
            contextMode,
            question,
            scopeMode === 'focused' ? activeTerminalId || undefined : undefined,
            aiContextScope,
          );
          setLastContextStats({ commands: allOutputs.length, chars: scanContext.length });
          console.log(
            `[AiChatPanel] ✅ Built ${scopeMode} context: ${allOutputs.length} commands, ${scanContext.length} chars (${contextMode} mode)`,
          );
          // Show first 500 chars of context for debugging
        } catch (error) {
          console.error('[AiChatPanel] Failed to build global context, falling back:', error);
        }
      } else {
        console.warn('[AiChatPanel] ⚠️ No global command data available, using fallback');
      }

      // Fallback: if attack state has no data yet, use the active terminal buffer
      if (!scanContext && activeTab?.id) {
        try {
          const { terminalService } = await import('@/lib/terminal-service');
          const provenance = activeTerminalId
            ? terminalService.getTerminalProvenance?.(activeTerminalId)
            : undefined;
          const requestedTarget = activeTab?.target || contextSession?.target_ip;
          const terminalIsSafe = Boolean(
            provenance?.sessionId
            && (!contextSession?.id || provenance.sessionId === contextSession.id)
            && (!requestedTarget || Boolean(
              provenance.target && targetsMatch(requestedTarget, provenance.target),
            )),
          );
          const fullOutput = activeTerminalId && terminalIsSafe
            ? terminalService.getOutput(activeTerminalId)
            : '';
          if (fullOutput) {
            const lines = fullOutput.split('\n');
            // Send more than before; ultra keeps a lot, compact trims
            const keep = contextMode === 'ultra' ? 500 : 100;
            scanContext = redactSensitiveText(cleanANSIForDisplay(lines.slice(-keep).join('\n')));
            console.log(`[AiChatPanel] 🔄 Fallback context: ${lines.length} lines from active terminal`);
          }
        } catch (error) {
          console.warn('[AiChatPanel] Failed to get terminal buffer, using React state:', error);
          // Do not fall back to an unscoped React transcript when terminal
          // provenance is unavailable; it may belong to a prior session/run.
          scanContext = '';
        }
      }

      // Include the active scanner tail even when older records already exist.
      // Scan parsing can lag the PTY by a few milliseconds, so global context
      // must not hide the just-finished output behind a non-empty store.
      if (activeTerminalId) {
        try {
          const { terminalService } = await import('@/lib/terminal-service');
          const provenance = terminalService.getTerminalProvenance?.(activeTerminalId);
          const requestedTarget = activeTab?.target || contextSession?.target_ip;
          const targetIsSafe = Boolean(
            provenance?.sessionId
            && (!contextSession?.id || provenance.sessionId === contextSession.id)
            && (!requestedTarget || Boolean(
              provenance.target && targetsMatch(requestedTarget, provenance.target),
            )),
          );
          if (targetIsSafe) {
            const activeOutput = terminalService.getOutput(activeTerminalId) || '';
            const activeTail = cleanANSIForDisplay(activeOutput)
              .split('\n')
              .slice(-(contextMode === 'ultra' ? 260 : 120))
              .join('\n')
              .slice(-(contextMode === 'ultra' ? 5000 : 2400));
            if (activeTail && !scanContext.includes(activeTail.slice(-400))) {
              scanContext += `\n\nACTIVE TERMINAL TAIL (fresh, may not be indexed yet):\n${activeTail}`;
            }
          }
        } catch (error) {
          console.debug('[AiChatPanel] Active terminal tail unavailable:', error);
        }
      }

      if (getEvidenceRevision() !== evidenceRevision) {
        await waitForEvidenceReady();
        const refreshedOutputs = commandOutputStore?.getAllOutputs?.() || [];
        if (contextSession && commandOutputStore && refreshedOutputs.length > 0) {
          scanContext = buildAIContext(
            contextSession,
            commandOutputStore,
            contextMode,
            question,
            scopeMode === 'focused' ? activeTerminalId || undefined : undefined,
            aiContextScope,
          );
          setLastContextStats({ commands: refreshedOutputs.length, chars: scanContext.length });
        }
      }

      // Limit message history to last 10 messages to prevent huge context
      const recentMessages = messages.slice(-10);
      const providerMessages = [...recentMessages, userMessage].map(m => ({
        role: m.role,
        content: redactSensitiveText(m.content),
      }));

      let data;

      // ELECTRON MODE - Use IPC
      if (window.electron && window.electron.chatAI) {
        console.log('🚀 Using Electron IPC for AI chat');
        data = await window.electron.chatAI({
          messages: providerMessages,
          scanContext: redactSensitiveText(scanContext),
          mode: contextMode,
          contextScope: requestContextScope,
        });
      } else {
        // WEB MODE - Use HTTP API
        console.log('🌐 Using HTTP API for AI chat');
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: providerMessages,
            scanContext: redactSensitiveText(scanContext),
            mode: contextMode,
            contextScope: requestContextScope,
          }),
        });
        data = await response.json();
      }

      if (
        requestGenerationRef.current !== requestGeneration ||
        useAttackState.getState().session?.id !== requestSessionId
      ) return;

      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '❌ Error: ' + redactSensitiveText(data.error || 'AI request failed') }]);
      }
    } catch (error: any) {
      if (
        requestGenerationRef.current !== requestGeneration ||
        useAttackState.getState().session?.id !== requestSessionId
      ) return;
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Failed to get response: ' + redactSensitiveText(error?.message || 'AI request failed') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: Message, index: number) => {
    const isUser = message.role === 'user';
    const nmapCommand = parseNmapCommand(message.content);

    return (
      <div key={index} className={cn("flex gap-3 mb-3 animate-scale-in", isUser ? "justify-end" : "justify-start")}>
        {!isUser && (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 animate-fade-in">
            <Bot className="w-5 h-5 text-primary" />
          </div>
        )}
        
        <div className={cn(
          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm smooth-colors",
          isUser 
            ? "bg-primary text-primary-foreground" 
            : "bg-secondary text-secondary-foreground"
        )}>
          {nmapCommand ? (
            <div>
              <div className="whitespace-pre-wrap mb-2">
                {message.content.split('```nmap')[0]}
              </div>
              <div className="bg-black/20 rounded p-2 font-mono text-xs flex items-center justify-between gap-2">
                <code className="flex-1">{nmapCommand.command}</code>
                <button
                  type="button"
                  onClick={() => executeCommand(nmapCommand.command, nmapCommand.target)}
                  className="win7-button px-2 py-1 h-6 gap-1 text-green-600 dark:text-green-400 flex-shrink-0"
                  title="Execute this command"
                >
                  <Play className="w-3 h-3 fill-current" />
                  RUN
                </button>
              </div>
              <div className="whitespace-pre-wrap mt-2">
                {message.content.split('```')[2]?.replace(/^nmap\s*/, '')}
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap">{message.content}</div>
          )}
        </div>

        {isUser && (
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">OsecBox AI</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setContextMode(m => (m === 'ultra' ? 'compact' : 'ultra'))}
              className="win7-button px-2 py-1 h-6 gap-1 text-xs flex items-center"
              title={
                contextMode === 'ultra'
                  ? 'Ultra: sends full context from all terminals (most accurate, more tokens)'
                  : 'Compact: compresses context to save tokens (faster, cheaper)'
              }
            >
              {contextMode === 'ultra' ? (
                <Zap className="w-3 h-3 text-yellow-500" />
              ) : (
                <Database className="w-3 h-3 text-blue-500" />
              )}
              {contextMode === 'ultra' ? 'Ultra' : 'Compact'}
            </button>
            <button
              type="button"
              onClick={() => setScopeMode(current => current === 'engagement' ? 'focused' : 'engagement')}
              className="win7-button px-2 py-1 h-6 text-xs"
              title={scopeMode === 'engagement'
                ? 'Engagement: current target across terminals'
                : 'Focused: active scanner tab and terminal only'}
            >
              {scopeMode === 'engagement' ? 'Engagement' : 'Focused'}
            </button>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {session?.hosts?.size ? `${session.hosts.size} host(s) · ` : ''}
          {(() => {
            try {
              const count = manager?.commandOutputStore?.getAllOutputs?.()?.length;
              return count
                ? `tracking ${count} command(s) across all terminals`
                : 'No commands tracked yet — run scans/commands and I\'ll see them all';
            } catch {
              return 'Initializing command tracking...';
            }
          })()}
          {lastContextStats ? ` · last query: ${lastContextStats.commands} cmds, ${(lastContextStats.chars / 1000).toFixed(0)}K chars` : ''}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((msg, idx) => renderMessage(msg, idx))}
        {isLoading && (
          <div className="flex gap-2 items-center text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-border bg-secondary/20">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about scanning, exploitation, or any pentesting task..."
            className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="win7-button px-3 py-2 h-auto disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
          {messages.length > 15 && (
            <button
              type="button"
              onClick={() => setMessages([messages[0]])}
              className="win7-button px-2 py-2 h-auto text-xs"
              title="Clear chat history"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
