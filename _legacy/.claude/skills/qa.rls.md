# Skill: qa.rls
Purpose: Prove RLS cannot regress.

Inputs:
- RLS policies applied locally

Outputs:
- tests/rls/<module>.sql

Hard constraints:
- Test forbidden access explicitly
- Test role permutations

Refusal:
- Manual-only verification
