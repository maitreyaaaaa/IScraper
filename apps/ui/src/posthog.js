import posthog from 'posthog-js'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: 'identified_only',
    capture_pageview: true,
  })
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
