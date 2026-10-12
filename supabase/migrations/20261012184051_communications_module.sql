-- =============================================================================
-- Register the Communications module (« Communications »)
-- =============================================================================
-- Registry entries only: the module's tables arrive with its batches (CM1 Gmail:
-- *_communications_gmail.sql; SMS: *_communications_sms.sql). Code identifiers are English
-- (`communications`); the label stays French.
--
-- Permissions (CM-1, plan §1): `communications.inbox` (read the shared mailboxes) and
-- `communications.mailboxes_manage` (connect, disconnect, synchronise, the « Courriels Gmail »
-- settings). `communications.send` (CM3), `communications.ai_draft` (CM4) and the SMS keys arrive
-- with their batches.
--
-- Role defaults: admin only. The plan gives `communications.inbox` to the counselor and the
-- admin_assistant too, but a template default of a disabled module blocks every clinic where the
-- module is off: `set_user_role` and `create_role` refuse, to a non-admin manager, a role whose
-- defaults carry a permission she does not hold, and `has_permission` is false for a disabled
-- module (fails closed by design, *_core_editable_roles.sql). Seeding those two rows would stop
-- the adjointe from assigning « Conseillère » in production today. So the module ships with the
-- admin's rows only, and the clinic gives `communications.inbox` to Conseillère and Adjointe in
-- « Utilisateurs et accès » → Rôles once it enables the module (status doc, « Mise en service »).
--
-- Plan:   docs/plans/2026-10-11-modules-coding-plan.md §1, §11
-- Recipe: docs/standards/database-conventions.md ("Adding a module")
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_module', true);

insert into public.modules (key, name) values ('communications', 'Communications')
on conflict do nothing;

-- No module_dependencies row: the module depends on core only; Clients is optional (linking).

insert into public.permissions (key, module_key, description) values
  ('communications.inbox', 'communications', 'Lire les courriels des boîtes partagées de la clinique'),
  ('communications.mailboxes_manage', 'communications', 'Connecter et gérer les boîtes Gmail')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'communications.inbox'),
  ('admin', 'communications.mailboxes_manage')
on conflict do nothing;
