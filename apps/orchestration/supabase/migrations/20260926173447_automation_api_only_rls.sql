-- Automation data is accessed only through the authenticated API. The API uses
-- the service role for persistence and enforces ownership and state changes.
-- With RLS enabled and no client policies, authenticated/anon direct access is denied.
-- Remove the older all-action policies on projects that already ran them.
drop policy if exists "Users own automations" on public.automations;
revoke all on public.automations from anon, authenticated;

drop policy if exists "Users own automation runs" on public.automation_runs;
revoke all on public.automation_runs from anon, authenticated;

drop policy if exists "Users own automation chats" on public.automation_chats;
revoke all on public.automation_chats from anon, authenticated;

drop policy if exists "Users own automation chat messages" on public.automation_chat_messages;
revoke all on public.automation_chat_messages from anon, authenticated;
