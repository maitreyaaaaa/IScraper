alter table public.user_provider_credentials
add column if not exists base_url text,
add column if not exists display_name text;

alter table public.user_provider_credentials
drop constraint if exists user_provider_credentials_provider_check;

alter table public.user_provider_credentials
add constraint user_provider_credentials_provider_check
check (provider in ('openrouter', 'openai', 'anthropic', 'deepseek', 'gemini', 'glm', 'openai_compatible'));
