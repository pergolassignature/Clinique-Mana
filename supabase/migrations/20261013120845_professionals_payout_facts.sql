-- =============================================================================
-- Professionnels: what Facturation's payroll (FPay) reads, published as private helpers
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FPay)
-- Answers:   docs/research/2026-10-12-christine-answers.md (14: « Paie des professionnels »)
-- Decisions: P4-151 (Facturation pays at the rate in force), P4-180 – P4-194 (the program), FPay-*
--
-- The payroll job and RPCs (billing module) price a professional's sessions by the retention
-- program and read the clinic's other rates without reading this module's tables (CLAUDE.md §5)
-- and without a user (`get_professional_compensation` needs `professionals.compensation`). For
-- definer callers after their own permission check, with the org they verified; granted to no
-- role. Another clinic's ids answer nothing.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_payout_facts', true);

-- What a session of p_duration minutes with p_client on p_on pays the professional:
--   agreement  an « Entente particulière » in force for that client and duration: its amounts,
--              the retention does not apply (P4-185);
--   grid       the client price of her primary title's grid in force on p_on for that duration,
--              less the retention applied on p_on (`retention_pay_cents`, to the cent);
--   no_title   no primary title (« Profession à confirmer »);
--   no_price   no grid in force for the title on p_on, or no price for that duration;
--   no_rate    a price but no retention decided on p_on (« Taux de départ à fixer »).
-- Every source but agreement and grid has a null pay: the period cannot be validated until it
-- is fixed in Professionnels and the period recalculated.
create function private.professional_session_pay(
  p_org uuid, p_professional uuid, p_client uuid, p_duration smallint, p_on date
)
returns table (
  title_id uuid, title_name text, client_price_cents int, retention_pct numeric, pay_cents int, source text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_title uuid;
  v_title_name text;
  v_price int;
  v_pct numeric;
  v_agreement record;
begin
  if not exists (select 1 from public.professionals p where p.org_id = p_org and p.id = p_professional) then
    return;
  end if;
  select pt.id, pt.name into v_title, v_title_name
    from public.professional_professions pp
    join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
   where pp.org_id = p_org and pp.professional_id = p_professional and pp.is_primary
   limit 1;

  if p_client is not null then
    select a.client_price_cents, a.professional_amount_cents into v_agreement
      from public.professional_client_agreements a
     where a.org_id = p_org and a.professional_id = p_professional and a.client_id = p_client
       and a.duration = p_duration
       and a.effective_from <= p_on and (a.effective_to is null or p_on < a.effective_to)
     limit 1;
    if found then
      return query select v_title, v_title_name, v_agreement.client_price_cents, null::numeric,
                          v_agreement.professional_amount_cents, 'agreement'::text;
      return;
    end if;
  end if;

  if v_title is null then
    return query select null::uuid, null::text, null::int, null::numeric, null::int, 'no_title'::text;
    return;
  end if;
  v_price := private.grid_client_price(p_org, v_title, p_duration, p_on);
  if v_price is null then
    return query select v_title, v_title_name, null::int, null::numeric, null::int, 'no_price'::text;
    return;
  end if;
  select r.retention_pct into v_pct
    from public.professional_retention r
   where r.org_id = p_org and r.professional_id = p_professional
     and r.effective_from <= p_on and (r.effective_to is null or p_on < r.effective_to);
  if v_pct is null then
    return query select v_title, v_title_name, v_price, null::numeric, null::int, 'no_rate'::text;
    return;
  end if;
  return query select v_title, v_title_name, v_price, v_pct, private.retention_pay_cents(v_price, v_pct), 'grid'::text;
end;
$$;
revoke all on function private.professional_session_pay(uuid, uuid, uuid, smallint, date)
  from public, anon, authenticated, service_role;

-- The clinic's retention for another kind (`workshop`, `late_cancellation`, `other_fees`) in force
-- on p_on, or null.
create function private.professional_compensation_rate(p_org uuid, p_kind text, p_on date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select c.retention_pct
    from public.compensation_rates c
   where c.org_id = p_org and c.kind = p_kind
     and c.effective_from <= p_on and (c.effective_to is null or p_on < c.effective_to)
$$;
revoke all on function private.professional_compensation_rate(uuid, text, date)
  from public, anon, authenticated, service_role;

-- What the payroll shows and prints of a professional: her name, her primary title (the
-- QuickBooks specialty of her invoice, Christine 17), her account (the notices) and what her
-- own invoice to the clinic carries (address, GST and QST numbers when registered). Never the
-- SIN nor the bank account.
create function private.professional_payout_facts(p_org uuid, p_ids uuid[])
returns table (
  professional_id uuid, display_name text, first_name text, last_name text, profile_id uuid, email text,
  title_id uuid, title_name text, title_label text,
  address_line1 text, address_line2 text, city text, province text, postal_code text,
  gst_number text, qst_number text
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.profile_id, p.email,
         t.id, t.name, private.profession_title_label(t.name, t.name_feminine, t.name_masculine, p.gender),
         p.address_line1, p.address_line2, p.city, p.province, p.postal_code,
         x.gst_number, x.qst_number
    from public.professionals p
    left join lateral (
      select pt.id, pt.name, pt.name_feminine, pt.name_masculine
        from public.professional_professions pp
        join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
       where pp.org_id = p.org_id and pp.professional_id = p.id and pp.is_primary
       limit 1) t on true
    left join public.professional_private x on x.org_id = p.org_id and x.professional_id = p.id
   where p.org_id = p_org and p.id = any (coalesce(p_ids, '{}'))
$$;
revoke all on function private.professional_payout_facts(uuid, uuid[]) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
