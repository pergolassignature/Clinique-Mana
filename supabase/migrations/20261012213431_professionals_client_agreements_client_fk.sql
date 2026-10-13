-- =============================================================================
-- Professionnels: an « Entente particulière » points at its client (plan C1.3)
-- =============================================================================
-- professional_client_agreements.client_id waited for the Clients module (P4-183, P4-196):
-- until now an agreement named its client by client_label (a file number or initials). The
-- foreign key now holds it to a client of the same clinic. No row holds a client_id yet (the
-- column had no writer), so nothing to backfill here: the client import (I1) fills client_id
-- from the label it matches; the label stays as the agreement's short reference.
-- =============================================================================

alter table public.professional_client_agreements
  add constraint professional_client_agreements_client_fkey
  foreign key (org_id, client_id) references public.clients (org_id, id);

create index professional_client_agreements_org_client_idx
  on public.professional_client_agreements (org_id, client_id) where client_id is not null;

comment on column public.professional_client_agreements.client_id is
  'The client (Clients module): set by the import (I1) or a later agreement RPC; client_label stays the short reference.';
