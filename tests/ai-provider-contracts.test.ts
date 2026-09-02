import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../electron/ai-client';

const response = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const openAIResponse = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI provider HTTP contracts', () => {
  it.each([
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['mistral', 'https://api.mistral.ai/v1/chat/completions'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
  ])('%s uses the OpenAI-compatible chat contract', async (provider, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue(response(openAIResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider,
      apiKey: ' provider-key\n',
      endpoint,
      model: 'provider-model',
      maxTokens: 1000,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(requestUrl).toBe(endpoint);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer provider-key');
    expect(body).toMatchObject({ model: 'provider-model', max_tokens: 1000 });
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('uses the account-scoped Cloudflare Workers AI endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(openAIResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider: 'cloudflare',
      apiKey: 'cf-token',
      accountId: 'a'.repeat(32),
      endpoint: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
      maxTokens: 512,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cf-token');
  });

  it('uses Anthropic Messages authentication and body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-5',
      maxTokens: 512,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    expect(requestUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('anthropic-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 512 });
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('uses Gemini generateContent with the model in the path and x-goog-api-key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider: 'google',
      apiKey: 'google-key',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      model: 'gemini-3.5-flash',
      maxTokens: 512,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(requestUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('google-key');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(body.generationConfig.maxOutputTokens).toBe(512);
  });

  it('uses max_completion_tokens for OpenAI reasoning-model IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(openAIResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider: 'openai',
      apiKey: 'openai-key',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-5.4',
      maxTokens: 700,
      temperature: 0.2,
    });

    await client.chat([{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.max_completion_tokens).toBe(700);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('accepts provider response content arrays used by newer OpenAI-compatible APIs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: [{ type: 'text', text: 'ok' }] }, finish_reason: 'stop' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AIClient({
      provider: 'openrouter',
      apiKey: 'router-key',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openrouter/free',
      maxTokens: 512,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });
  });

  it('rejects unsafe provider endpoints before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const remoteHttp = new AIClient({
      provider: 'openai',
      apiKey: 'openai-key',
      endpoint: 'http://example.com/v1/chat/completions',
      model: 'gpt-4.1',
      maxTokens: 512,
    });
    await expect(remoteHttp.test()).resolves.toEqual({
      success: false,
      error: 'API endpoint must use HTTPS (HTTP is allowed only for a local custom endpoint)',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const localCustom = new AIClient({
      provider: 'custom',
      apiKey: 'local-key',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'local-model',
      maxTokens: 512,
    });
    await expect(localCustom.test()).resolves.toEqual({ success: true });
  });
});
