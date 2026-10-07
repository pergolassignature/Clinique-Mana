Clinique MANA is an online mental health platform operating in Quebec.

The platform's role is to:
- Acquire clients
- Collect intake information (motifs, preferences, consent)
- Match clients to appropriate professionals
- Fill professional availability
- Bill clients directly (via QuickBooks)
- Compensate professionals on a monthly basis

Clinique MANA retains a platform commission (typically 25–30%) from the professional's hourly rate.

Appointments:
- Are currently conducted outside the platform (GoRendezvous)
- Are mostly delivered online (Zoom)
- MAY be managed internally in later phases (explicitly out of scope for early iterations)

This is a long-lived, production system.
Security, access control, auditability, and correctness matter more than speed.

The platform must:
- Enforce access control at the database level (RLS)
- Clearly separate:
  - Platform triage data (motifs, intake context, assignments)
  - Professional clinical content (notes, session details)
- Preserve historical intake context for reassignment, billing, and support
- Be auditable and defensible (especially for consent and billing traces)
- Avoid assumptions about clinical session workflows

If a choice trades speed for correctness, compliance, or auditability:
→ choose correctness.
