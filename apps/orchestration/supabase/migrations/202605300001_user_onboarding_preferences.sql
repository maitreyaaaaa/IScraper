create table if not exists public.user_onboarding_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  content_types text[] not null default '{}',
  referral_source text,
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_onboarding_preferences_content_types_allowed check (
    content_types <@ array[
      'instagram',
      'pinterest',
      'web_pages_links',
      'screenshots',
      'documents_pdfs',
      'voice_notes',
      'notes',
      'inspiration_ideas',
      'videos_social_posts'
    ]::text[]
  ),
  constraint user_onboarding_preferences_referral_source_allowed check (
    referral_source is null
    or referral_source = ''
    or referral_source in (
      'whatsapp_friend',
      'instagram',
      'youtube',
      'tiktok',
      'x_twitter',
      'reddit',
      'linkedin',
      'google_search',
      'product_hunt',
      'school_college',
      'other'
    )
  )
);

alter table public.user_onboarding_preferences enable row level security;

drop policy if exists "Users can read own onboarding preferences" on public.user_onboarding_preferences;
create policy "Users can read own onboarding preferences"
on public.user_onboarding_preferences for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own onboarding preferences" on public.user_onboarding_preferences;
create policy "Users can create own onboarding preferences"
on public.user_onboarding_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own onboarding preferences" on public.user_onboarding_preferences;
create policy "Users can update own onboarding preferences"
on public.user_onboarding_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
