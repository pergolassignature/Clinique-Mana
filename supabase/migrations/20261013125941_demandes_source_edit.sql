-- =============================================================================
-- Demandes: the « Provenance » corrected by a counselor (Jonathan, 2026-10-13)
-- =============================================================================
-- A counselor who typed the wrong channel or « Provenance déclarée » corrects it on the request's
-- « Provenance » card. Only those two: the booking page's automatic capture (campaign, utm_*,
-- referrer, landing page) is a fact the system recorded and stays as it is. Audited (the demandes
-- trigger: before and after). Decision D-26.
-- Additive: one RPC.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:demandes_source_edit', true);

-- p_channel: one of the channels; p_referral_source_id: one of the clinic's referral sources
-- (Clients' `referral_sources_catalog`, active), or null (« Non précisé »). The source already on
-- the request is kept even if its catalogue entry was since archived.
create function public.set_demande_source(p_id uuid, p_channel text, p_referral_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  if p_channel is null or p_channel not in ('phone', 'email', 'web_form', 'booking_page', 'sms', 'referral', 'walk_in', 'other') then
    raise exception 'Choisissez un canal de la liste.' using errcode = 'P0001', hint = 'channel';
  end if;
  if p_referral_source_id is not null
     and p_referral_source_id is distinct from v_row.referral_source_id
     and not exists (select 1 from public.referral_sources_catalog s
                      where s.id = p_referral_source_id and s.org_id = v_row.org_id) then
    raise exception 'Choisissez une provenance de la liste de la clinique.' using errcode = 'P0001', hint = 'referral_source_id';
  end if;
  if v_row.channel = p_channel and v_row.referral_source_id is not distinct from p_referral_source_id then
    return;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_source', true);
  update public.demandes d
     set channel = p_channel, referral_source_id = p_referral_source_id
   where d.id = v_row.id;
end;
$$;
revoke all on function public.set_demande_source(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_demande_source(uuid, text, uuid) to authenticated;
