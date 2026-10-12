-- =============================================================================
-- Services et tarifs: every price of the catalogue in one call (plan S3.2, « Prix »)
-- =============================================================================
-- The settings section's « Prix » card and the gap report against GOrendezvous's observed prices
-- read the whole price table at once, instead of one get_service_price call per (service,
-- title) pair. One row per active grid service and title that offers it (the grid's price for
-- that title), and one row with a null title for every other active service (the price does not
-- depend on the title). student_price_cents / reduced_price_cents: the price with that variant
-- in force on p_on, null when none applies (or when there is no base price). Definer with
-- `services.view` first, the caller's clinic only (as get_service_price).
-- =============================================================================

create function public.list_service_prices(p_on date)
returns table (service_id uuid, title_id uuid, price_cents int, student_price_cents int, reduced_price_cents int, tax_rule text, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  r record;
begin
  if not private.has_permission('services.view') then
    raise exception 'Permission refusée : services.view' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'La date est requise.' using errcode = '22023';
  end if;
  for r in
    select s.id as service_id, st.profession_title_id as title_id
      from public.services s
      left join public.service_titles st on st.org_id = s.org_id and st.service_id = s.id and s.price_source = 'grid'
     where s.org_id = v_org and s.is_active
     order by s.code, st.profession_title_id
  loop
    return query
      select r.service_id, r.title_id, b.price_cents,
             (select case when v.variant_applied then v.price_cents end from private.service_price(v_org, r.service_id, r.title_id, 'student', p_on, false) v),
             (select case when v.variant_applied then v.price_cents end from private.service_price(v_org, r.service_id, r.title_id, 'reduced', p_on, false) v),
             b.tax_rule, b.source
        from private.service_price(v_org, r.service_id, r.title_id, null, p_on, false) b;
  end loop;
end;
$$;
revoke all on function public.list_service_prices(date) from public, anon, authenticated;
grant execute on function public.list_service_prices(date) to authenticated;
