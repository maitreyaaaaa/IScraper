alter table public.imports
  add column if not exists request_id text,
  add column if not exists correlation_id text;

alter table public.processing_jobs
  add column if not exists request_id text,
  add column if not exists correlation_id text,
  add column if not exists source_action text;

alter table public.user_data_export_requests
  add column if not exists request_id text,
  add column if not exists correlation_id text;

alter table public.account_deletion_requests
  add column if not exists request_id text,
  add column if not exists correlation_id text;

alter table public.security_audit_events
  add column if not exists correlation_id text;

create index if not exists imports_correlation_idx
on public.imports(correlation_id, created_at desc)
where correlation_id is not null;

create index if not exists processing_jobs_correlation_idx
on public.processing_jobs(correlation_id, updated_at desc)
where correlation_id is not null;

create index if not exists user_data_export_requests_correlation_idx
on public.user_data_export_requests(correlation_id, requested_at desc)
where correlation_id is not null;

create index if not exists account_deletion_requests_correlation_idx
on public.account_deletion_requests(correlation_id, requested_at desc)
where correlation_id is not null;

create index if not exists security_audit_events_correlation_idx
on public.security_audit_events(correlation_id, created_at desc)
where correlation_id is not null;
