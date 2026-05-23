create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint user_profiles_avatar_format check (
    avatar_url is null
    or avatar_url = ''
    or avatar_url ~ '^https://'
    or avatar_url ~ '^data:image/(png|jpeg|jpg|webp);base64,'
  )
);

create unique index if not exists user_profiles_username_unique_idx
on public.user_profiles (lower(username));

alter table public.user_profiles enable row level security;

drop policy if exists "Users can read own profile" on public.user_profiles;
create policy "Users can read own profile"
on public.user_profiles for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own profile" on public.user_profiles;
create policy "Users can create own profile"
on public.user_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile"
on public.user_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
