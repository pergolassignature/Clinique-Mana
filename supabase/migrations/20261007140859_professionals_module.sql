-- =============================================================================
-- Register the Professionals module (« Professionnels »)
-- =============================================================================
-- Registry entries only; the module's tables arrive in Phase 4.
-- Code identifiers are English (`professionals`); the label stays French.
--
-- Design:   docs/plans/2026-10-06-foundation-rebuild-design.md §5
-- Review:   docs/audit/2026-10-07-core-schema-design-review.md (I6)
-- Recipe:   docs/standards/database-conventions.md ("Adding a module")
-- =============================================================================

insert into public.modules (key, name) values
  ('professionals', 'Professionnels')
on conflict do nothing;

-- No module_dependencies rows: professionals depends on core only (implicit).

insert into public.permissions (key, module_key, description) values
  ('professionals.view', 'professionals', 'Voir les professionnels')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.view'),
  ('staff', 'professionals.view')
on conflict do nothing;
