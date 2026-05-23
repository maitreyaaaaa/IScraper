const DEFAULT_APP_TEXT_MODEL = 'deepseek/deepseek-v4-pro';
const DEFAULT_APP_MEDIA_MODEL = 'google/gemini-3.1-flash-lite-preview';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const OPENAI_COMPATIBLE_PROVIDER = 'openai_compatible';

const PURPOSES = ['text', 'media', 'embedding'];

const TEXT_PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    defaultModel: DEFAULT_APP_TEXT_MODEL,
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-haiku-latest',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
  },
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-1.5-flash',
  },
  glm: {
    label: 'GLM / Z.ai',
    defaultModel: 'z-ai/glm-5.1',
  },
  [OPENAI_COMPATIBLE_PROVIDER]: {
    label: 'OpenAI-compatible service',
    defaultModel: '',
    advanced: true,
  },
};

const MEDIA_MODEL_ALLOWLIST = [
  DEFAULT_APP_MEDIA_MODEL,
  'z-ai/glm-5v-turbo',
  'qwen/qwen3.6-flash',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

const MEDIA_PROVIDERS = {
  gemini: {
    label: 'Gemini API',
    defaultModel: 'gemini-1.5-flash',
    native: true,
  },
  openrouter: {
    label: 'OpenRouter direct video',
    defaultModel: DEFAULT_APP_MEDIA_MODEL,
    models: MEDIA_MODEL_ALLOWLIST,
  },
};

const PROVIDERS_BY_PURPOSE = {
  text: Object.keys(TEXT_PROVIDERS),
  media: Object.keys(MEDIA_PROVIDERS),
  embedding: ['openrouter'],
};

const EMBEDDING_PROVIDERS = {
  openrouter: {
    label: 'OpenRouter embeddings',
    defaultModel: DEFAULT_EMBEDDING_MODEL,
  },
};

function assertProviderPurpose(provider, purpose) {
  if (!PURPOSES.includes(purpose)) {
    throw new Error(`Unsupported credential purpose: ${purpose}`);
  }
  if (!PROVIDERS_BY_PURPOSE[purpose].includes(provider)) {
    throw new Error(`${provider} is not supported for ${purpose} credentials.`);
  }
}

function assertMediaModelAllowed(model) {
  if (!MEDIA_MODEL_ALLOWLIST.includes(model)) {
    throw new Error(`${model} does not support direct image and video media analysis in this app.`);
  }
}

function normalizeOpenAICompatibleBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) throw new Error('Base URL is required for OpenAI-compatible services.');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Base URL must be a valid HTTPS URL.');
  }

  if (parsed.protocol !== 'https:') throw new Error('Base URL must use HTTPS.');
  if (parsed.username || parsed.password) throw new Error('Base URL cannot include a username or password.');
  assertPublicHostname(parsed.hostname);

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  if (!parsed.pathname || parsed.pathname === '/') return parsed.origin;
  return `${parsed.origin}${parsed.pathname}`;
}

function openAICompatibleChatEndpoint(baseUrl) {
  return `${normalizeOpenAICompatibleBaseUrl(baseUrl)}/chat/completions`;
}

function normalizeOpenAICompatibleDisplayName(displayName) {
  const value = String(displayName || '').trim().replace(/\s+/g, ' ');
  return value.slice(0, 80);
}

function assertOpenAICompatibleConfig({ provider, purpose, model, baseUrl }) {
  if (provider !== OPENAI_COMPATIBLE_PROVIDER) return;
  if (purpose !== 'text') throw new Error('OpenAI-compatible services are supported for text summaries only.');
  if (!String(model || '').trim()) throw new Error('Model ID is required for OpenAI-compatible services.');
  normalizeOpenAICompatibleBaseUrl(baseUrl);
}

function assertPublicHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('Base URL must include a public hostname.');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    throw new Error('Base URL cannot point to a local or internal hostname.');
  }
  if (!host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
    throw new Error('Base URL must use a public hostname.');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isBlockedIPv4(host)) {
    throw new Error('Base URL cannot point to a private or local IP address.');
  }
  if (host.includes(':') && isBlockedIPv6(host)) {
    throw new Error('Base URL cannot point to a private or local IP address.');
  }
}

function isBlockedIPv4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIPv6(host) {
  return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
}

function credentialOptions() {
  return {
    textProviders: TEXT_PROVIDERS,
    mediaProviders: MEDIA_PROVIDERS,
    embeddingProviders: EMBEDDING_PROVIDERS,
    mediaModelAllowlist: MEDIA_MODEL_ALLOWLIST,
    defaultAppTextModel: DEFAULT_APP_TEXT_MODEL,
    defaultAppMediaModel: DEFAULT_APP_MEDIA_MODEL,
    defaultEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
  };
}

module.exports = {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_APP_MEDIA_MODEL,
  DEFAULT_APP_TEXT_MODEL,
  EMBEDDING_PROVIDERS,
  MEDIA_MODEL_ALLOWLIST,
  MEDIA_PROVIDERS,
  OPENAI_COMPATIBLE_PROVIDER,
  PURPOSES,
  TEXT_PROVIDERS,
  assertOpenAICompatibleConfig,
  assertMediaModelAllowed,
  assertProviderPurpose,
  credentialOptions,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleDisplayName,
  openAICompatibleChatEndpoint,
};
