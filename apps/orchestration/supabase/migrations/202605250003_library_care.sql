create table if not exists public.link_health_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  status text not null default 'unknown' check (status in ('ok', 'broken', 'unknown')),
  url text not null,
  final_url text,
  http_status integer,
  error_code text,
  error_message text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

create table if not exists public.item_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  remind_at timestamptz not null,
  reason text not null default 'remind_later',
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id, reason, remind_at),
  foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade
);

alter table public.link_health_checks enable row level security;
alter table public.item_reminders enable row level security;

drop policy if exists "Users own link health checks" on public.link_health_checks;
create policy "Users own link health checks"
on public.link_health_checks for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own item reminders" on public.item_reminders;
create policy "Users own item reminders"
on public.item_reminders for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists link_health_checks_user_status_idx
on public.link_health_checks(user_id, status, checked_at desc);

create index if not exists item_reminders_user_due_idx
on public.item_reminders(user_id, status, remind_at asc);
