create index if not exists processing_jobs_status_created_idx
on public.processing_jobs(status, created_at)
where status = 'queued';
