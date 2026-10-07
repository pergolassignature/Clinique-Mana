# Skill: db.schema
Purpose: Convert approved contract into Supabase schema.

Inputs:
- Approved Data Contract

Outputs:
- supabase/migrations/*_<module>_schema.sql

Hard constraints:
- English snake_case
- Constraints + FKs
- Never rewrite applied migrations

Refusal:
- No contract, no schema work
