create table if not exists public.automation_chats (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New automation' check (char_length(title) between 1 and 120),
  model text not null default 'openai/gpt-4o-mini' check (char_length(model) <= 160),
  draft jsonb,
  automation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (automation_id, user_id)
    references public.automations(id, user_id) on delete set null (automation_id)
);

create table if not exists public.automation_chat_messages (
  id uuid primary key,
  chat_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  foreign key (chat_id, user_id) references public.automation_chats(id, user_id) on delete cascade
);

alter table public.automation_chats enable row level security;
alter table public.automation_chat_messages enable row level security;
revoke all on public.automation_chats from anon, authenticated;
revoke all on public.automation_chat_messages from anon, authenticated;

drop policy if exists "Users own automation chats" on public.automation_chats;

drop policy if exists "Users own automation chat messages" on public.automation_chat_messages;

create index if not exists automation_chats_user_updated_idx
  on public.automation_chats(user_id, updated_at desc);
create index if not exists automation_chat_messages_chat_created_idx
  on public.automation_chat_messages(user_id, chat_id, created_at, id);
