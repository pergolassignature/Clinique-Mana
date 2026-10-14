# Security review before the cutover (2026-10-14)

**Scope:** everything built since 2026-10-12.

- About 125 migrations: Services, Clients, Demandes, Rendez-vous, Facturation, Communications and SMS, Rapports, the GOrendezvous imports, and core.
- The edge functions of:
  - consents, Demandes and Rendez-vous;
  - Zoom, Google, Stripe and QuickBooks;
  - Gmail, SMS and the AI draft.

**Method:** six independent reviewers read the code, one per area, against the coordinator's checklist:

- definer functions check the permission first and scope to the caller's clinic;
- no clinic id sent by the client is trusted;
- RLS and grants follow CLAUDE.md §6 (a green `000_invariants` is necessary, not sufficient);
- public-token and webhook functions rate-limit before any lookup and compare signatures with `timingSafeEqual`;
- no personal data, token or body reaches a log or `reportError`;
- P3-40 holds on every client-facing send;
- secrets live only in Vault and `SecretField`;
- audit triggers redact every free-text or sensitive column.

**Fixes:** confirmed findings were fixed in the owning module, one PR per area. Each PR re-confirmed every finding against `main`, added pgTAP and Deno tests, and was merged on green and deployed (« CI », « Apply Supabase migrations », « Apply edge functions »).

## Result

**No high-severity finding.** The reviewers confirmed, across the whole scope:

- **Definer RPCs:** every one checks its permission first, has `set search_path = ''`, uses fully-qualified names, and takes the clinic from the session or the row, never from the client. There is no dynamic SQL apart from the regex-checked handler names and Vault names.
- **Service-role RPCs:** granted to `service_role` only. Those that act for a person re-check that the actor is an active member holding the permission.
- **Tables:**
  - every table is `revoke all`, with select-only grants and RLS;
  - every policy uses `(select private.…)` with a `has_permission` term;
  - every view is `security_invoker`;
  - the operational tables without an audit trigger are listed with their reason in `000_invariants`.
- **Webhooks** (Stripe, Zoom, Gmail push, SMS):
  - a per-IP limit comes first, then a constant-time signature check (or full OIDC verification);
  - `?org=` is used only to choose the secret;
  - events are deduplicated.
- **Public links** (consents, booking, proposals, waiting list, confirmations, payments): hashed tokens, bounded in time and uses, a per-IP limit before any lookup, the same answer for unknown, used and expired tokens, never an echo of the input.
- **OAuth tokens** (Gmail, Zoom, Google, QuickBooks): encrypted with a key version, listed in `pii_encrypted_values()`, never in an answer or a log. The OAuth `state` is signed, bound to the user and clinic, and has a fixed redirect.
- **Logs and reports:** `reportError` carries codes and ids only.
- **Inbound email HTML:** DOMPurify inside a sandboxed iframe.
- **Realtime:** broadcast only, ids only, behind RLS on `realtime.messages`.
- **Money integrity:**
  - payments are capped at the balance, and refunds at what is left of the payment, both under row locks;
  - invoice numbering has no gaps;
  - Stripe and QuickBooks calls carry idempotency keys.

## Findings and fixes

| Area | PR | Findings (reviewer) | Fixed |
|---|---|---|---|
| Facturation, Stripe, QuickBooks | #169 (+ #171 for the import RPC) | 5 medium, 5 low, 4 info | Medium and low: all |
| Communications, SMS, Gmail | #170 | 1 medium, 7 low, 6 info | Medium and low: all; info documented |
| Clients | #171 | 5 low, 6 info | Low: all but 2 deferred (below) |
| Rapports, imports, core | #171 | 2 medium, 4 low, 6 info | Medium and low: all |
| Demandes | #174, #179 | 3 medium, 4 low, 3 info | All but the booking-page caps (below) |
| Rendez-vous, Zoom, Google | #175 | 2 medium, 5 low, 4 info | All |
| Core (OAuth state, found in Rendez-vous) | #168 | 1 low | Yes |

### Medium

- **Facturation:**
  - **A QuickBooks realm change kept the old company's ids** (vendor, organisation, item and tax-code links, pushes, Bills). Reconnecting to the production company after the sandbox would have booked entries to the wrong records. → Cleared on a realm change (BI-23). #169
  - **A professional's invoice could be pushed twice as a QuickBooks Bill** (regenerating it, reopening the period). → Refused once its Bill exists or its push is in progress. #169
  - **Audit-log redaction gaps:**
    - `invoices.hold_note` (a copy of the redacted special-agreement note) and `payer_reference` (an IVAC or PAE file number);
    - the Interac notices' sender name, reference and reason;
    - the card's brand, last digits and expiry, and the Stripe ids;
    - the payer organisations' contact.

    → Redacted. #169
  - **Anonymising a client missed** payment notes, the payer reference, credit-note and refund reasons, and the matched Interac notices. → Extended. #169
- **Communications:**
  - **The AI draft sent correspondents' names to OpenAI** when the thread had no linked client, and did not require `communications.inbox`. → Every correspondent's name is now masked on the server, and the inbox permission is required. CM-19 now says the masked message is sent. #170
- **Clients and imports:**
  - **Re-running the consents import brought a withdrawn consent back into force.** → Skipped when it is withdrawn, signed in the app, or newer (I-20). #171
  - **Import name matching could attach records to a homonym** (one of them anonymised, or not imported). → The database answers « ambiguous ». The tool stops on such names until a `--clients-map` is given (I-21). #171
- **Demandes:**
  - **The public booking page revealed whether an email already had a pending call.** → A duplicate gets the same answer as a booking. #174
  - **A professional kept a client's file after the request was unmatched or re-matched**, or after a participant was removed. → The `demande` link is removed when the professional has no appointment with that client. #174
  - **Anonymisation left the request's health and legal free text** (concerns, comments, legal details, notes, waiting-list reasons). → Cleared. #174
- **Rendez-vous:**
  - **A professional could book any client of the clinic on her agenda**, and so get the client's contact details. → Only clients already in her files, unless she holds `appointments.manage` (AP-49). #175
  - **« Votre lien de rencontre » ignored the client's email opt-out.** → Honoured, as for reminders. #175

### Low (fixed)

- **Facturation:**
  - the fee decision checks the permission before locking the row;
  - each third-party payer's consumption is computed under a lock, so its annual cap holds under concurrent finalisations;
  - Interac notices are recorded automatically only on a first-and-last-name match (BI-25);
  - imported invoices are never paid out in payroll nor charged (BI-24);
  - one Stripe Checkout session per invoice and balance (BI-26);
  - a pending charge is resumed only after the same checks as a new one.
- **Communications:**
  - the PBX address, id and number require `settings.integrations_manage`, and a new address drops the stored session;
  - test texts are refused to an opted-out number;
  - client texts queued before the module was reserved are not dispatched (P3-40);
  - « STOP merci », « Arrêtez » and « désabonner » count as opt-outs;
  - mail retention also purges thread snippets, old drafts and the AI log;
  - `hardenHtml` decodes entities before checking links;
  - Google's keys are refetched at most once a minute.
- **Clients, imports, Rapports:**
  - an org-level switch closes every `import_*` RPC after the cutover; `import_invoice` refuses inactive modes, future dates and over 200 items (I-22);
  - the public consent page honours « Réservé aux testeurs » (P3-40);
  - `clients-consent-send` authenticates the caller before reading the body;
  - the signed-copy RPC re-checks its actor;
  - `report_demandes` honours testers;
  - the import tool never prints a database message and refuses a report path inside the repo, and the runbook deletes the exports after the cutover;
  - the duplicate-phone and search inputs are bounded.
- **Demandes:**
  - the audit log also redacts availability notes, the insurer and the family or legal context;
  - cancelling a booking honours the module gate;
  - the waiting-list fee invoice honours P3-40;
  - booking names are bounded;
  - waiting-list offer slots are stored rebuilt;
  - the booking proof-of-work ticket is spent once for its whole life (#179).
- **Rendez-vous:**
  - the video link email honours « Réservé aux testeurs »;
  - an old confirmation link no longer confirms a moved or restored appointment, and links are revoked on change;
  - a held slot shows no client to a professional, in `list_agenda` and in RLS (AP-15);
  - Zoom meeting ids are redacted in the audit log;
  - two RPCs check the permission before reading;
  - the Google grant is revoked when no refresh token comes back;
  - booking consents read Clients' published facts.
- **Core:** an OAuth `state` is now spent once for its whole validity. Before, the spend was counted in a fixed rate-limit window, so a state could be reused just after the window turned over. A new `oauth_state_nonces` table holds the spent ones. Gmail, QuickBooks, Zoom and Google use it. #168

## Deferred: decisions for Jonathan

1. **The consent page's identity check** (Clients). The page asks for the first name, which the email already contains, and the birth year when the file has a birthday. Someone holding the forwarded email can sign. A stronger check, such as the full birth date or refusing files without a birthday, changes what a parent must type. Révisable.
2. **The booking page's abuse limits** (Demandes, D-7).
   - Already in place: per-IP limits and a proof of work.
   - Not in place: per-clinic and per-recipient caps, and Turnstile, which D-7 already plans.

   The page could still be used to send clinic-branded emails, or to fill slots from many IPs.
3. **Shared mailboxes are visible to every inbox user** (Communications, CM-11): no per-mailbox access. Personal mailboxes must not be enabled before their attachment permission and `store_mail_connection` are fixed, as documented in communications.md.
4. **Smaller points kept for later** (documented in each module doc):
   - the import tombstone is an unsalted hash;
   - an anonymised relative leaves a trace in another file's history;
   - a spoofed sender can auto-link a mail thread;
   - a QuickBooks Bill voided in QuickBooks cannot yet be marked as voided in the app, so a pushed period can only be corrected by next month's adjustment.
