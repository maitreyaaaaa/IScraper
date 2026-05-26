-- Phase 6J draft performance indexes.
-- Reviewed before live apply: do not apply this migration to production without explicit approval.
-- Evidence source: Phase 6I/6J authenticated read and no-AI search timing.

create extension if not exists pg_trgm with schema extensions;

create index if not exists account_deletion_audit_completed_user_hash_idx
on public.account_deletion_audit(user_id_hash)
where status = 'completed';

create index if not exists account_deletion_audit_completed_email_hash_idx
on public.account_deletion_audit(email_hash)
where status = 'completed';

create index if not exists saved_items_user_created_id_idx
on public.saved_items(user_id, created_at desc, id asc);

create index if not exists saved_items_user_status_created_id_idx
on public.saved_items(user_id, status, created_at desc, id asc);

create index if not exists saved_items_user_platform_created_id_idx
on public.saved_items(user_id, platform_key, created_at desc, id asc);

create index if not exists saved_items_collections_gin_idx
on public.saved_items using gin(collections);

create index if not exists saved_items_caption_trgm_idx
on public.saved_items using gin(caption gin_trgm_ops)
where caption is not null and caption <> '';

create index if not exists saved_items_source_title_trgm_idx
on public.saved_items using gin(source_title gin_trgm_ops)
where source_title is not null and source_title <> '';

create index if not exists saved_items_source_description_trgm_idx
on public.saved_items using gin(source_description gin_trgm_ops)
where source_description is not null and source_description <> '';

create index if not exists saved_items_source_author_trgm_idx
on public.saved_items using gin(source_author gin_trgm_ops)
where source_author is not null and source_author <> '';

create index if not exists saved_items_owner_name_trgm_idx
on public.saved_items using gin(owner_name gin_trgm_ops)
where owner_name is not null and owner_name <> '';

create index if not exists saved_items_owner_username_trgm_idx
on public.saved_items using gin(owner_username gin_trgm_ops)
where owner_username is not null and owner_username <> '';
