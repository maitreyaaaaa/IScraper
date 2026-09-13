const OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const COMPOSIO_INSTAGRAM_TOOL_VERSION = '20260819_00';

const WORKFLOW_SKILLS = [
  { key: 'reference_understanding', label: 'Reference understanding', role: 'Analyze hooks, scenes, pacing, format, and proof patterns.' },
  { key: 'reel_direction', label: 'Reel direction', role: 'Turn source reels into a beat sheet and generation prompt.' },
  { key: 'carousel_strategy', label: 'Carousel strategy', role: 'Build dense slide logic, retention arcs, and CTA structure.' },
  { key: 'ghostwriting', label: 'Ghostwriting', role: 'Match founder voice without generic motivational filler.' },
  { key: 'platform_governance', label: 'Platform governance', role: 'Hold publishing until approval and enforce account readiness.' },
  { key: 'schedule_ops', label: 'Schedule ops', role: 'Package jobs for recurring slots, handoff logs, and retries.' },
];

function compactText(value, maxLength = 1400) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function workflowReadiness(config = {}) {
  const instagramConnected = Boolean(config.composioApiKey && config.composioInstagramIgUserId && (config.composioInstagramConnectedAccountId || config.composioUserId || config.composioEntityId));
  const linkedinConnected = Boolean(config.composioApiKey && config.composioLinkedInConnectedAccountId);
  return {
    models: {
      text: {
        label: 'OpenRouter text model',
        configured: Boolean(config.openRouterApiKey),
        model: config.workflowTextModel || 'deepseek/deepseek-v4-pro',
      },
      media: {
        label: 'Media generation provider',
        configured: Boolean(config.workflowMediaProvider || config.workflowMediaEndpoint || config.openRouterApiKey),
        model: config.workflowMediaModel || 'google/gemini-3.1-flash-lite-preview',
      },
    },
    integrations: {
      composio: {
        label: 'Composio API',
        configured: Boolean(config.composioApiKey),
      },
      instagram: {
        label: 'Instagram Business or Creator',
        configured: instagramConnected,
        requiredAccount: 'Business or Creator account',
      },
      linkedin: {
        label: 'LinkedIn',
        configured: linkedinConnected,
      },
    },
    canPublishInstagram: instagramConnected,
    canPublishLinkedIn: linkedinConnected,
    approvalRequired: true,
  };
}

function referenceSnippet(item) {
  const analysis = item?.analysis || {};
  return {
    id: item?.id || '',
    title: compactText(item?.sourceTitle || analysis.title || item?.caption || 'Saved reference', 120),
    platform: compactText(item?.platform || 'Reference', 40),
    contentType: compactText(item?.contentType || 'post', 40),
    url: compactText(item?.url || '', 240),
    caption: compactText(item?.caption || item?.sourceDescription || analysis.summary, 500),
    transcript: compactText(analysis.transcript, 700),
    visualDescription: compactText(analysis.visualDescription || analysis.ocrText, 700),
    tags: (analysis.tags || item?.hashtags || []).slice(0, 8),
  };
}

function selectedReferencesFromItems(items = [], referenceIds = []) {
  const wanted = new Set((referenceIds || []).map(String));
  return (items || [])
    .filter((item) => wanted.has(String(item.id)))
    .slice(0, 4)
    .map(referenceSnippet);
}

function fallbackWorkflowPlan(input = {}, readiness = workflowReadiness()) {
  const format = input.format || 'reel';
  const platforms = input.platforms?.length ? input.platforms : ['instagram'];
  const references = input.references?.length ? input.references : [
    { title: 'Reference A', contentType: 'reel', visualDescription: 'Pacing, proof, and hook source.' },
    { title: 'Reference B', contentType: 'image', visualDescription: 'Visual language and carousel structure source.' },
  ];
  const campaign = compactText(input.brief, 180) || 'Turn saved references into a publishable content workflow';
  return {
    id: `wf_${Date.now().toString(36)}`,
    name: format === 'carousel' ? 'Reference-led carousel publisher' : format === 'linkedin' ? 'Founder story ghostwriter' : 'Reference-led reel publisher',
    status: 'draft',
    campaign,
    aiMode: readiness.models.text.configured ? 'model_unavailable_fallback' : 'deterministic_fallback',
    platforms,
    format,
    references,
    skills: WORKFLOW_SKILLS.filter((skill) => (
      format === 'carousel' ? skill.key !== 'reel_direction' : skill.key !== 'carousel_strategy'
    )),
    stages: [
      { key: 'intake', label: 'Intake', state: 'ready', owner: 'Workflow agent', detail: 'Collect the goal, audience, references, offer, and approval rules.' },
      { key: 'understand', label: 'Understand references', state: references.length >= 2 ? 'ready' : 'needs_input', owner: 'Reference analyst', detail: 'Extract hook, pacing, visual grammar, objection, proof, and CTA patterns from saved reels or images.' },
      { key: 'generate', label: 'Generate asset brief', state: 'ready', owner: 'Creative director', detail: 'Create a media prompt, storyboard, caption, hashtags, and generation settings for the selected format.' },
      { key: 'review', label: 'Approval queue', state: 'blocked_until_approved', owner: 'Human reviewer', detail: 'Hold the final caption, asset, schedule, and destination until the user approves.' },
      { key: 'publish', label: 'Publish', state: readiness.canPublishInstagram || readiness.canPublishLinkedIn ? 'ready_after_approval' : 'needs_connection', owner: 'Composio dispatcher', detail: 'Execute the Instagram or LinkedIn tool only after approval and connection readiness.' },
      { key: 'learn', label: 'Learn', state: 'planned', owner: 'Performance analyst', detail: 'Capture post URL, platform result, comments, and performance notes back into campaign memory.' },
    ],
    assetPrompt: [
      `Create a ${format} for ${campaign}.`,
      `Blend the retention mechanics from: ${references.map((item) => item.title).join(' + ') || 'the selected references'}.`,
      'Keep the output concrete, high-contrast, founder-grade, and free of generic agency language.',
    ].join(' '),
    caption: `Built from the best parts of the references: ${campaign}. Save this if you are turning messy inspiration into a repeatable content machine.`,
    hashtags: ['#contentworkflow', '#instagrammarketing', '#aiautomation', '#creatorops', '#iscraper'],
    schedule: {
      cadence: input.cadence || 'weekly',
      timezone: input.timezone || 'Asia/Calcutta',
      approvalWindow: 'manual approval before each publish',
    },
    governance: [
      'No external publish without explicit approval.',
      'Use Instagram Business or Creator accounts only.',
      'Store API keys server-side only.',
      'Log each generated draft, approval, schedule, and publish result.',
    ],
    publishPackage: {
      caption: `Built from reference memory: ${campaign}`,
      mediaPrompt: `Vertical 9:16 ${format} with sharp hook, proof-led middle, and clear close. Use reference signals, not copied assets.`,
      platforms,
      requires: ['generatedMediaUrl', 'approvedByUser', 'connectedComposioAccount'],
    },
  };
}

function buildWorkflowPrompt(input = {}) {
  return [
    {
      role: 'system',
      content: [
        'You are IScraper Workflow Studio, a power-user content operations agent.',
        'Build approval-gated workflows for Instagram Reels, Instagram carousels, and LinkedIn posts.',
        'Use references as inspiration signals only. Do not claim ownership, do not copy protected content, and do not publish automatically.',
        'Return valid JSON only with keys: name,status,campaign,platforms,format,skills,stages,assetPrompt,caption,hashtags,schedule,governance,publishPackage.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        brief: compactText(input.brief, 1000),
        format: input.format || 'reel',
        platforms: input.platforms || ['instagram'],
        cadence: input.cadence || 'weekly',
        references: (input.references || []).slice(0, 4),
      }),
    },
  ];
}

function normalizePlan(raw, input, readiness) {
  const fallback = fallbackWorkflowPlan(input, readiness);
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    ...fallback,
    ...raw,
    id: fallback.id,
    status: 'draft',
    aiMode: 'openrouter',
    platforms: Array.isArray(raw.platforms) && raw.platforms.length ? raw.platforms : fallback.platforms,
    references: input.references || fallback.references,
    skills: Array.isArray(raw.skills) && raw.skills.length ? raw.skills : fallback.skills,
    stages: Array.isArray(raw.stages) && raw.stages.length ? raw.stages : fallback.stages,
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.slice(0, 18) : fallback.hashtags,
    governance: Array.isArray(raw.governance) && raw.governance.length ? raw.governance : fallback.governance,
  };
}

function parseJsonContent(content) {
  return JSON.parse(String(content || '').replace(/```json|```/g, '').trim());
}

async function generateWorkflowPlan({ config, input, fetchImpl = fetch }) {
  const readiness = workflowReadiness(config);
  const cleanInput = {
    brief: compactText(input?.brief, 1000),
    format: ['reel', 'carousel', 'linkedin'].includes(input?.format) ? input.format : 'reel',
    platforms: Array.isArray(input?.platforms) && input.platforms.length ? input.platforms.map((entry) => compactText(entry, 32)).slice(0, 3) : ['instagram'],
    cadence: compactText(input?.cadence, 80) || 'weekly',
    timezone: compactText(input?.timezone, 80) || 'Asia/Calcutta',
    references: (input?.references || []).slice(0, 4).map(referenceSnippet),
  };
  if (!config.openRouterApiKey) {
    return fallbackWorkflowPlan(cleanInput, readiness);
  }

  const response = await fetchImpl(OPENROUTER_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.appUrl || 'http://localhost:5173',
      'X-Title': 'IScraper Workflows',
    },
    body: JSON.stringify({
      model: config.workflowTextModel,
      temperature: 0.35,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      messages: buildWorkflowPrompt(cleanInput),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return fallbackWorkflowPlan(cleanInput, readiness);
  const rawPlan = parseJsonContent(body?.choices?.[0]?.message?.content || '{}');
  return normalizePlan(rawPlan, cleanInput, readiness);
}

function composioExecutionReadiness({ config, payload = {} }) {
  const readiness = workflowReadiness(config);
  const platform = payload.platform || 'instagram';
  const connectedAccountId = platform === 'linkedin'
    ? config.composioLinkedInConnectedAccountId
    : config.composioInstagramConnectedAccountId;
  const igUserId = config.composioInstagramIgUserId;
  const missing = [];
  if (!config.composioApiKey) missing.push('COMPOSIO_API_KEY');
  if (!config.composioUserId && !config.composioEntityId && !connectedAccountId) missing.push(platform === 'linkedin' ? 'COMPOSIO_LINKEDIN_CONNECTED_ACCOUNT_ID' : 'COMPOSIO_USER_ID or COMPOSIO_ENTITY_ID');
  if (platform === 'instagram' && !igUserId) missing.push('COMPOSIO_INSTAGRAM_IG_USER_ID');
  if (platform === 'instagram' && !payload.mediaUrl && !payload.creationId) missing.push('generatedMediaUrl or creationId');
  if (!payload.approved) missing.push('explicit approval');
  return {
    ready: missing.length === 0,
    missing,
    readiness,
    connectedAccountId,
    igUserId,
  };
}

function instagramToolForPayload(payload = {}, execution = {}) {
  if (payload.creationId) return {
    toolSlug: 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
    arguments: {
      ig_user_id: execution.igUserId,
      creation_id: payload.creationId,
      max_wait_seconds: 120,
      poll_interval_seconds: 3,
    },
  };
  const argumentsPayload = {
    ig_user_id: execution.igUserId,
    caption: compactText(payload.caption, 2200),
    media_type: payload.format === 'reel' ? 'REELS' : payload.format === 'carousel' ? 'CAROUSEL' : undefined,
  };
  if (payload.format === 'reel') {
    argumentsPayload.video_url = payload.mediaUrl;
    argumentsPayload.share_to_feed = true;
  } else {
    argumentsPayload.image_url = payload.mediaUrl;
  }
  return {
    toolSlug: 'INSTAGRAM_POST_IG_USER_MEDIA',
    arguments: Object.fromEntries(Object.entries(argumentsPayload).filter(([, value]) => value !== undefined && value !== '')),
  };
}

async function executeApprovedPublish({ config, payload, fetchImpl = fetch }) {
  const execution = composioExecutionReadiness({ config, payload });
  if (!execution.ready) {
    return {
      status: 'blocked',
      message: 'Publishing is blocked until the missing setup is complete.',
      missing: execution.missing,
      readiness: execution.readiness,
    };
  }

  if (payload.platform !== 'instagram') {
    return {
      status: 'prepared',
      message: 'LinkedIn execution is prepared; set a LinkedIn Composio tool slug before dispatch.',
      missing: ['linkedin tool mapping'],
      readiness: execution.readiness,
    };
  }

  const tool = instagramToolForPayload(payload, execution);
  const baseUrl = String(config.composioBaseUrl || 'https://backend.composio.dev').replace(/\/$/, '').replace(/\/api\/v3$/, '');
  const body = {
    action: tool.toolSlug,
    entityId: config.composioEntityId || config.composioUserId,
    user_uuid: config.composioEntityId || config.composioUserId,
    connectedAccountId: execution.connectedAccountId || undefined,
    connected_account_id: execution.connectedAccountId || undefined,
    input: tool.arguments,
  };
  const response = await fetchImpl(`${baseUrl}/api/v3/tools/execute`, {
    method: 'POST',
    headers: {
      'x-api-key': config.composioApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || responseBody?.successful === false) {
    return {
      status: 'failed',
      message: response.status === 401 ? 'Composio rejected the execution request. Check entity/account mapping for this API key.' : responseBody?.error || responseBody?.message || `Composio publish failed with ${response.status}`,
      logId: responseBody?.log_id || '',
      readiness: execution.readiness,
    };
  }
  return {
    status: 'submitted',
    message: 'Composio accepted the approved publish job.',
    toolSlug: tool.toolSlug,
    result: responseBody?.data || responseBody,
    logId: responseBody?.log_id || '',
    readiness: execution.readiness,
  };
}

module.exports = {
  WORKFLOW_SKILLS,
  executeApprovedPublish,
  generateWorkflowPlan,
  selectedReferencesFromItems,
  workflowReadiness,
};
