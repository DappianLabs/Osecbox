export interface AIModelPreset {
  id: string;
  label: string;
}

export interface AIProviderPreset {
  endpoint: string;
  defaultModel: string;
  models: AIModelPreset[];
}

// These are convenience choices only. The provider remains the authority for
// model availability, and the Model ID field stays editable for new or
// account-specific models.
export const AI_PROVIDER_PRESETS: Record<string, AIProviderPreset> = {
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Best)' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Fast)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Fast)' },
    ],
  },
  cloudflare: {
    endpoint: 'cloudflare',
    defaultModel: '@cf/openai/gpt-oss-120b',
    models: [
      { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B (Best)' },
      { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B (Fast)' },
    ],
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1 (Recommended)' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast)' },
      { id: 'gpt-5.2', label: 'GPT-5.2 (Reasoning)' },
    ],
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-5',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Recommended)' },
      { id: 'claude-opus-4-6', label: 'Claude Opus (Advanced)' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Fast)' },
    ],
  },
  google: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    defaultModel: 'gemini-3.5-flash',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Recommended)' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Fast)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Advanced)' },
    ],
  },
  mistral: {
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large (Latest)' },
      { id: 'mistral-small-latest', label: 'Mistral Small (Fast)' },
    ],
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openrouter/free',
    models: [
      { id: 'openrouter/free', label: 'OpenRouter Free (Automatic)' },
      { id: 'openai/gpt-4.1', label: 'OpenAI GPT-4.1' },
      { id: 'anthropic/claude-sonnet-4-5', label: 'Anthropic Claude Sonnet 4.5' },
      { id: 'google/gemini-2.5-pro', label: 'Google Gemini 2.5 Pro' },
    ],
  },
  custom: {
    endpoint: '',
    defaultModel: 'custom',
    models: [],
  },
};

export function getAIProviderPreset(provider: string): AIProviderPreset {
  return AI_PROVIDER_PRESETS[String(provider || '').toLowerCase()] || AI_PROVIDER_PRESETS.custom;
}
