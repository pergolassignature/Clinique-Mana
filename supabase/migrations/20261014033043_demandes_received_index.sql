-- =============================================================================
-- Demandes: an index on the date received, every state (D6 review follow-up)
-- =============================================================================
-- Rapports « Indicateurs des demandes » (`private.demandes_report_requests`) and the inbox's
-- « Toutes » and « Fermées » views read a clinic's requests by `received_at` whatever their state;
-- the existing `demandes_org_open_received_idx` covers only the open ones. Additive, small table.
-- =============================================================================

create index if not exists demandes_org_received_idx on public.demandes (org_id, received_at);
