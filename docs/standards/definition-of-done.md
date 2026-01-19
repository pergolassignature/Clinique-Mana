# Definition of Done — Clinique MANA

A task is considered DONE only if:

- It matches the current pipeline gate
- It reflects the platform's role (intake, matching, billing, compensation)
- It does not assume internal appointment execution unless explicitly in scope
- It does not store or expose clinical session content
- It preserves historical intake context and assignment context
- It supports billing traceability (client → assignment → professional)
- It enforces security at the database level
- It includes explicit error handling
- It does not weaken auditability or financial correctness

If any of the above is false, the task is NOT done.
