# Security Model — Clinique MANA

Roles:
- admin
- staff
- provider

Rules:
- Database is source of truth (RLS).
- Default deny.
- Provider sees only assigned clients.
- Staff sees triage only with active consent.
- Clinical notes are provider-only.

Audit:
- Writes always audited.
- Sensitive reads require logging strategy.

Billing records, assignments, and compensation data are platform-owned.
Clinical session content remains professional-owned and is not stored by the platform.
