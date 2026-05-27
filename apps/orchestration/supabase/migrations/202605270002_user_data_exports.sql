alter table public.users
add column if not exists public_ref text,
add column if not exists updated_at timestamptz not null default now(),
add column if not exists last_seen_at timestamptz;

update public.users
set public_ref = 'usr_' || substr(replace(id::text, '-', ''), 1, 12)
where public_ref is null or public_ref = '';

alter table public.users
alter column public_ref set not null;

create unique index if not exists users_public_ref_unique_idx
on public.users(public_ref);

create table if not exists public.user_data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'building', 'ready', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  storage_bucket text,
  storage_path text,
  format text not null default 'zip' check (format in ('zip')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.user_data_export_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.user_data_export_requests(id) on delete cascade,
  category text not null,
  status text not null default 'requested' check (status in ('requested', 'building', 'ready', 'failed', 'skipped')),
  row_count integer not null default 0,
  byte_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, category)
);

create index if not exists user_data_export_requests_user_requested_idx
on public.user_data_export_requests(user_id, requested_at desc);

create index if not exists user_data_export_requests_status_idx
on public.user_data_export_requests(status, requested_at desc);

create index if not exists user_data_export_steps_request_idx
on public.user_data_export_steps(request_id, category);

alter table public.user_data_export_requests enable row level security;
alter table public.user_data_export_steps enable row level security;

drop policy if exists "Users read own data export requests" on public.user_data_export_requests;
create policy "Users read own data export requests"
on public.user_data_export_requests for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own data export requests" on public.user_data_export_requests;
create policy "Users create own data export requests"
on public.user_data_export_requests for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own data export steps" on public.user_data_export_steps;
create policy "Users read own data export steps"
on public.user_data_export_steps for select to authenticated
using (
  exists (
    select 1
    from public.user_data_export_requests requests
    where requests.id = user_data_export_steps.request_id
      and requests.user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-data-exports', 'user-data-exports', false, 314572800, array['application/zip'])
on conflict (id) do update
set public = false,
    file_size_limit = 314572800,
    allowed_mime_types = array['application/zip'];

drop policy if exists "Users read own data export files" on storage.objects;
create policy "Users read own data export files"
on storage.objects for select to authenticated
using (bucket_id = 'user-data-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
