alter table public.account_deletion_steps
add column if not exists user_id uuid;

alter table public.user_data_export_steps
add column if not exists user_id uuid;

update public.account_deletion_steps steps
set user_id = requests.user_id
from public.account_deletion_requests requests
where steps.request_id = requests.id
  and steps.user_id is null;

update public.user_data_export_steps steps
set user_id = requests.user_id
from public.user_data_export_requests requests
where steps.request_id = requests.id
  and steps.user_id is null;

alter table public.account_deletion_steps
drop constraint if exists account_deletion_steps_user_id_fkey;

alter table public.account_deletion_steps
add constraint account_deletion_steps_user_id_fkey
foreign key (user_id) references public.users(id) on delete set null;

alter table public.user_data_export_steps
drop constraint if exists user_data_export_steps_user_id_fkey;

alter table public.user_data_export_steps
add constraint user_data_export_steps_user_id_fkey
foreign key (user_id) references public.users(id) on delete cascade;

create index if not exists account_deletion_steps_user_request_idx
on public.account_deletion_steps(user_id, request_id, step_key);

create index if not exists user_data_export_steps_user_request_idx
on public.user_data_export_steps(user_id, request_id, category);

create index if not exists imports_user_created_idx
on public.imports(user_id, created_at desc);

create index if not exists collections_user_created_idx
on public.collections(user_id, created_at desc);

create index if not exists item_assets_user_item_idx
on public.item_assets(user_id, item_id);

create index if not exists user_admin_states_user_idx
on public.user_admin_states(user_id);

create unique index if not exists smart_collections_user_id_id_idx
on public.smart_collections(user_id, id);

create unique index if not exists search_events_user_id_id_idx
on public.search_events(user_id, id);

alter table public.smart_collection_items
drop constraint if exists smart_collection_items_user_collection_fkey;

alter table public.smart_collection_items
add constraint smart_collection_items_user_collection_fkey
foreign key (user_id, collection_id) references public.smart_collections(user_id, id) on delete cascade;

alter table public.search_result_feedback
drop constraint if exists search_result_feedback_user_event_fkey;

alter table public.search_result_feedback
add constraint search_result_feedback_user_event_fkey
foreign key (user_id, search_event_id) references public.search_events(user_id, id) on delete cascade;

alter table public.analysis_usage_events
drop constraint if exists analysis_usage_events_user_item_fkey;

alter table public.analysis_usage_events
add constraint analysis_usage_events_user_item_fkey
foreign key (user_id, item_id) references public.saved_items(user_id, id) on delete cascade;

comment on column public.credit_transactions.item_id is
'Optional same-user saved item reference retained for billing/support context. It is not a relational authorization boundary; access is enforced by credit_transactions.user_id RLS.';

revoke all on public.admin_credit_adjustments from anon, authenticated;
revoke all on public.user_admin_states from anon, authenticated;
revoke all on public.user_activity_events from anon, authenticated;

update storage.buckets
set public = false
where id in ('instagram-assets', 'import-uploads', 'user-data-exports');

drop policy if exists "Users read own deletion steps" on public.account_deletion_steps;
create policy "Users read own deletion steps"
on public.account_deletion_steps for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.account_deletion_requests requests
    where requests.id = account_deletion_steps.request_id
      and requests.user_id = (select auth.uid())
  )
);

drop policy if exists "Users read own data export steps" on public.user_data_export_steps;
create policy "Users read own data export steps"
on public.user_data_export_steps for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.user_data_export_requests requests
    where requests.id = user_data_export_steps.request_id
      and requests.user_id = (select auth.uid())
  )
);
