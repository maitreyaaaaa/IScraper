import posthog from 'posthog-js'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_exceptions: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
  })
}

const SENSITIVE_KEY_RE = /(authorization|password|secret|token|api[_-]?key|credential|signature|cookie|image|body|caption|transcript|ocr|query|url|filename|path|email)/i

function sanitizeProperties(value, depth = 0) {
  if (value == null) return value
  if (depth > 4) return '[redacted:depth]'
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeProperties(entry, depth + 1))
  if (typeof value === 'object') {
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitizeProperties(entry, depth + 1)
    }
    return output
  }
  if (typeof value === 'string') return value.slice(0, 160)
  return value
}

export function captureClientEvent(event, properties = {}) {
  if (!posthogKey) return
  posthog.capture(event, sanitizeProperties(properties))
}

export function captureClientError(error, properties = {}) {
  if (!posthogKey) return
  const safeProperties = sanitizeProperties({
    ...properties,
    errorName: error?.name || 'Error',
    status: error?.status,
    requestId: error?.requestId || properties.requestId,
  })
  if (typeof posthog.captureException === 'function') {
    posthog.captureException(error instanceof Error ? error : new Error('Client error'), safeProperties)
    return
  }
  posthog.capture('client error', safeProperties)
}

export function identifyPostHogUser(session, profile) {
  const user = session?.user
  if (!posthogKey || !user?.id) return

  posthog.identify(user.id, {
    email: user.email,
    username: profile?.username,
    name: user.user_metadata?.name || user.user_metadata?.full_name,
    avatar_url: profile?.avatarUrl || user.user_metadata?.avatar_url || user.user_metadata?.picture,
  })
}

export function resetPostHogUser() {
  if (!posthogKey) return
  posthog.reset()
}
