-- =============================================================================
-- Demandes: « Dossiers existants » in « Nouvelle demande » (Jonathan, 2026-10-15, D-55)
-- =============================================================================
-- A counselor taking a call from someone the clinic already knows created a request with loose
-- contact details, and nothing said that the person already had an open request. While she types,
-- `find_demande_matches(first, last, phone, email)` answers:
-- * `clients`: Clients' published `private.clients_intake_matches` (the duplicate rule of I-5,
--   then the same or a similar name), at most 5, each with the open requests of that file (its
--   own, or one it is a participant of);
-- * `open_demandes`: the other open requests (neither matched nor closed) whose typed contact is
--   the same email or the same phone (last 10 digits, Clients' `clients_phone_key`), at most 3.
-- « Utiliser ce dossier » then sends `client_id` to `create_demande`, which already takes it: one
-- transaction, never a half-made request (the composite FK keeps it in the clinic).
-- Checks first: demandes.manage (it is the quick entry's) and clients.view (it reads files).
-- Nothing is written, as for Clients' own `find_client_duplicates` and `search_clients`.
-- =============================================================================

create function public.find_demande_matches(p_first text, p_last text, p_phone text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_email text := pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.left(coalesce(p_email, ''), 254)), ''));
  v_key text := private.clients_phone_key(pg_catalog.left(p_phone, 30));
  v_clients jsonb;
  v_listed uuid[];
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_require('clients.view');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;

  with m as (
    select x.*, pg_catalog.row_number() over () as n
      from private.clients_intake_matches(v_org, p_first, p_last, v_email, p_phone, 5) x
  ),
  open_of as (
    select m.client_id, d.id, d.reference, d.received_at
      from m
      join public.demandes d on d.org_id = v_org and d.state not in ('matched', 'closed')
                             and (d.client_id = m.client_id
                                  or exists (select 1 from public.demande_participants p
                                              where p.demande_id = d.id and p.org_id = v_org and p.client_id = m.client_id))
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'client_id', m.client_id, 'client_number', m.client_number, 'display_name', m.display_name,
           'birth_year', m.birth_year, 'is_archived', m.is_archived, 'matched_on', pg_catalog.to_jsonb(m.matched_on),
           'phone_hint', m.phone_hint, 'email_hint', m.email_hint,
           'open_demandes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'reference', o.reference)
                                                                  order by o.received_at desc)
                                        from (select o2.* from open_of o2 where o2.client_id = m.client_id
                                               order by o2.received_at desc limit 3) o), '[]'::jsonb))
           order by m.n), '[]'::jsonb),
         coalesce((select array_agg(o.id) from open_of o), '{}')
    into v_clients, v_listed
    from m;

  return pg_catalog.jsonb_build_object(
    'clients', v_clients,
    'open_demandes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'reference', x.reference) order by x.received_at desc)
        from (select d.id, d.reference, d.received_at
                from public.demandes d
               where d.org_id = v_org and d.state not in ('matched', 'closed')
                 and (v_email is not null or v_key is not null)
                 and ((v_email is not null and d.contact_email = v_email)
                      or (v_key is not null and private.clients_phone_key(d.contact_phone_e164) = v_key))
                 and not (d.id = any (v_listed))
               order by d.received_at desc
               limit 3) x), '[]'::jsonb));
end;
$$;
revoke all on function public.find_demande_matches(text, text, text, text) from public, anon, authenticated;
grant execute on function public.find_demande_matches(text, text, text, text) to authenticated;
