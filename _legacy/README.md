# Legacy Clinique MANA (read-only)

The app as it was before the foundation rebuild (tag `legacy-v1`).

- **Do not edit or import** anything here. It is excluded from TypeScript, ESLint, Vite and CI.
- Use it as a reference when rebuilding a module. The behaviour to preserve is listed in
  `docs/plans/2026-10-06-legacy-feature-inventory.md`.
- A module's legacy folder is deleted once that module is rebuilt and enabled.

## Legacy guidance — do not follow

These documents describe the old app, its "module pipeline" gates and its scope (e.g. "do not
duplicate GoRendezvous", since reversed by design D8). They were moved here on 2026-10-07 so they
no longer read as current rules. The current rules are `CLAUDE.md`, `docs/standards/` and
`docs/adr/`.

| Moved from | To |
|---|---|
| `claude.md` (old project instructions) | `_legacy/claude.md` |
| `.claude/workflows/` (`module.pipeline.md`) | `_legacy/.claude/workflows/` |
| `.claude/skills/` (gate skills: data contract, schema, RLS, audit, seed, smoke, wireframe…) | `_legacy/.claude/skills/` |
| `docs/modules/` status files (`professionnels/`, `app-shell/`, `auth-foundation/`, `_template/`) | `_legacy/docs/modules/` |
| `docs/data-contracts/`, `docs/deploy/`, `docs/testing/` | `_legacy/docs/…` |
| `docs/audit/FINAL_AUDIT_REPORT.md`, `docs/audit/PROFESSIONALS_MAP.md` | `_legacy/docs/audit/` |
| `docs/standards/definition-of-done.md`, `do-not-do.md`, `platform.model.md`, `security.model.md` | `_legacy/docs/standards/` |
| `docs/plans/2026-01-*.md` (legacy module plans: disponibilités, services, taxes, facturation) | `_legacy/docs/plans/` |
| `docs/professional-profile-audit/` (screenshots of the legacy professional profile) | `_legacy/docs/professional-profile-audit/` |
