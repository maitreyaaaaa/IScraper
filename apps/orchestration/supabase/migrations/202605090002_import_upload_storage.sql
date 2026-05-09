insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-uploads',
  'import-uploads',
  false,
  26214400,
  array[
    'text/html',
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/json',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own import files" on storage.objects;
create policy "Users upload own import files"
on storage.objects for insert to authenticated
with check (bucket_id = 'import-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users read own import files" on storage.objects;
create policy "Users read own import files"
on storage.objects for select to authenticated
using (bucket_id = 'import-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete own import files" on storage.objects;
create policy "Users delete own import files"
on storage.objects for delete to authenticated
using (bucket_id = 'import-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
