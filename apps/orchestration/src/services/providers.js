const DEFAULT_APP_TEXT_MODEL = 'deepseek/deepseek-v4-pro';
const DEFAULT_APP_MEDIA_MODEL = 'google/gemini-3.1-flash-lite-preview';

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

function credentialOptions() {
  return {
    textProviders: TEXT_PROVIDERS,
    mediaProviders: MEDIA_PROVIDERS,
    mediaModelAllowlist: MEDIA_MODEL_ALLOWLIST,
    defaultAppTextModel: DEFAULT_APP_TEXT_MODEL,
    defaultAppMediaModel: DEFAULT_APP_MEDIA_MODEL,
  };
}

module.exports = {
  DEFAULT_APP_MEDIA_MODEL,
  DEFAULT_APP_TEXT_MODEL,
  MEDIA_MODEL_ALLOWLIST,
  MEDIA_PROVIDERS,
  PURPOSES,
  TEXT_PROVIDERS,
  assertMediaModelAllowed,
  assertProviderPurpose,
  credentialOptions,
};
