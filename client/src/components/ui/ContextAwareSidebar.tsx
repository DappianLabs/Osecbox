/**
 * Context-Aware AI Sidebar
 * 
 * This component adapts to different section contexts instead of always using scanner context.
 * Each section gets its own isolated AI experience.
 */

import React, { useState, useRef } from 'react';
import { Bot, Send, Sparkles, Loader2, User, Zap, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { aiAnalyzer } from '@/lib/ai-analyzer';
import { useAttackState } from '@/lib/attack-state-store';
import { useSettingsStore } from '@/lib/settings-store';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';
import { useToast } from '@/components/ui/toast';

interface AIMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ContextAwareSidebarProps {
  sectionType: 'scan' | 'exploit' | 'foothold' | 'tunneling' | 'subdomains' | 'terminals';
  sectionData?: any; // Section-specific data for AI context
  scopeMode?: 'engagement' | 'focused';
  tabId?: string;
  terminalId?: string;
  target?: string;
}

export function ContextAwareSidebar({
  sectionType,
  sectionData,
  scopeMode = 'engagement',
  tabId,
  terminalId,
  target: scopeTarget,
}: ContextAwareSidebarProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  
  // ATTACK STATE V2: Get session for AI context
  const { session } = useAttackState();
  
  // TWO-MODE SYSTEM: Get current AI context mode
  const { settings } = useSettingsStore();
  const aiContextMode = settings.aiContextMode || 'ultra';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (message: Omit<AIMessage, 'id' | 'timestamp'>) => {
    const newMessage: AIMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const clearConversation = () => {
    setMessages([]);
  };

  const getSectionContext = () => {
    switch (sectionType) {
      case 'scan':
        return {
          section: 'Network Scanning',
          description: 'Nmap, Nikto, Nuclei scanning and reconnaissance',
          data: sectionData
        };
      case 'exploit':
        return {
          section: 'Exploitation',
          description: 'Metasploit modules and exploitation frameworks',
          data: sectionData
        };
      case 'foothold':
        return {
          section: 'Foothold Management',
          description: 'Reverse shells, listeners, and initial access',
          data: sectionData
        };
      case 'tunneling':
        return {
          section: 'Tunneling & Pivoting',
          description: 'Network tunneling, port forwarding, and pivoting',
          data: sectionData
        };
      case 'subdomains':
        return {
          section: 'Subdomain Enumeration',
          description: 'Subdomain discovery and reconnaissance',
          data: sectionData
        };
      case 'terminals':
        return {
          section: 'Terminal Management',
          description: 'Terminal sessions and command execution',
          data: sectionData
        };
      default:
        return {
          section: 'General',
          description: 'General pentesting assistance',
          data: sectionData
        };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userInput = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message
    addMessage({
      type: 'user',
      content: userInput,
    });

    try {
      const sectionContext = getSectionContext();
      
      console.log(`[ContextAwareSidebar] ${sectionType.toUpperCase()} AI request:`, userInput);
      
      // Use AI Analyzer with section-specific context
      const response = await aiAnalyzer.analyze({ 
        query: userInput,
        conversationHistory: [
          ...messages.map(message => ({
            role: message.type,
            content: message.content,
          })),
          { role: 'user', content: userInput },
        ],
        mode: aiContextMode,
        target: scopeTarget || session?.target_ip,
        tabId,
        terminalId,
        scopeMode,
        globalContext: scopeMode === 'engagement',
        contextScope: scopeMode === 'focused'
          ? {
            sessionId: session?.id,
            tabId,
            terminalId,
            target: scopeTarget || session?.target_ip,
          }
          : undefined,
        additionalContext: JSON.stringify({
          section: sectionContext.section,
          description: sectionContext.description,
          data: sectionContext.data,
        }, null, 2),
        attackState: {
          session,
          manager: useAttackState.getState().manager,
        },
        settings: {
          aiModel: settings.selectedModel,
          aiApiKey: settings.aiApiKey,
          aiEndpoint: settings.apiEndpoint,
          provider: settings.provider,
          cloudflareAccountId: settings.cloudflareAccountId,
        },
      });
      
      console.log(`[ContextAwareSidebar] ${sectionType.toUpperCase()} AI response received`);

      // Add assistant message
      addMessage({
        type: 'assistant',
        content: response.answer,
      });

    } catch (error: any) {
      console.error(`[ContextAwareSidebar] ${sectionType.toUpperCase()} AI error:`, error);
      
      addMessage({
        type: 'assistant',
        content: `❌ **AI Error**\n\nSorry, I encountered an error: ${error.message || 'Unknown error'}\n\nPlease try again or check your AI settings.`,
      });
      
      showToast('AI request failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      {/* Header */}
      <div className="p-4 border-b border-border bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <h3 className="font-bold text-foreground text-sm">AI Assistant</h3>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearConversation}
              className="h-6 px-2 text-xs"
              title="Clear conversation"
            >
              Clear
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {getSectionContext().description}
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-blue-500" />
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Ask me anything about {getSectionContext().section.toLowerCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                I have context about your current {sectionType} session
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-3 p-3 rounded-lg',
                  message.type === 'user'
                    ? 'bg-blue-500/10 ml-4'
                    : 'bg-muted/50 mr-4'
                )}
              >
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  message.type === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                )}>
                  {message.type === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <MarkdownMessage
                    content={message.content}
                    commandDestination="active terminal in this panel"
                  />
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${getSectionContext().section.toLowerCase()}...`}
            className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || isLoading}
            className="px-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
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
