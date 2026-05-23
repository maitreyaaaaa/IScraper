create table if not exists public.public_feedback (
  id uuid primary key default gen_random_uuid(),
  feature text not null default 'Feature idea',
  message text not null check (char_length(message) between 3 and 500),
  display_name text not null default 'Anonymous user',
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);

alter table public.public_feedback enable row level security;

grant select, insert on table public.public_feedback to anon, authenticated;

drop policy if exists "Anyone can read visible feedback" on public.public_feedback;
create policy "Anyone can read visible feedback"
on public.public_feedback for select to anon, authenticated
using (status = 'visible');

drop policy if exists "Anyone can create anonymous feedback" on public.public_feedback;
create policy "Anyone can create anonymous feedback"
on public.public_feedback for insert to anon, authenticated
with check (
  status = 'visible'
  and display_name = 'Anonymous user'
  and char_length(message) between 3 and 500
);
