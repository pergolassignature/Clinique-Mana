-- =============================================================================
-- MIGRATION: Professional Services per Title
-- =============================================================================
-- Previously, services were assigned globally to a professional.
-- Now, services are assigned PER profession title.
-- Example: A psychologist + orientation counselor can offer different services
-- for each title.
-- =============================================================================

-- Step 1: Add profession_title_key column (nullable first for migration)
alter table public.professional_services
  add column if not exists profession_title_key text;

-- Step 2: Drop old unique constraint FIRST (before inserting duplicates)
alter table public.professional_services
  drop constraint if exists professional_services_professional_id_service_id_key;

-- Step 3: Migrate existing data
-- For each existing professional_service, duplicate it for each profession title
-- the professional has. This preserves existing service assignments.
do $$
declare
  ps_row record;
  pp_row record;
  first_title boolean;
begin
  -- Loop through each existing professional_service
  for ps_row in
    select id, professional_id, service_id, is_active, created_at, updated_at
    from public.professional_services
    where profession_title_key is null
  loop
    first_title := true;

    -- For each profession title of this professional
    for pp_row in
      select profession_title_key
      from public.professional_professions
      where professional_id = ps_row.professional_id
    loop
      if first_title then
        -- Update the original row with the first title
        update public.professional_services
        set profession_title_key = pp_row.profession_title_key
        where id = ps_row.id;
        first_title := false;
      else
        -- Insert a copy for additional titles
        insert into public.professional_services
          (professional_id, service_id, profession_title_key, is_active, created_at, updated_at)
        values
          (ps_row.professional_id, ps_row.service_id, pp_row.profession_title_key,
           ps_row.is_active, ps_row.created_at, ps_row.updated_at);
      end if;
    end loop;

    -- If the professional has no profession titles, delete the orphan row
    if first_title then
      delete from public.professional_services where id = ps_row.id;
    end if;
  end loop;
end;
$$;

-- Step 4: Make column NOT NULL now that data is migrated
alter table public.professional_services
  alter column profession_title_key set not null;

-- Step 5: Add foreign key constraint
alter table public.professional_services
  add constraint professional_services_profession_title_key_fkey
  foreign key (profession_title_key)
  references public.profession_titles(key)
  on delete cascade;

-- Step 6: Add new unique constraint (professional + title + service)
alter table public.professional_services
  add constraint professional_services_professional_title_service_key
  unique(professional_id, profession_title_key, service_id);

-- Step 7: Add index for profession_title_key lookups
create index if not exists professional_services_title_idx
  on public.professional_services(profession_title_key);

-- Step 8: Update comment
comment on table public.professional_services is
  'Junction: which services each professional offers PER profession title';
comment on column public.professional_services.profession_title_key is
  'The profession title under which this service is offered';
