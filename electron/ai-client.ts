/**
 * Universal AI Client
 * 
 * Supports ANY OpenAI-compatible API:
 * - OpenAI (GPT-4, GPT-3.5, o1)
 * - Anthropic (Claude)
 * - Groq (Llama, Mixtral)
 * - OpenRouter (any model)
 * - Local models (LM Studio, Ollama, etc.)
 * - Custom endpoints
 * 
 * Features:
 * - Function calling (tools) for context expansion
 * - Streaming support
 * - Provider-specific adaptations
 * - ✅ Retry logic with exponential backoff
 */

import { retryWithBackoff } from './utils/retry';

export interface AIConfig {
  provider: string;
  apiKey: string;
  endpoint: string;
  model: string;
  maxTokens: number;
  temperature?: number;
  accountId?: string; // For Cloudflare Workers AI
}

export interface AIChatOptions {
  maxTokens?: number;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  /** Provider-neutral id for a tool result. */
  tool_call_id?: string;
  function_call?: any;
  tool_calls?: any[];
}

export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface AIResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'function_call';
}

type AIRequestError = Error & {
  status?: number;
  code?: string;
};

function redactProviderErrorDetail(value: unknown): string {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted-private-key]')
    .replace(/(bearer\s+|basic\s+)[^\s,"']+/ig, '$1[redacted]')
    .replace(/((?:https?|ssh|ftp|ftps|postgres(?:ql)?|mysql):\/\/[^\s/@:]+:)[^\s@]+(@)/gi, '$1[redacted]$2')
    .replace(/(["'`]?\b(?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|authorization|cookie|private[_-]?key|client[_-]?secret|connection[_-]?string|docker[_-]?auth|kubeconfig[_-]?token)\b["'`]?\s*[:=]\s*)("[^"]*"|'[^']*'|`[^`]*`|[^\s,;}\]]+)/gi, '$1[redacted]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\bAIza[A-Za-z0-9_-]{25,}\b|\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bpypi-[A-Za-z0-9_-]{16,}\b/g, '[redacted-token]');
}

function createAIRequestError(provider: string, status: number, detail = ''): AIRequestError {
  const normalizedProvider = provider.toLowerCase();
  let message: string;

  if (status === 401) {
    message = normalizedProvider === 'cloudflare'
      ? 'Cloudflare rejected the API token (401). Verify the token, Account ID, and Workers AI permissions in Settings.'
      : 'Invalid API key';
  } else if (status === 402 || status === 403) {
    message = 'The provider rejected this request because of permissions, credits, or quota.';
  } else if (status === 429) {
    message = 'Rate limit exceeded. Please wait and try again.';
  } else if (status >= 500) {
    message = `${provider} is temporarily unavailable (${status}). Please try again.`;
  } else {
    const safeDetail = redactProviderErrorDetail(detail).slice(0, 500);
    message = `${provider} API error (${status})${safeDetail ? `: ${safeDetail}` : ''}`;
  }

  const error = new Error(message) as AIRequestError;
  error.status = status;
  return error;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      return String(parsed?.error?.message || parsed?.message || parsed?.error || text);
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

function normalizeOpenAIMessages(messages: AIMessage[]): any[] {
  const normalized: any[] = [];
  for (const message of messages) {
    if (message.role === 'function') {
      normalized.push({
        role: 'tool',
        tool_call_id: message.tool_call_id || message.name || 'unknown-tool-call',
        content: message.content || '',
      });
      continue;
    }

    if (message.role === 'assistant' && message.tool_calls) {
      const validToolCalls = message.tool_calls.filter((toolCall: any) =>
        toolCall && toolCall.type === 'function' && toolCall.function?.name,
      );
      if (validToolCalls.length !== message.tool_calls.length) {
        console.warn('[AIClient] Filtering malformed assistant tool calls');
      }
      if (message.tool_calls.length > 0 && validToolCalls.length === 0 && !message.content) {
        continue;
      }
      normalized.push(validToolCalls.length > 0
        ? { ...message, tool_calls: validToolCalls }
        : { ...message, tool_calls: undefined });
      continue;
    }

    normalized.push({ ...message });
  }
  return normalized;
}

function normalizeFinishReason(value: unknown): AIResponse['finishReason'] {
  if (value === 'tool_calls' || value === 'function_call') return value;
  if (value === 'length' || value === 'max_tokens' || value === 'MAX_TOKENS') return 'length';
  return 'stop';
}

function parseToolArguments(value: unknown): any {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part: any) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    }).join('');
  }
  if (value && typeof value === 'object') {
    const part = value as { text?: unknown; content?: unknown };
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
  }
  return '';
}

function normalizeMaxTokens(value: unknown, fallback = 4000): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 256
    ? Math.min(200_000, Math.floor(numeric))
    : fallback;
}

/**
 * Universal AI Client
 */
export class AIClient {
  private config: AIConfig;
  
  constructor(config: AIConfig) {
    // Credentials are commonly pasted with a trailing newline or spaces.
    // Normalize them once so the Authorization header is always valid.
    this.config = {
      ...config,
      provider: String(config.provider || '').trim(),
      apiKey: config.apiKey?.trim() || '',
      endpoint: config.endpoint?.trim() || '',
      model: config.model?.trim() || '',
      maxTokens: normalizeMaxTokens(config.maxTokens),
      temperature: Number.isFinite(Number(config.temperature))
        ? Math.max(0, Math.min(2, Number(config.temperature)))
        : undefined,
      accountId: config.accountId?.trim() || undefined,
    };
  }
  
  /**
   * Call AI with messages and optional tools
   * Includes retry logic for network errors
   */
  async chat(messages: AIMessage[], tools?: AITool[], options: AIChatOptions = {}): Promise<AIResponse> {
    const maxTokens = normalizeMaxTokens(options.maxTokens, this.config.maxTokens);
    return retryWithBackoff(
      async () => {
        const provider = this.config.provider.toLowerCase();
        
        // Provider-specific handling
        if (provider === 'anthropic' || provider === 'claude') {
          return this.callAnthropic(messages, tools, maxTokens);
        } else if (provider === 'google' || provider === 'gemini') {
          return this.callGemini(messages, tools, maxTokens);
        } else if (provider === 'mistral') {
          return this.callMistral(messages, tools, maxTokens);
        } else if (provider === 'cloudflare') {
          return this.callCloudflare(messages, tools, maxTokens);
        } else {
          // OpenAI-compatible (OpenAI, Groq, OpenRouter, local models, etc.)
          return this.callOpenAICompatible(messages, tools, this.config.endpoint, maxTokens);
        }
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        shouldRetry: (error: any) => {
          // Retry on network errors and 5xx errors
          const isNetworkError = 
            error.code === 'ECONNRESET' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED' ||
            (error.name === 'TypeError' && /fetch failed|network/i.test(error.message || ''));
          
          const isServerError = error.status >= 500 && error.status < 600;
          
          // Don't retry on auth errors (401, 403) or rate limits (429)
          const shouldNotRetry = 
            error.status === 401 ||
            error.status === 403 ||
            error.status === 429;
          
          return (isNetworkError || isServerError) && !shouldNotRetry;
        }
      }
    );
  }

  /** Stream text using the provider's native SSE format. */
  async chatStream(
    messages: AIMessage[],
    onChunk: (content: string) => void,
    options: AIChatOptions = {},
  ): Promise<AIResponse> {
    const provider = this.config.provider.toLowerCase();
    if (provider === 'cloudflare') {
      const accountId = this.config.accountId?.trim();
      if (!accountId) {
        throw new Error('Cloudflare Account ID is required for Cloudflare Workers AI');
      }
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
      return this.callOpenAICompatibleStream(messages, undefined, endpoint, options.maxTokens, onChunk);
    }

    if (provider === 'anthropic' || provider === 'claude') {
      return this.callAnthropicStream(messages, options.maxTokens, onChunk);
    }

    if (provider === 'google' || provider === 'gemini') {
      return this.callGeminiStream(messages, options.maxTokens, onChunk);
    }

    return this.callOpenAICompatibleStream(messages, undefined, this.config.endpoint, options.maxTokens, onChunk);
  }
  
  /**
   * Call OpenAI-compatible API (OpenAI, Groq, OpenRouter, local models)
   */
  private async callOpenAICompatible(
    messages: AIMessage[],
    tools?: AITool[],
    endpoint = this.config.endpoint,
    maxTokens = this.config.maxTokens,
  ): Promise<AIResponse> {
    const isReasoningModel = /^(o1|o3|o4)(-|$)/i.test(this.config.model) || /^gpt-5/i.test(this.config.model);
    const cleanMessages = normalizeOpenAIMessages(messages);
    
    const body: any = {
      model: this.config.model,
      // Reasoning models generally reject system messages in Chat Completions.
      messages: isReasoningModel
        ? cleanMessages.filter(m => m.role !== 'system')
        : cleanMessages,
    };
    
    if (isReasoningModel) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
      body.temperature = this.config.temperature ?? 0.5;
    }
    
    if (tools && tools.length > 0 && !isReasoningModel) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    
    // Add timeout protection with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal, // Enable request cancellation
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }
      
      const data: any = await response.json();
      const choice = data.choices?.[0];
      
      if (!choice) {
        throw new Error('No response from AI API');
      }
      
      // Handle tool calls
      if (choice.message?.tool_calls) {
        return {
          content: extractTextContent(choice.message.content),
          toolCalls: choice.message.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })),
          finishReason: 'tool_calls',
        };
      }
      
      // Handle legacy function_call (older OpenAI API)
      if (choice.message?.function_call) {
        return {
          content: extractTextContent(choice.message.content),
          toolCalls: [{
            id: 'legacy',
            name: choice.message.function_call.name,
            arguments: choice.message.function_call.arguments,
          }],
          finishReason: 'function_call',
        };
      }
      
      return {
        content: extractTextContent(choice.message?.content),
        finishReason: normalizeFinishReason(choice.finish_reason),
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // Handle timeout errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error('AI request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      throw error;
    }
  }

  private async callOpenAICompatibleStream(
    messages: AIMessage[],
    tools: AITool[] | undefined,
    endpoint: string,
    requestedMaxTokens: number | undefined,
    onChunk: (content: string) => void,
  ): Promise<AIResponse> {
    const maxTokens = normalizeMaxTokens(requestedMaxTokens, this.config.maxTokens);
    const isReasoningModel = /^(o1|o3|o4)(-|$)/i.test(this.config.model) || /^gpt-5/i.test(this.config.model);
    if (isReasoningModel) {
      throw new Error('Streaming is not supported for reasoning models on this endpoint');
    }

    const cleanMessages = normalizeOpenAIMessages(messages);

    const body: any = {
      model: this.config.model,
      messages: cleanMessages,
      max_tokens: maxTokens,
      temperature: this.config.temperature ?? 0.5,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') || !response.body) {
        const data: any = await response.json();
        const content = extractTextContent(data.choices?.[0]?.message?.content);
        if (content) onChunk(content);
        return {
          content,
          finishReason: normalizeFinishReason(data.choices?.[0]?.finish_reason),
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let content = '';
      let finishReason: AIResponse['finishReason'] = 'stop';

      const consumeLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;

        try {
          const parsed: any = JSON.parse(payload);
          if (parsed.error) {
            throw createAIRequestError(this.config.provider, Number(parsed.error.code) || 502, parsed.error.message || 'Streaming provider error');
          }
          const choice = parsed.choices?.[0];
          const delta = extractTextContent(choice?.delta?.content ?? parsed.response);
          if (delta.length > 0) {
            content += delta;
            onChunk(content);
          }
          if (choice?.finish_reason) {
            finishReason = normalizeFinishReason(choice.finish_reason);
          }
        } catch (error: any) {
          if (error?.status) throw error;
          // Providers can split an SSE payload across transport chunks. The
          // next read will provide the complete JSON line; ignore malformed
          // partial lines rather than interrupting the response.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (pending) consumeLine(pending);

      return { content, finishReason };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('AI request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Call Anthropic API (Claude)
   */
  private async callAnthropic(messages: AIMessage[], tools?: AITool[], maxTokens = this.config.maxTokens): Promise<AIResponse> {
    // Anthropic uses different format
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages.filter(m => m.role !== 'system');
    
    // Validate we have conversation messages
    if (conversationMessages.length === 0) {
      throw new Error('No conversation messages provided (only system message)');
    }
    
    const body: any = {
      model: this.config.model,
      max_tokens: maxTokens,
      temperature: this.config.temperature ?? 0.5,
      messages: conversationMessages.map(m => {
        // Handle assistant messages with tool calls
        if (m.role === 'assistant' && m.tool_calls) {
          return {
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.tool_calls.map((tc: any) => {
                // Handle both OpenAI format and simplified format
                const toolName = tc.function?.name || tc.name;
                const toolArgs = tc.function?.arguments || tc.arguments;
                
                return {
                  type: 'tool_use',
                  id: tc.id,
                  name: toolName,
                  input: parseToolArguments(toolArgs),
                };
              }),
            ],
          };
        }
        // Handle function/tool result messages
        if (m.role === 'function') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id || m.name || 'unknown-tool-call',
              content: m.content,
            }],
          };
        }
        // Regular messages
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        };
      }),
    };

    if (systemMessage) body.system = systemMessage;
    
    // Add tools if provided (Anthropic format)
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    
    // Add timeout protection with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
    
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal, // Enable request cancellation
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }
      
      const data: any = await response.json();
      
      // Handle tool use
      if (data.content && Array.isArray(data.content)) {
        const toolUse = data.content.find((c: any) => c.type === 'tool_use');
        if (toolUse) {
          const textContent = data.content.find((c: any) => c.type === 'text');
          return {
            content: textContent?.text || '',
            toolCalls: [{
              id: toolUse.id,
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input),
            }],
            finishReason: 'tool_calls',
          };
        }
      }
      
      // Regular response - handle both string and array content
      let content = '';
      if (typeof data.content === 'string') {
        content = data.content;
      } else if (Array.isArray(data.content)) {
        const textContent = data.content.find((c: any) => c.type === 'text');
        content = textContent?.text || '';
      }
      
      return {
        content,
        finishReason: normalizeFinishReason(data.stop_reason),
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // Handle timeout errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Anthropic request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      throw error;
    }
  }

  private async callAnthropicStream(
    messages: AIMessage[],
    requestedMaxTokens: number | undefined,
    onChunk: (content: string) => void,
  ): Promise<AIResponse> {
    const maxTokens = normalizeMaxTokens(requestedMaxTokens, this.config.maxTokens);
    const systemMessage = messages.find((message) => message.role === 'system')?.content || '';
    const conversationMessages = messages.filter((message) => message.role !== 'system');
    if (conversationMessages.length === 0) {
      throw new Error('No conversation messages provided (only system message)');
    }

    const body: any = {
      model: this.config.model,
      max_tokens: maxTokens,
      temperature: this.config.temperature ?? 0.5,
      stream: true,
      messages: conversationMessages.map((message) => {
        if (message.role === 'assistant' && message.tool_calls) {
          return {
            role: 'assistant',
            content: [
              ...(message.content ? [{ type: 'text', text: message.content }] : []),
              ...message.tool_calls.map((toolCall: any) => ({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function?.name || toolCall.name,
                input: parseToolArguments(toolCall.function?.arguments || toolCall.arguments),
              })),
            ],
          };
        }
        if (message.role === 'function') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: message.tool_call_id || message.name || 'unknown-tool-call',
              content: message.content || '',
            }],
          };
        }
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content || '',
        };
      }),
    };
    if (systemMessage) body.system = systemMessage;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }

      if (!response.body) throw new Error('Anthropic returned an empty streaming response');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let content = '';
      let finishReason: AIResponse['finishReason'] = 'stop';

      const consumeLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        try {
          const parsed: any = JSON.parse(payload);
          if (parsed.type === 'error' || parsed.error) {
            throw createAIRequestError(this.config.provider, Number(parsed.error?.status) || 502, parsed.error?.message || 'Anthropic stream failed');
          }
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            content += parsed.delta.text || '';
            if (parsed.delta.text) onChunk(content);
          }
          if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
            finishReason = normalizeFinishReason(parsed.delta.stop_reason);
          }
        } catch (error: any) {
          if (error?.status) throw error;
          // A transport chunk may end in the middle of a JSON event. The
          // pending-line buffer handles that case on the next read.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (pending) consumeLine(pending);
      return { content, finishReason };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Anthropic request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Call Gemini API (Google)
   */
  private async callGemini(messages: AIMessage[], tools?: AITool[], maxTokens = this.config.maxTokens): Promise<AIResponse> {
    // Gemini uses different format
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages.filter(m => m.role !== 'system');
    
    // Validate we have conversation messages
    if (conversationMessages.length === 0) {
      throw new Error('No conversation messages provided (only system message)');
    }
    
    // Gemini format: contents array with parts
    const contents = conversationMessages.map(m => {
      // Handle assistant messages with tool calls
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'model',
          parts: [
            ...(m.content ? [{ text: m.content }] : []),
            ...m.tool_calls.map((tc: any) => {
              // Handle both OpenAI format and simplified format
              const toolName = tc.function?.name || tc.name;
              const toolArgs = tc.function?.arguments || tc.arguments;
              
              return {
                functionCall: {
                  name: toolName,
                   args: parseToolArguments(toolArgs),
                },
              };
            }),
          ],
        };
      }
      // Handle function/tool result messages
      if (m.role === 'function') {
        let result;
        try {
          result = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        } catch {
          // If not valid JSON, wrap in object
          result = { result: m.content };
        }
        return {
          role: 'user',
          parts: [{
            functionResponse: {
               name: m.name || 'unknown-tool',
              response: result,
            },
          }],
        };
      }
      // Regular messages
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      };
    });
    
    const body: any = {
      contents,
      systemInstruction: systemMessage ? { parts: [{ text: systemMessage }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: this.config.temperature ?? 0.5,
      },
    };
    
    // Add tools if provided (Gemini format)
    if (tools && tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }
    
    // Keep the API key out of URLs, browser history, proxy logs, and errors.
    const modelEndpoint = this.config.endpoint.replace(
      /\/models\/[^/:?]+:(?:generateContent|streamGenerateContent)/,
      `/models/${this.config.model}:generateContent`,
    );
    const apiEndpoint = modelEndpoint.replace(/[?&]key=[^&]*/i, '').replace(/[?&]$/, '');
    
    // Add timeout protection with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
    
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal, // Enable request cancellation
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }
      
      const data: any = await response.json();
      const candidate = data.candidates?.[0];
      
      if (!candidate) {
        throw new Error('No response from Gemini API');
      }
      
      // Check for safety blocks
      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Gemini blocked response due to safety filters. Try rephrasing your query.');
      }
      
      // Check for recitation (copyright) blocks
      if (candidate.finishReason === 'RECITATION') {
        throw new Error('Gemini blocked response due to potential copyright content.');
      }
      
      // Handle function calls
      if (candidate.content?.parts) {
        const functionCall = candidate.content.parts.find((p: any) => p.functionCall);
        if (functionCall) {
          const textPart = candidate.content.parts.find((p: any) => p.text);
          return {
            content: textPart?.text || '',
            toolCalls: [{
              id: 'gemini_' + Date.now(),
              name: functionCall.functionCall.name,
              arguments: JSON.stringify(functionCall.functionCall.args),
            }],
            finishReason: 'tool_calls',
          };
        }
      }
      
      // Regular response
      const textPart = candidate.content?.parts?.find((p: any) => p.text);
      return {
        content: textPart?.text || '',
        finishReason: normalizeFinishReason(candidate.finishReason),
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // Handle timeout errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Gemini request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      throw error;
    }
  }

  private async callGeminiStream(
    messages: AIMessage[],
    requestedMaxTokens: number | undefined,
    onChunk: (content: string) => void,
  ): Promise<AIResponse> {
    const maxTokens = normalizeMaxTokens(requestedMaxTokens, this.config.maxTokens);
    const systemMessage = messages.find((message) => message.role === 'system')?.content || '';
    const conversationMessages = messages.filter((message) => message.role !== 'system');
    if (conversationMessages.length === 0) {
      throw new Error('No conversation messages provided (only system message)');
    }

    const contents = conversationMessages.map((message) => {
      if (message.role === 'assistant' && message.tool_calls) {
        return {
          role: 'model',
          parts: [
            ...(message.content ? [{ text: message.content }] : []),
            ...message.tool_calls.map((toolCall: any) => ({
              functionCall: {
                name: toolCall.function?.name || toolCall.name,
                args: parseToolArguments(toolCall.function?.arguments || toolCall.arguments),
              },
            })),
          ],
        };
      }
      if (message.role === 'function') {
        let result: any;
        try {
          result = JSON.parse(message.content || '{}');
        } catch {
          result = { result: message.content || '' };
        }
        return {
          role: 'user',
          parts: [{ functionResponse: { name: message.name || 'unknown-tool', response: result } }],
        };
      }
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content || '' }],
      };
    });

    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: this.config.temperature ?? 0.5,
      },
    };
    if (systemMessage) body.systemInstruction = { parts: [{ text: systemMessage }] };

    const endpoint = this.config.endpoint
      .replace(
        /\/models\/[^/:?]+:(?:generateContent|streamGenerateContent)/,
        `/models/${this.config.model}:streamGenerateContent`,
      )
      .replace(':generateContent', ':streamGenerateContent')
      .replace(/[?&]key=[^&]*/i, '')
      .replace(/[?&]$/, '');
    const separator = endpoint.includes('?') ? '&' : '?';
    const apiEndpoint = `${endpoint}${separator}alt=sse`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-goog-api-key': this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw createAIRequestError(this.config.provider, response.status, await readErrorDetail(response));
      }

      if (!response.body) throw new Error('Gemini returned an empty streaming response');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let content = '';
      let finishReason: AIResponse['finishReason'] = 'stop';
      let toolCall: { id: string; name: string; arguments: string } | undefined;

      const consumeLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        try {
          const parsed: any = JSON.parse(payload);
          const candidate = parsed.candidates?.[0];
          if (!candidate) return;
          if (candidate.finishReason === 'SAFETY') {
            throw new Error('Gemini blocked response due to safety filters. Try rephrasing your query.');
          }
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (typeof part.text === 'string') {
              content += part.text;
              onChunk(content);
            }
            if (part.functionCall) {
              toolCall = {
                id: `gemini_${Date.now()}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              };
            }
          }
          if (candidate.finishReason) finishReason = normalizeFinishReason(candidate.finishReason);
        } catch (error: any) {
          if (error?.message?.startsWith('Gemini blocked')) throw error;
          // Ignore incomplete JSON at a transport boundary.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (pending) consumeLine(pending);
      return {
        content,
        ...(toolCall ? { toolCalls: [toolCall] } : {}),
        finishReason: toolCall ? 'tool_calls' : finishReason,
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Gemini request timed out after 60 seconds. The AI service may be slow or unavailable.') as AIRequestError;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Call Mistral API
   */
  private async callMistral(messages: AIMessage[], tools?: AITool[], maxTokens = this.config.maxTokens): Promise<AIResponse> {
    // Mistral exposes the standard Chat Completions contract. Reusing the
    // adapter keeps tool-result roles, errors, retries, and finish reasons
    // consistent with OpenAI-compatible providers.
    return this.callOpenAICompatible(messages, tools, this.config.endpoint, maxTokens);
  }
  
  /**
   * Call Cloudflare Workers AI
   * Uses OpenAI-compatible endpoint
   */
  private async callCloudflare(messages: AIMessage[], tools?: AITool[], maxTokens = this.config.maxTokens): Promise<AIResponse> {
    const accountId = this.config.accountId?.trim();
    if (!accountId) {
      throw new Error('Cloudflare Account ID is required for Cloudflare Workers AI');
    }

    // Cloudflare's OpenAI-compatible endpoint takes the model in the request body.
    // Keep this endpoint local instead of mutating shared client state.
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    return await this.callOpenAICompatible(messages, tools, endpoint, maxTokens);
  }
  
  /**
   * Validate local configuration without making a network call.
   */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      const provider = this.config.provider.toLowerCase();
      if (!provider) {
        return { success: false, error: 'AI provider is required' };
      }

      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        return { success: false, error: 'API key is required' };
      }
      
      if (!this.config.model || this.config.model.trim() === '' || this.config.model === 'custom') {
        return { success: false, error: 'Model is required' };
      }

      if (provider === 'cloudflare') {
        if (this.config.endpoint !== 'cloudflare') {
          return { success: false, error: 'Cloudflare must use the built-in account-scoped endpoint' };
        }
      } else if (!this.config.endpoint || this.config.endpoint.trim() === '') {
        return { success: false, error: 'API endpoint is required' };
      } else {
        let endpoint: URL;
        try {
          endpoint = new URL(this.config.endpoint);
        } catch {
          return { success: false, error: 'API endpoint must be a valid HTTPS URL' };
        }

        const localCustomHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
        const allowsLocalHTTP = provider === 'custom' && localCustomHosts.has(endpoint.hostname);
        if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && allowsLocalHTTP)) {
          return { success: false, error: 'API endpoint must use HTTPS (HTTP is allowed only for a local custom endpoint)' };
        }
      }

      if (provider === 'cloudflare' && !this.config.accountId?.trim()) {
        return { success: false, error: 'Cloudflare Account ID is required' };
      }
      if (provider === 'cloudflare' && !/^[a-f0-9]{32}$/i.test(this.config.accountId || '')) {
        return { success: false, error: 'Cloudflare Account ID must be a 32-character hexadecimal ID' };
      }
      
      // Config looks valid
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Make one minimal provider request. Settings uses this explicit action so
   * a typo in a key, endpoint, model, or Cloudflare account is caught before
   * the user starts an analysis. The debounced settings sync intentionally
   * remains config-only so typing in a password field never creates traffic.
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const configResult = await this.test();
    if (!configResult.success) return configResult;

    try {
      const response = await this.chat([
        { role: 'user', content: 'Reply with OK only.' },
      ], undefined, { maxTokens: 256 });
      return response.content || response.toolCalls
        ? { success: true }
        : { success: false, error: 'The provider returned an empty response' };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Provider connection failed' };
    }
  }
}

/**
 * Define tools for context expansion
 */
export const CONTEXT_EXPANSION_TOOLS: AITool[] = [
  {
    type: 'function',
    function: {
      name: 'get_more_terminal_output',
      description: 'Get more lines from a specific terminal to see full command history and output',
      parameters: {
        type: 'object',
        properties: {
          terminalId: {
            type: 'string',
            description: 'Terminal ID to get output from',
          },
          maxLines: {
            type: 'number',
            description: 'Maximum number of lines to retrieve (default: 1000)',
          },
        },
        required: ['terminalId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_content',
      description: 'Search already-captured terminal output for a config or sensitive file path; returns redacted evidence only',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path or filename to locate in captured terminal output',
          },
          terminalId: {
            type: 'string',
            description: 'Scoped terminal ID, or current',
          },
          maxLines: {
            type: 'number',
            description: 'Maximum matching lines to return (default 160)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_findings_by_type',
      description: 'Get all findings of a specific type from the knowledge graph',
      parameters: {
        type: 'object',
        properties: {
          findingType: {
            type: 'string',
            enum: ['credential', 'port', 'service', 'suid', 'sudo', 'capability', 'vuln', 'writable', 'process', 'network'],
            description: 'Type of findings to retrieve',
          },
        },
        required: ['findingType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enable_heavy_context',
      description: 'Switch to heavy context mode to get comprehensive analysis with raw chunks and full history',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attack_paths',
      description: 'Get all available attack paths from current position to target (usually root)',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Target user/privilege level (default: root)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_graph',
      description: 'Search the knowledge graph for specific keywords or patterns',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (keywords, IP, username, etc.)',
          },
        },
        required: ['query'],
      },
    },
  },
];
