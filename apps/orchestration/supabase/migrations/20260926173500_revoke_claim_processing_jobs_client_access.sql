-- Historical signatures can remain after a function's arguments change. Revoke
-- browser-role access from every public overload; leave worker grants unchanged.
do $migration$
declare
  v_signature text;
  v_count integer := 0;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_processing_jobs'
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      v_signature
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Expected public.claim_processing_jobs overloads were not found';
  end if;
end;
$migration$;
