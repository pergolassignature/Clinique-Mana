-- =============================================================================
-- Professionnels for Facturation F2 (F2.0): the supervisor of an intern, the receipt facts
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (F2: « F2.0 Professionnels migration
--            supervisor_professional_id »)
-- Decisions: R-60 (an intern's receipt prints her supervisor's name, order and licence), BI-11
--
-- * `professionals.supervisor_professional_id`: another professional of the clinic who supervises
--   this one (an intern). Set with `set_professional_supervisor` (professionals.manage): never
--   herself, never a professional who is supervised herself (a supervisor is a licensed member),
--   never one who supervises others. A supervisor removed from the clinic (row deleted) clears it.
-- * Published for Facturation (granted to no role; definer callers after their own check):
--   - `private.professional_receipt_facts(org, ids[])`: what a receipt prints for each
--     professional: her name, her primary title (gendered), its order and licence, and her
--     supervisor's same facts;
--   - `private.professional_client_agreement_on(org, professional, client, day)`: the
--     « entente particulière » in force for a dossier (Professionnels' agreements, CL-11), so the
--     morning queue holds the session for validation (Christine, answer 8).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_supervisor', true);

alter table public.professionals
  add column supervisor_professional_id uuid,
  add constraint professionals_supervisor_fkey foreign key (org_id, supervisor_professional_id)
    references public.professionals (org_id, id) on delete set null (supervisor_professional_id),
  add constraint professionals_supervisor_not_self_check check (supervisor_professional_id <> id);
create index professionals_supervisor_idx on public.professionals (org_id, supervisor_professional_id);

-- The supervisor of an intern (null: none). professionals.manage.
create function public.set_professional_supervisor(p_professional_id uuid, p_supervisor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  perform 1 from public.professionals p where p.org_id = v_org and p.id = p_professional_id for update;
  if not found then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  if p_supervisor_id is not null then
    if p_supervisor_id = p_professional_id then
      raise exception 'Un professionnel ne se supervise pas lui-même.' using errcode = 'P0001', hint = 'supervisor';
    end if;
    if not exists (select 1 from public.professionals s where s.org_id = v_org and s.id = p_supervisor_id) then
      raise exception 'Superviseur introuvable.' using errcode = 'P0001', hint = 'supervisor';
    end if;
    if exists (select 1 from public.professionals s where s.org_id = v_org and s.id = p_supervisor_id
                and s.supervisor_professional_id is not null) then
      raise exception 'Ce professionnel est lui-même supervisé : choisissez un membre de son ordre qui supervise.'
        using errcode = 'P0001', hint = 'supervisor';
    end if;
    if exists (select 1 from public.professionals s where s.org_id = v_org and s.supervisor_professional_id = p_professional_id) then
      raise exception 'Ce professionnel supervise déjà des stagiaires : il ne peut pas être supervisé.'
        using errcode = 'P0001', hint = 'supervisor';
    end if;
  end if;
  update public.professionals p set supervisor_professional_id = p_supervisor_id
   where p.org_id = v_org and p.id = p_professional_id
     and p.supervisor_professional_id is distinct from p_supervisor_id;
end;
$$;
revoke all on function public.set_professional_supervisor(uuid, uuid) from public, anon;
grant execute on function public.set_professional_supervisor(uuid, uuid) to authenticated;

-- What a receipt prints for each professional (ord = the position in p_ids): her name, her
-- primary title (gendered), its order and licence; her supervisor's same facts (null: none).
create function private.professional_receipt_facts(p_org uuid, p_ids uuid[])
returns table (
  professional_id uuid, name text, title text, order_name text, order_acronym text, licence_label text, licence_number text,
  supervisor_id uuid, supervisor_name text, supervisor_title text, supervisor_order_name text, supervisor_order_acronym text,
  supervisor_licence_label text, supervisor_licence_number text
)
language sql
stable
set search_path = ''
as $$
  with facts as (
    select p.id, p.first_name || ' ' || p.last_name as name, p.supervisor_professional_id,
           private.profession_title_label(t.name, t.name_feminine, t.name_masculine, p.gender) as title,
           o.name as order_name, o.acronym, o.licence_label, pp.licence_number
      from public.professionals p
      left join lateral (select x.* from public.professional_professions x
                          where x.professional_id = p.id order by x.is_primary desc, x.created_at limit 1) pp on true
      left join public.profession_titles t on t.id = pp.profession_title_id
      left join public.professional_orders o on o.id = t.order_id
     where p.org_id = p_org
       and (p.id = any (coalesce(p_ids, '{}'))
            or p.id in (select s.supervisor_professional_id from public.professionals s
                         where s.org_id = p_org and s.id = any (coalesce(p_ids, '{}'))))
  )
  select f.id, f.name, f.title, f.order_name, f.acronym, f.licence_label, f.licence_number,
         s.id, s.name, s.title, s.order_name, s.acronym, s.licence_label, s.licence_number
    from facts f
    left join facts s on s.id = f.supervisor_professional_id
   where f.id = any (coalesce(p_ids, '{}'))
$$;

-- The « entente particulière » in force on a day between a professional and a dossier.
create function private.professional_client_agreement_on(p_org uuid, p_professional_id uuid, p_client_id uuid, p_on date)
returns table (agreement_id uuid, duration smallint, client_price_cents int, note text)
language sql
stable
set search_path = ''
as $$
  select a.id, a.duration, a.client_price_cents, a.note
    from public.professional_client_agreements a
   where a.org_id = p_org and a.professional_id = p_professional_id and a.client_id = p_client_id
     and a.effective_from <= p_on and (a.effective_to is null or p_on < a.effective_to)
   order by a.effective_from desc
$$;
revoke all on function private.professional_receipt_facts(uuid, uuid[]),
  private.professional_client_agreement_on(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
