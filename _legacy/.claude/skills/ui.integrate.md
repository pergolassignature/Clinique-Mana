# Skill: ui.integrate
Purpose: Replace mocks with Supabase calls.

Inputs:
- Local Supabase with schema + RLS

Outputs:
- Typed queries + safe UI integration

Hard constraints:
- No service role in frontend
- Explicit loading/error states

Refusal:
- Integrate without RLS tests
