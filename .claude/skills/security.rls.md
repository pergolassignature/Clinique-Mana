# Skill: security.rls
Purpose: Implement RLS + attack tests.
Refs: docs/standards/security.model.md

Inputs:
- Schema applied locally

Outputs:
- RLS migrations
- tests/rls/<module>.sql

Hard constraints:
- Default deny
- Minimal explicit allow
- Use (select auth.uid())

Refusal:
- Broad allow policies
