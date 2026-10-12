-- =============================================================================
-- Services et tarifs: a new rate starts after the series' last end (review of S2)
-- =============================================================================
-- « Terminer » closes a rate on a date that may be in the future. With no open rate left in the
-- series, add_service_rate_variant checked nothing, so a start before that end hit the exclusion
-- constraint (23P01) and the user read « L'enregistrement n'a pas fonctionné ». Now the start
-- must follow the series' last end too, refused in French on the field (HINT effective_from),
-- like the start after the open rate. Same signature, same grants; the body is S1's plus that check.
-- =============================================================================

create or replace function public.add_service_rate_variant(
  p_service_id uuid,
  p_variant text,
  p_title_id uuid,
  p_discount_kind text,
  p_amount_cents int,
  p_percent numeric,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.service_rate_variants;
  v_last_end date;
  v_id uuid;
  v_percent numeric := pg_catalog.round(p_percent, 2);
begin
  perform private.assert_services_manage();
  perform 1 from public.organizations o where o.id = v_org for no key update;
  if not exists (select 1 from public.services s where s.org_id = v_org and s.id = p_service_id) then
    raise exception 'Service introuvable.' using errcode = 'P0001';
  end if;
  if p_variant is null or p_variant not in ('student', 'reduced') then
    raise exception 'La variante est « Tarif étudiant » ou « Tarif réduit ».' using errcode = 'P0001', hint = 'variant';
  end if;
  if p_title_id is not null and not exists (select 1 from public.profession_titles t where t.org_id = v_org and t.id = p_title_id) then
    raise exception 'Le titre choisi n''existe pas.' using errcode = 'P0001', hint = 'title_id';
  end if;
  if p_discount_kind is null or p_discount_kind not in ('price', 'amount', 'percent') then
    raise exception 'Le rabais est un prix, un montant ou un pourcentage.' using errcode = 'P0001', hint = 'discount_kind';
  end if;
  if p_discount_kind in ('price', 'amount') and (p_amount_cents is null or p_amount_cents not between 0 and 1000000) then
    raise exception 'Le montant est compris entre 0 $ et 10 000 $.' using errcode = 'P0001', hint = 'amount_cents';
  end if;
  if p_discount_kind = 'percent' and (v_percent is null or v_percent <= 0 or v_percent > 100) then
    raise exception 'Le pourcentage est compris entre 0,01 %% et 100 %%.' using errcode = 'P0001', hint = 'percent';
  end if;

  select v.* into v_open
    from public.service_rate_variants v
   where v.org_id = v_org and v.service_id = p_service_id and v.variant = p_variant
     and v.profession_title_id is not distinct from p_title_id and v.effective_to is null;
  perform private.assert_services_start(p_effective_from, v_open.effective_from, 'La date doit être postérieure au début du tarif en vigueur, le');

  -- No open rate: the series' last rate was ended, perhaps on a coming date. Start on its end or after.
  if v_open.id is null then
    select max(v.effective_to) into v_last_end
      from public.service_rate_variants v
     where v.org_id = v_org and v.service_id = p_service_id and v.variant = p_variant
       and v.profession_title_id is not distinct from p_title_id;
    if v_last_end is not null and p_effective_from < v_last_end then
      raise exception 'La date doit être postérieure à la fin du tarif précédent, le %.', private.format_date_short_fr(v_last_end - 1)
        using errcode = 'P0001', hint = 'effective_from';
    end if;
  end if;

  if v_open.id is not null then
    update public.service_rate_variants v set effective_to = p_effective_from where v.id = v_open.id;
  end if;
  insert into public.service_rate_variants
    (org_id, service_id, variant, profession_title_id, discount_kind, amount_cents, percent, effective_from, created_by)
  values
    (v_org, p_service_id, p_variant, p_title_id, p_discount_kind,
     case when p_discount_kind = 'percent' then null else p_amount_cents end,
     case when p_discount_kind = 'percent' then v_percent end,
     p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_service_rate_variant(uuid, text, uuid, text, int, numeric, date) from public, anon, authenticated;
grant execute on function public.add_service_rate_variant(uuid, text, uuid, text, int, numeric, date) to authenticated;
