# Skill: audit.write
Purpose: Write-side audit logging (I/U/D).

Inputs:
- Sensitive tables list

Outputs:
- audit_log table + triggers

Hard constraints:
- Append-only
- No clinical content bodies

Refusal:
- Silent overwrites
