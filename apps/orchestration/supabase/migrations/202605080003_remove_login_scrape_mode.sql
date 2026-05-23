alter table public.imports
  drop constraint if exists imports_mode_check;

alter table public.imports
  add constraint imports_mode_check check (mode in ('export'));
