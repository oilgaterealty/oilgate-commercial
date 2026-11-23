-- v5.2: walkthrough always 10 units, plus common areas, exterior, storage and a catch-all.
-- Spaces 11-16 are non-unit areas and use the single room key 'general'.
begin;

do $$
declare t text;
begin
  foreach t in array array['commercial_walkthrough_photos','commercial_walkthrough_notes','commercial_walkthrough_videos'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_unit_number_check');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_room_check');
    execute format('alter table public.%I add constraint %I check (unit_number between 1 and 16)', t, t || '_unit_number_check');
    execute format($f$alter table public.%I add constraint %I check (room in ('kitchen','bath','bedroom_1','bedroom_2','living','general'))$f$, t, t || '_room_check');
  end loop;
end $$;

-- Walkthrough always shows 10 units, whatever the deal model says; unit 10 stays gated for tenants only.
create or replace function public.commercial_v5_valid_unit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name like 'commercial_walkthrough_%' then
    return new;
  end if;
  if new.unit_number = 10 and not exists (
    select 1 from public.commercial_models m
    where m.deal_id = new.deal_id and m.base->>'units' = '10'
  ) then
    raise exception 'Unit 10 is not enabled by the owner' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.commercial_v5_valid_unit() from public, anon;

commit;
