# Phase 3 — Shared services: design

**Date:** 2026-10-08 · **Status:** Draft, for review with Jonathan · **Branch:** `feat/phase-2-core-settings` (doc only)
**Builds on:** [foundation design §4–§5](2026-10-06-foundation-rebuild-design.md#4-shared-core-services), [Phase 2 design](2026-10-07-phase-2-core-settings-design.md), [decisions log](2026-10-07-decisions-log.md) (#21, #22, #27, #31, #34–#40), [ADR 0004](../adr/0004-secrets-in-vault.md), [ADR 0005](../adr/0005-documenso-replaces-docuseal.md), [ADR 0006](../adr/0006-session-and-recovery-policy.md), [database conventions](../standards/database-conventions.md), [legacy inventory](2026-10-06-legacy-feature-inventory.md) A3–A5, A9, I.

## 1. Goals and scope

Phase 3 builds the plumbing that modules use to reach people outside the app: email, secure links, e-signature, files and scheduled jobs. It also delivers the two things that were waiting for it: staff invitations (decision #22) and auth email links on the clinic's own domain (decision #21, follow-up).

**Design rule.** Core ships **generic plumbing**: tables, shared Deno libraries, webhooks, settings, and a test path for each service. **Modules ship their own actions**, as their own edge functions that call the shared libraries (`professionals-invite`, `professionals-contract-send`, …). A core function never imports module code, and a disabled module's actions simply do not run (ADR 0003).

| Service | Phase 3 delivers | First consumers |
|---|---|---|
| Email (`core/email`) | Resend transport, branded layout, per-org templates with defaults, send log + delivery webhook, « Courriels » settings | Staff invitation (3); Professionnels 4b–4d (invite, reminders, profile update, document rejected/expiring, fiche); later Clients, Rendez-vous (reminders), Facturation (receipts) |
| Secure links (`core/links`) | Hashed single-use tokens, purpose catalogue, `resolve-link` / `accept-invite` | Staff invitation (3); professional invite and profile update (4b); later client links (consents, portal) |
| Staff invitations | « Inviter » in « Utilisateurs et accès », account created on acceptance | Clinic staff |
| Auth links on the clinic domain | `token_hash` templates, `/connexion/confirmer`, ADR 0006 amendment | Every user |
| E-signature (`core/signing`) | Documenso client, document templates + versions, signature requests, webhook, « Signature électronique » settings | Contract (4d); later client consents |
| Storage (`core/storage`) | Private buckets, file registry, `storage.objects` policies, upload flow, logo + signature image | Professional documents (4c), signed PDFs (4d), fiche PDF (4d); later Clients, Facturation |
| Scheduled jobs | `pg_cron` + `pg_net` from migrations, job catalogue and run log, maintenance jobs | Insurance expiry notice (4c) |

Out of scope: in-app notifications (with Professionnels 4c), SMS, inbound email, Google integrations (with the module that uses them).

### Legacy parity (core-owned items)

The module items themselves are marked in the Professionnels design (Phase 4). The parts Phase 3 owns:

| Inventory item | Mark | How |
|---|---|---|
| A3 invite token (64 hex, stored in clear, listable by anon) | **Change** | 32 random bytes, only the SHA-256 stored, no anon access (§3) |
| A3 default expiry 7 days | Keep | Default TTL of the purpose, configurable by the module |
| A3 invite marked `opened` on load | Keep | `resolve-link` records `last_opened_at` |
| A2 « copy link » | Open (Q7) | A hashed token can only be shown when it is created |
| A4 10 MB; pdf, doc, docx, jpg, png, webp | Keep | Bucket limits + server-side content check (§7) |
| A4 path `professionals/{id}/{type}/{ts}_{safeName}` | **Change** | `{org}/{module}/{subject}/{file_id}.{ext}`; the original name lives in the database, never in a URL (Loi 25) |
| A4 preview through a 1 h signed URL | **Change** | 5 min |
| A4 file removed when the DB insert fails | Keep | `pending` → `ready` registry and a cleanup job |
| A5 DocuSeal | **Change** | Documenso (ADR 0005) |
| A5 provider sends the signing email, FR, initials on every page, 7-day expiry | Keep | §6 |
| A5 signed PDF + audit log stored on completion; manual « Synchroniser » | Keep | `signing-webhook`, `signing-sync` |
| A5 template admin, publish / new-version RPCs, one published version per key | Keep | Tables and RPCs in Phase 3; the UI comes with Professionnels 4d (design §5.5) |
| A5 `render_data` snapshot | **Change** | The stored unsigned PDF and its hash are the snapshot |
| A9 invite audit (created, status changes, sent) | Keep | Audit trigger on `secure_links` / `staff_invitations` + `email_log` |
| A10.2 no invite email ever sent · A10.3 unprotected webhook · A10.9 declined/expired ignored, clinic signer null | Fixed | §2, §6 |
| I scheduled tasks: job list, last runs, « Exécuter » | Keep | §8 |
| I schedule set by hand; job functions callable by any signed-in user | **Change** / fixed | Schedules in migrations; job functions service-role only |

Legacy « Gabarits » were document (contract) templates; legacy had **no email templates**, so every email template is new. Nothing is dropped from the inventory. The only Drop is a staging cleanup (§12).

## 2. Email (`core/email`)

### 2.1 Architecture

```
module function (e.g. professionals-invite)            send-email (internal)        email-test-send
        │  verifyAuth + module permission                   │ verifyServiceRoleAuth        │ settings.email_manage
        └──────────────► _shared/email.ts ◄─────────────────┴──────────────────────────────┘
                          resolve template (override ?? default) → render → layout
                          insert email_log (queued) → Resend POST /emails (Idempotency-Key = email_log.id)
                          → sent (resend_id) | failed (error code)
Resend ──► resend-webhook (Svix signature) ──► email_log.status (delivered, bounced, …)
```

- **`_shared/email.ts`** is ported from the Resend path of PS Hub's `send-quote-signing-email` (PS Hub's `email-router.ts` is mostly the Gmail routing, which we do not need). It renders, logs and sends, in-process, for the calling function.
- **No generic client-callable send.** The browser never supplies a body, subject or (except the fiche, §2.6) a recipient. It names an action and a subject row; the server resolves the recipient and the variables from the database. This keeps a stolen staff session from turning the clinic domain into a phishing relay.
- **`send-email`** is internal only (`verifyServiceRoleAuth`), for cron jobs that send through `pg_net` (expiry reminders, Phase 4).
- **API key:** Vault, through `set_org_secret('resend_api_key', …)`; functions read it with `get_org_secret(org_id, 'resend_api_key')`, the org taken from `auth.access.org_id` or from the row being acted on. Jonathan creates a **sending-only key restricted to `gestion.cliniquemana.com`**, distinct from the SMTP key that Supabase Auth uses, so either can be rotated alone.
- **Transport:** `EMAIL_TRANSPORT=resend` (default) or `mailpit` locally, so the whole flow is testable in Mailpit at `http://127.0.0.1:55324` without a Resend key. Verify that the CLI's Mailpit accepts its send API; the fallback is a `console` transport.
- **Retries:** up to 3 attempts in the request on 429/5xx (backoff 0.5 s, 2 s). The `Idempotency-Key` makes a retry, a double click or a timeout after acceptance safe. A final failure is `failed`: it is shown immediately (toast, then « Renvoyer » in the timeline), and « Renvoyer » re-runs the module action. No background retry queue in Phase 3 (Q4).
- **Tags:** each send carries the Resend tag `email_log_id`, so a webhook still maps to its row even if the send response was lost.
- **Open and click tracking are off** on the Resend domain. Click tracking would rewrite every secure link through Resend's redirect domain. Open tracking is a pixel that reveals the recipient's IP. The statuses therefore stop at delivery.

### 2.2 Templates

**Keys** are `<module>.<name>`, like permission keys. Phase 3 seeds `core.staff_invite`. Professionnels seeds its own in its migrations: `professionals.invite`, `.invite_reminder`, `.profile_update`, `.submission_received`, `.document_rejected`, `.document_expiring`, `.fiche`. The six auth emails stay Supabase templates (§5); they are not in these tables.

**Content model.** A template is a subject (plain text), a body (paragraphs, **bold**, bullet lists) and an optional button label. The server wraps it in a fixed branded layout:

- the header carries the wordmark;
- the footer carries the clinic identity from Settings (name, address, phone, website), the privacy officer contact (« Confidentialité ») and a per-template « Pourquoi ce courriel » line;
- a plain-text part is always generated.

Staff edit words, never HTML. **The button URL is not editable**: it is the secure link or app URL that the code provides. An editor can neither remove nor replace a link.

**Variables** are English dot-paths with French labels in the cheat-sheet: `{{professional.first_name}}`, `{{clinic.name}}`, `{{invitation.expires_on}}`, …

- Values are HTML-escaped.
- Dates are formatted with the clinic-timezone utilities, and date-only fields with `formatDateOnly`.
- Saving refuses an unknown placeholder (French P0001). Sending fails closed when a variable marked `required` has no value.
- **No clinical variable exists** (§2.5).

**Tables:**

| Table | Columns | Access |
|---|---|---|
| `email_template_defaults` (global catalogue, like `role_permissions`) | `key` pk, `module_key`, `label`, `description`, `subject`, `body`, `button_label`, `variables jsonb` (`[{path, label, sample, required}]`), `view_permission`, `updated_at` | read all; changed only by migrations (not audited, conventions §7) |
| `email_templates` (per-org overrides) | `org_id`, `key` → defaults, `subject`, `body`, `button_label`, `version int`, `updated_at`, `updated_by` | read with `settings.view`; writes via RPC; audited |

- **Effective template** = the org override, or else the default. A module's templates are listed only when the module is enabled.
- **RPCs** (`settings.email_manage`):
  - `save_email_template(p_key, p_subject, p_body, p_button_label)` validates placeholders and bumps `version`;
  - `reset_email_template(p_key)` deletes the override (« Rétablir le texte par défaut », with confirmation).
- **History:** the audit trail keeps the before/after of each edit, and `email_log.template_version` says which version was sent. A version number is never reused within an org: « Rétablir le texte par défaut » deletes the override but keeps its counter (`email_template_versions.last_version`), so the next save continues from the highest version used (1, 2, reset, 3), and `queue_email` refuses a version other than the current one. There is no draft/publish cycle: a template is short and the preview shows the result.

**Settings UI (« Courriels », §9).** Templates are grouped by module, one row each (label, « Personnalisé » or « Par défaut », last change). Opening a row shows a sheet with:

- the editor, with a variables cheat-sheet;
- a live **preview**, rendered by `email-preview` with sample values and shown in a sandboxed iframe (`sandbox=""`) at desktop and phone width;
- **« M'envoyer un test »**, which sends that template to the caller's own address with sample values, subject prefixed « [Test] ».

### 2.3 Send log and delivery webhook

`email_log` (one row per message, also the dedupe guard):

| Column | Notes |
|---|---|
| `id`, `org_id`, `module_key`, `template_key`, `template_version` | |
| `to_email`, `to_profile_id` (nullable) | the recipient; the profile when known |
| `subject_type`, `subject_id` | e.g. `staff_invitation` / id; feeds each record's « Courriels » timeline |
| `status` | `queued → sent → delivered`, or `delivery_delayed`, `bounced`, `complained`, `failed` |
| `error_code`, `attempts`, `resend_id` (unique) | provider messages are reduced to a code; they can quote the address |
| `view_permission` | copied from the template catalogue; the RLS policy requires it |
| `sent_by`, `created_at`, `sent_at`, `last_event_at` | |

- **Not stored:** the rendered body and the rendered subject (minimisation, §2.5). The timeline shows the template label: « Invitation envoyée ».
- **RLS:** own org, and either `(select private.has_permission(view_permission))` or `settings.email_manage`, which covers the global « Historique d'envoi ». A staff-invitation row needs `users.view`; a professional's rows will need `professionals.view`. No client writes.
- **Transitions:** the webhook never moves a row backwards. `bounced` / `complained` / `failed` are final, and a late `delivered` after a `bounced` is ignored.
- **`resend-webhook`:**
  - `verify_jwt = false`, Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`, 5 min tolerance), ported from PS Hub's `_shared/svix-webhook.ts` and switched to our `timingSafeEqualBytes`;
  - the secret is in Vault (`resend_webhook_secret`). The endpoint URL carries `?org=<org_id>` as a routing hint only: the function verifies with that org's secret, then requires the `email_log` row to belong to the same org;
  - each delivery is claimed once in `webhook_events` (§2.7);
  - the module gate is `requireModuleForOrg(org, email_log.module_key)`. If the module is disabled, the event is acknowledged (200) and ignored, so Resend does not retry it forever.
- **Bounces:** a hard bounce shows « Adresse introuvable » on the subject's timeline and in the « Courriels » log. A suppression list stays at Resend for now (Q5).

### 2.4 Sender settings

`email_settings`, one row per org: `from_name` (« Clinique MANA »), `from_address` (`no-reply@gestion.cliniquemana.com`), `reply_to`, `sending_domain` (`gestion.cliniquemana.com`), `updated_at`, `updated_by`.

- **Why a separate table:** it needs a different permission than `organizations` (`settings.email_manage`), and column grants cannot carry per-column policies.
- **Checks:** `from_address` must end with `@<sending_domain>` (check constraint + Zod). `reply_to` defaults to the clinic email from « Identité légale », because `no-reply` must never be the only way to answer.
- **Who edits what:** `sending_domain` with `settings.integrations_manage`; the rest with `settings.email_manage`. The audit trigger is attached.

### 2.5 Loi 25

- **No clinical content in any email**, ever. The variable catalogue contains no motif, demande content, note or diagnosis. For future client-facing templates (reminders, receipts), subjects must not reveal the kind of care: « Votre rendez-vous du 12 mars », not « Votre séance de psychothérapie ». Review rule for the Clients and Rendez-vous designs.
- **What is logged:** recipient address, template, version, subject reference, status and an error code. Not logged: bodies, rendered subjects, variable values. Edge function logs and Sentry never get addresses or tokens; they get the `email_log` id.
- **Audit trail:** `email_log` and `webhook_events` are operational logs, **exempt from the audit trigger**. Auditing every status change would copy recipient addresses into the append-only `audit_log` forever. `000_invariants` gets an explicit, commented exception list (conventions §12). Template and sender edits stay audited.
- **Retention** (daily job, §8):
  - `email_log` recipient addresses are anonymised after **24 months** (row kept, `to_email` set to null; Q6);
  - `webhook_events.payload` is cleared once processed and the rows are deleted after 90 days;
  - rate-limit rows are deleted after 24 h.
- **Cross-border:** Resend processes data in the United States, and the self-hosted Documenso host is still to be chosen. Loi 25 (art. 17) requires a privacy impact assessment (EFVP) before personal information leaves Québec, and the privacy policy should list these processors. This is Christine's call as privacy officer; Jonathan prepares the facts (§12).

### 2.6 Who can send what, rate limits, gating

| Email | Trigger | Permission | Recipient |
|---|---|---|---|
| Test | « M'envoyer un test » | `settings.email_manage` | caller's own address only |
| `core.staff_invite` | « Inviter » / « Renvoyer » | `users.manage` | the invitation's address |
| `professionals.*` (Phase 4) | module actions | the module's permission (`professionals.invite`, …) | the professional's login email |
| `professionals.fiche` (Phase 4) | « Envoyer par courriel » | Professionnels design | any typed address (the only client-supplied recipient), logged |
| Auth emails | Supabase Auth | — | the account owner |

**Rate limits** are starting values, kept in one constants file. They are enforced by `consume_rate_limit(p_bucket, p_key, p_max, p_window)` (service role only, `rate_limits` table, keys hashed with HMAC so no raw IP is stored).

| Bucket | Limit |
|---|---|
| Test sends | 10 per user per hour |
| All sends | 500 per org per day; Sentry warning at 80 % (runaway-loop brake) |
| Same template to the same address | 1 per 60 s, unless the action is an explicit « Renvoyer » |

Resend's own per-team API rate also applies: the retry handles its 429.

**Gating:** `email-preview` uses `verifyAuth(req, { permission: 'settings.view' })` (it stores and sends nothing); `email-test-send` uses `verifyAuth(req, { permission: 'settings.email_manage' })`. Module functions gate on their module (CLAUDE.md §7). `send-email` resolves the org and module from the row it acts on.

### 2.7 Shared webhook claim (`webhook_events`)

PS Hub's leased claim (`claim_contract_webhook_event`), generalised for Resend and Documenso:

- **Table:** `webhook_events(id, provider, event_id, org_id, event_type, status processing|completed|failed, claim_token, claimed_at, completed_at, attempts, last_error, payload jsonb, received_at)`, unique `(provider, event_id)`.
- **RPCs** (service role only):
  - `claim_webhook_event(p_provider, p_event_id, p_org_id, p_event_type, p_payload, p_lease_seconds)` returns `claimed` / `duplicate` / `in_progress` (409, so the provider retries);
  - `complete_webhook_event(p_id, p_claim_token)` and `fail_webhook_event(p_id, p_claim_token, p_error)`.
- **Event ids:** a Resend event is keyed by `svix-id`. A Documenso terminal event is keyed by `<event>:<document_id>` without a timestamp (PS Hub's `documensoEventId`); as built, the org comes first (`<org_id>:<event>:<document_id>`), since each clinic's instance numbers its documents alike (final Phase 3 review).
- **Status in Settings:** « Dernier événement reçu » reads `max(received_at)` per provider for the org.

## 3. Secure links (`core/links`)

### 3.1 Token design

- **Token:** 32 bytes from `crypto.getRandomValues`, base64url (43 characters), generated in the edge function. Only `sha256(token)` is stored. The raw token exists only in the function's memory and in the email.
- **Lookup:** by hash (unique index). There is no timing oracle on the secret: an attacker would have to guess a 256-bit value.
- **Purposes** are a catalogue seeded by the owning module: `secure_link_purposes(key pk, module_key, default_ttl, max_ttl, max_uses, requires_session, view_permission)`.
  - Phase 3: `staff_invite` (core, 7 days, 1 use).
  - Phase 4: `professional_invite` (7 days, 1 use) and `profile_update` (`requires_session`: the link opens the request, but the professional must be signed in as the subject's profile, with a magic link offered).
- **Table:** `secure_links(id, org_id, purpose → purposes, subject_type, subject_id, token_hash bytea unique, scope jsonb object, max_uses, use_count, expires_at, used_at, revoked_at, revoked_by, last_opened_at, created_by, created_at, updated_at)`.
  - No client privilege at all, like `org_secrets`: there is no list hole to reopen.
  - Audited with `token_hash` redacted.
  - **One live link per (subject, purpose):** creating a new one revokes the previous ones in the same transaction.
- **Scope:** `scope` holds purpose data (e.g. the sections requested by a profile update). It is validated by the purpose's Zod schema in the function.

### 3.2 URL and redemption

**URL:** `https://app.cliniquemana.com/invitation#t=<token>`, with the token in the **fragment**:

- the fragment is never sent to Vercel, so it is not in access logs or `Referer` headers;
- the page reads it, then removes it with `history.replaceState`;
- `vercel.json` adds `Referrer-Policy: no-referrer` on these routes.

**Flow:**

1. **`resolve-link`** (peek, no consumption) takes `{ token }` and returns `{ purpose, display: {…} }`:
   - it records `last_opened_at`;
   - `display` is the minimum the page needs: the clinic name, the invitee's own name and address, the expiry. Possessing the token proves ownership of that address.
2. **The purpose handler consumes the link:** `accept-invite` for invitations. Consumption is one atomic statement in a service-role RPC:
   ```sql
   update public.secure_links set use_count = use_count + 1, used_at = now()
    where token_hash = $1 and purpose = $2 and revoked_at is null
      and expires_at > now() and use_count < max_uses
   returning …
   ```
   Zero rows means invalid. Two concurrent submits cannot both succeed.

**Auth mode:** these functions have no user. They keep `verify_jwt = true`, so the project anon key is required, and the token is the authorization. This is a new category for CLAUDE.md §7: « public token functions ». They must:

- rate-limit before any lookup;
- answer with CORS restricted to `ALLOWED_ORIGINS`;
- take the org and module from the link row, then call `requireModuleForOrg`.

**Rate limits:**

| Bucket | Limit |
|---|---|
| `resolve-link` per IP | 30 per 10 min |
| `accept-invite` per IP | 10 per hour |
| `accept-invite` per link | 5 per hour |

The IP comes from `x-forwarded-for` (first hop; verify what the edge runtime passes on staging). Over the limit: 429 `rate_limited`, « Trop de tentatives. Réessayez dans quelques minutes. »

### 3.3 No enumeration

- An unknown or revoked token answers exactly like an invalid one: `link_invalid`, « Ce lien n'est pas valide. »
- `link_expired` (« Ce lien a expiré. Demandez-en un nouveau à la clinique. ») and `link_used` (« Ce lien a déjà été utilisé. Connectez-vous. ») are distinguished, because only the token holder can reach them.
- **No response ever says whether an email address has an account.** If `accept-invite` finds that the address got an auth account in the meantime, it answers the generic « Ce lien ne peut plus être utilisé. Communiquez avec la clinique. » and alerts Sentry, without the address.
- The new error codes (`rate_limited` 429, `invalid_request` 400, `link_invalid` / `link_expired` / `link_used` 410, `conflict` 409) are added to `ErrorCode` in `_shared/auth.ts`.

## 4. Staff invitations (decision #22)

Accounts are created only when the invitee accepts. No random passwords, no Supabase built-in invite.

**Data:**

- **Table:** `staff_invitations(id, org_id, email (trimmed, lowercased), display_name, role → roles, secure_link_id, status pending|accepted|revoked, invited_by, accepted_user_id, accepted_at, created_at, updated_at)`.
- **Constraints:** a partial unique index on `(org_id, lower(email)) where status = 'pending'`. Audited.
- **Access:** read with `users.view`. Expiry is derived from the link, as « Expirée » when `expires_at` has passed.
- **RPCs:**
  - `create_staff_invitation(p_actor, p_email, p_display_name, p_role, p_token_hash)` and `renew_staff_invitation(p_actor, p_id, p_token_hash)` (**service role only**; every check is made as `p_actor`, in the actor's org). The inviter must never learn the token, otherwise she could accept an invitation to an address she does not control (plan Task 3.18). Each requires `users.manage` for the actor. It locks the org row and applies the decision #28 guards: `provider` is refused (owned by Professionnels); system roles and the org's custom roles are accepted (#40); inviting an admin asks for confirmation in the UI (#36). It refuses an address that already has a profile in the org with a plain message (« Cette personne a déjà un accès. »), since `users.view` already lists them (Q8 for cross-org). It then creates the link and the invitation and returns the id.
  - `revoke_staff_invitation(p_id)` revokes the link too. `list_staff_invitations()`.
  - `accept_staff_invitation(p_token_hash, p_user_id)` (service role) consumes the link, inserts `profiles` (org, display name, `active`) and `user_roles`, and marks the invitation `accepted`, in one transaction.

**Flow:**

1. « Inviter » (`users.manage`) opens a dialog with « Nom », « Courriel » and « Rôle ».
2. The **`staff-invite`** function (`verifyAuth(req, { permission: 'users.manage' })`):
   - generates the token and calls `create_staff_invitation` with the service client and `p_actor` = the verified user, so the guards apply to her while the token never reaches the browser;
   - sends `core.staff_invite` through `_shared/email.ts`.

   « Renvoyer » runs the same function with `{ invitation_id }`: new token, previous link revoked, new email.
3. The invitee opens `/invitation#t=…`, which calls `resolve-link`. The page « Bienvenue chez Clinique MANA » shows the name and the address (read-only) and asks for a password, twice, with the existing `password-schema` (min 10).
4. **`accept-invite`:**
   - rate limit;
   - peek at the link; `auth.admin.createUser({ email, password, email_confirm: true })`;
   - `accept_staff_invitation`.

   If the RPC finds the link already consumed (a concurrent submit), the function deletes the auth user it just created and answers `link_used`. If `createUser` fails, nothing is consumed.
5. The page signs in with the password (`signInWithPassword`) and goes to `/accueil`. The cache rules of decision #10 apply, because the signed-in user changed.

**In « Utilisateurs et accès »:**

- « Inviter » (teal, the screen's one coloured action) replaces the note `settings.users.addNote` (« contactez l'administrateur technique »).
- Pending invitations appear in the users table, with the status « Invitation envoyée » and « Expire le … », and the actions « Renvoyer » and « Révoquer » (confirmation).
- Without `users.manage`, the rows are visible and the actions are hidden.

**Disabling a user** (Phase 2 follow-up). Data access already stops on the next request. To end open sessions too:

- `users-set-status` wraps `set_user_status` and then calls `auth.admin.updateUserById(id, { ban_duration })`. A ban refuses token refreshes; re-enabling lifts it.
- The access token already issued stays valid for at most an hour, as in ADR 0006, but it can reach no data.
- The alternative is to delete the `auth.sessions` rows from SQL (Q9).

The professional invitation (4b) reuses steps 3–5 with its own purpose handler in `accept-invite`, which creates a `provider` profile and links `professionals.profile_id`.

## 5. Auth email links on the clinic domain

**Problem.** `{{ .ConfirmationURL }}` points at `vnmbjbdsjxmpijyjmmkh.supabase.co`, a domain unrelated to the sender. That mismatch is a spam signal (the first auth email landed in Gmail spam). It also lets mail scanners consume the one-time token by prefetching the GET link.

**Templates** (`supabase/templates/*.html`, decision #21). The links become:

| Template | Link |
|---|---|
| recovery | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=recovery` |
| magic_link | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}` |
| email_change | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=email_change` |
| confirmation | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=email` (unused while sign-ups are closed) |
| reauthentication | unchanged (code `{{ .Token }}`, no link) |
| invite | unused: staff and professionals are invited by the app (§4). Keep the file as is |

- **Email change:** with double confirm, verify in Mailpit that each of the two emails carries its own `{{ .TokenHash }}`.
- **Restyle:** the same batch moves the templates to the design system (decision #29): teal `#1E837C` button, wine wordmark, font stack `Inter, -apple-system, Segoe UI, Helvetica, Arial`. They share the layout of §2.2, so auth and app emails look the same.

**`/connexion/confirmer`** is a public route, outside `RequireAuth`:

1. It validates `type` against the allowed list. `next` goes through `safeRedirect`: same origin only, default `/accueil`.
2. It shows one button, « Continuer », and only calls `supabase.auth.verifyOtp({ token_hash, type })` after the click. Prefetching scanners therefore cannot burn the token.
3. On success:
   - **`type=recovery`:** set the recovery marker from the returned session, `setRecoveryMarker(sessionIdOf(data.session.access_token))`, **before** navigating to `/reinitialiser-mot-de-passe`. Do not rely on the `PASSWORD_RECOVERY` event alone. auth-js 2.90 emits it for `type: 'recovery'` (verify), but only in this tab and possibly before the guard runs.
   - **`email_change`:** go to `/mon-compte` with the neutral notice (ADR 0006, #38).
   - **Otherwise:** go to `next`.
4. On error, show « Ce lien a expiré ou a déjà été utilisé. » with « Demander un nouveau lien ». It **never navigates** to the reset page. If another user is already signed in on a shared PC, their session stays untouched (decision #14).

**Transition:** keep the existing hash reader in `AuthProvider` for one release, since links emailed before the switch use the old format and are valid for 1 h. Then remove it.

**ADR 0006 amendment** (proposed text, applied in batch 3c):

> Recovery, magic-link and email-change links land on `/connexion/confirmer?token_hash=…&type=…` on the app's own domain. The page calls `verifyOtp` only after a click (prefetch-safe). For `type=recovery` it sets the recovery marker from the session that `verifyOtp` returns, before navigating. The URL-hash reader is kept for one release, then removed.
>
> Alternative rejected: a Supabase custom domain (`auth.cliniquemana.com`). It is a paid add-on, and the GET link would stay prefetchable.

**`config.toml`:** `site_url` stays `http://localhost:5173`, and the template `content_path`s are unchanged (the content changes). No new redirect URL is needed: links use `{{ .SiteURL }}` directly. `{{ .RedirectTo }}` is still validated by Auth against `additional_redirect_urls`.

**Staging dashboard** (Jonathan's go-ahead, §12):

- paste the five changed templates;
- set Site URL to the URL the app is served from (expected `https://app.cliniquemana.com`, Q2);
- check that the redirect allow-list holds `/connexion/confirmer` and `/reinitialiser-mot-de-passe`;
- fix the `_dmarc.cliniquemana.com` record (missing `;` before `rua=`, noted in Phase 1).

## 6. E-signature (`core/signing`)

### 6.1 Documenso integration

**`_shared/documenso.ts`** is ported from PS Hub (`approve-contract`, `resend-contract-email`, `documenso-webhook`). Its methods:

- `createEnvelope(pdf, payload)`: v2 multipart `envelope/create` (the recipients' fields inline), with `externalId` set to our `signature_request.id`;
- `distribute`, `get`, `redistribute`, `cancel`, `downloadSigned`, all keyed by the envelope id.

Requests send `Authorization: <api key>` (no `Bearer`), as PS Hub does. The base URL and key come from Settings and Vault, never from code (PS Hub hard-codes its URL: not ported). **Envelope routes only** (2026-10-08): the clinic's Documenso 2.20 marks `/api/v2/document/*` deprecated, so the client calls `/api/v2/envelope/*` and the envelope id is the request's Documenso reference; see the [envelope API plan](2026-10-08-documenso-envelope-api-plan.md).

**Do not port PS Hub's client-built PDF** (`create-contract` accepts `pdfBase64` from the browser). The PDF is rendered **server-side** from the published template version and database values (foundation design §4.3). The renderer is open question Q1, settled by a spike at the start of batch 3f.

**Signing fields** are placed at fixed coordinates:

- the template layout ends with a dedicated signature page;
- initials go in the page header on every page (legacy A5);
- no text-anchor guessing.

**Emails.** Documenso sends the signing invitations itself (`distributionMethod: EMAIL`, `language: 'fr'`, subject and message from the template version). The clinic instance is branded and sends through Resend SMTP on the clinic domain. Sequential signing (professional first, then the clinic signer if configured) then works without our own relay. Our `email_log` is not used for these emails; the record's timeline shows the signing events instead (Q3).

### 6.2 Data

**Tables:**

| Table | Columns | Notes |
|---|---|---|
| `document_templates` | `id, org_id, key, module_key, title, description, edit_permission` | key unique per org |
| `document_template_versions` | `id, template_id, org_id, version, status draft\|published\|archived, body, variables jsonb, signers jsonb (roles, order), published_at, published_by, created_by` | One published version per template (partial unique index). RPCs ported from legacy: `publish_template_version` (draft only, archives the previous one), `create_template_version` (refuses if a draft exists), `archive_template_version`, each checking `edit_permission`. The UI comes with Professionnels 4d |
| `signature_requests` | `id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status, documenso_document_id unique, idempotency_key, source_file_id, signed_file_id, signed_sha256, expires_at, sent_by, sent_at, viewed_at, completed_at, rejected_at, cancelled_at, rejection_reason, view_permission` | `unique (org_id, idempotency_key)` stops a double-click double send |
| `signature_request_signers` | `id, request_id, org_id, role (professional\|clinic\|client), name, email, signing_order, documenso_recipient_id, status pending\|viewed\|signed\|rejected, signed_at` | |

- **Status:** `draft → sent → viewed → signed | rejected | cancelled | expired`. Per-signer progress lives in `signature_request_signers`.
- **« Régénérer »** cancels the previous request at Documenso and here, then creates a new one.
- **Expiry:** `expires_at` defaults to 7 days (legacy). If the instance supports expiry, it is set there. Otherwise a daily job cancels overdue requests and marks them `expired`.
- **Access:** every table is read with `(select private.has_permission(view_permission))`, has no client writes and is audited.
- **Cross-module reads:** modules read status through these rows (e.g. the contract checklist reads `signature_requests` by subject). No callback into module code is needed.

### 6.3 Functions

| Function | Role |
|---|---|
| `_shared/signing.ts` | `createSignatureRequest({ purpose, templateVersionId, subject, variables, signers })`: render → store the unsigned PDF (`documents` bucket, §7) → Documenso create + distribute → row `sent`. Used by module functions (`professionals-contract-send`, 4d) |
| `signing-webhook` | `verify_jwt = false`. `X-Documenso-Secret` compared with **`timingSafeEqual`** (PS Hub uses `!==`: fixed) against that org's `documenso_webhook_secret`, from the `?org=` hint; fail closed when unset. The row is found by `externalId`, else by `documenso_document_id`, and must match the hinted org (as built after the final Phase 3 review: by `externalId` only; a document without one is acked `ignored`). `requireModuleForOrg(org, row.module_key)`, then `claim_webhook_event` |
| `signing-sync` | « Synchroniser » (legacy Keep), user-scoped with the row's `view_permission` and module gate. Pulls the document from Documenso and applies the same transitions. Also run daily for `sent`/`viewed` requests older than a day (reconciliation, in case a webhook was lost) |
| `signing-test-connection` | `settings.integrations_manage`: a read call to the API; returns « Connexion réussie » or the HTTP status, never the key |
| `signing-test-document` | `settings.integrations_manage`: sends a built-in one-page test document to the caller, which proves URL, key, webhook and storage end to end without a module |

**Webhook transitions:**

| Event | Effect |
|---|---|
| `DOCUMENT_OPENED` | `sent → viewed`, never backwards |
| `DOCUMENT_SIGNED` / recipient completed | the signer becomes `signed` |
| `DOCUMENT_COMPLETED` | Requires every signer done. Downloads the signed PDF (Documenso appends the certificate) to `signed-documents/{org}/signing/{request}/signed.pdf` with `upsert` (stable path, PS Hub lesson), plus the audit log PDF if the instance exposes it separately. Stores `signed_sha256`; sets `signed` |
| `DOCUMENT_REJECTED` | `rejected` + `rejection_reason`; the subject's timeline shows it (fixes A10.9) |
| `DOCUMENT_CANCELLED` | `cancelled` |

### 6.4 « Signature électronique » settings

| Card | Content | Edit permission |
|---|---|---|
| Connexion | « Adresse de l'instance » (`https://` only, stored in `signing_settings.base_url`); « Clé d'API » write-only (« Configurée ✓ / Remplacer », `documenso_api_key`); « Tester la connexion » | `settings.integrations_manage` |
| Webhook | « Adresse du webhook » read-only with « Copier » (to paste into Documenso); « Secret » write-only (`documenso_webhook_secret`); status « Dernier événement reçu le … » or « Aucun événement reçu » | `settings.integrations_manage` |
| Envoi | « Délai d'expiration » (days, default 7); « Envoyer un document test » | `settings.integrations_manage` |

**Signataire (Phase 2 section) gains** « Courriel du signataire » (`organizations.signatory_email`), needed for the clinic signer at Documenso, and the signature image (§7).

## 7. Storage (`core/storage`)

### 7.1 Buckets

All buckets are private and created in a migration (`insert into storage.buckets … on conflict do nothing`), with their size and MIME limits.

| Bucket | Limit | Types | Written by | Read by |
|---|---|---|---|---|
| `org-assets` | 2 MB | png, jpeg, webp (no SVG: script risk) | upload flow, `settings.manage` | the logo by every org member; the signature image with `settings.manage` and by the service role (rendering) |
| `documents` | 10 MB | pdf, jpeg, png, webp, doc, docx (legacy) | upload flow, per purpose | the row's `view_permission`, or its owner |
| `signed-documents` | 20 MB | pdf | service role only (`signing-webhook`) | the request's `view_permission` |

- **Path:** `{org_id}/{module_key}/{subject_id}/{file_id}.{ext}` (A4 Change: no name in the path).

### 7.2 Files and policies

**File registry:** `stored_files(id, org_id, bucket, object_path unique, module_key, purpose, subject_type, subject_id, owner_profile_id, original_name, mime_type, size_bytes, sha256, status pending|ready|deleted, view_permission, uploaded_by, created_at, confirmed_at, deleted_at, deleted_by)`.

- **Access:** audited; read by RLS with own org, `status = 'ready'`, and `view_permission` or `owner_profile_id = auth.uid()`. The owner branch serves a provider's own documents (Phase 4).
- **Other modules** reference `stored_files.id`.

**Upload purposes** are a catalogue seeded by their module: `upload_purposes(key, module_key, bucket, upload_permission, view_permission, max_bytes, mime_types)`.

- Phase 3 seeds `org_logo` and `org_signature`.
- Phase 4 adds `professional_document`, etc. A purpose that needs an ownership rule (a provider uploading their own insurance) checks it in its module RPC; core only checks the permission.

**Policies on `storage.objects`:** no insert, update or delete policy for clients. One select policy:

```sql
using (bucket_id in ('org-assets', 'documents', 'signed-documents')
       and (select private.can_read_object(bucket_id, name)))
```

- `private.can_read_object` (security definer, stable) checks that the first path segment is the caller's org, then finds the `stored_files` row and applies its `view_permission` / owner rule.
- The function lives in `private`, like every RLS helper. pgTAP covers it, since `000_invariants` only checks `public`.

**Upload flow:**

1. **`storage-upload`** (`verifyAuth` plus the purpose's `upload_permission` and module) checks the declared size and type against the purpose, inserts `stored_files` as `pending`, builds the path itself (the client never chooses it), and returns `createSignedUploadUrl`.
2. The browser uploads directly. The bucket limits apply.
3. **`storage-confirm`** checks the stored object's real size and **content signature** (magic bytes: `%PDF`, PNG, JPEG, `RIFF…WEBP`, OLE for `.doc`, ZIP with `[Content_Types].xml` for `.docx`), records the `sha256`, and sets `ready`. A mismatch deletes the object, with « Ce fichier n'est pas du type annoncé. »

**Reads:** `createSignedUrl(path, 300, { download: original_name })` from the client, under the select policy (A4 Change: 5 min instead of 1 h).

**Deletion:**

- the file is soft-deleted (`deleted`) by the module's RPC;
- SQL cannot delete storage objects (Supabase blocks direct deletes on `storage.objects`), so the daily `storage-cleanup` function removes them through the Storage API: `pending` files older than 24 h and `deleted` files older than 30 days.

**Phase 2 deferrals:**

- « Identité légale » gains « Logo » (`organizations.logo_file_id`);
- « Signataire » gains « Image de signature » (PNG with transparency recommended, `organizations.signature_file_id`);
- both are set through `set_org_asset(p_kind, p_file_id)` (`settings.manage`), with preview and « Remplacer » / « Retirer ».

The email header uses a static wordmark served by the app, not the org logo (Q10).

**Legacy bucket** `professional-documents` on staging: 39 test files, no policy, not covered by the backup. Proposed: download the files into `clinique-mana-backups/`, then delete the bucket through the Storage API. **This is a Drop and a staging mutation: Jonathan's OK and go-ahead** (§12).

## 8. Scheduled jobs

- **Extensions:** `pg_cron` and `pg_net`, added back by a migration (staging's reset removed `pg_cron`).
- **Schedules live in migrations** (`cron.schedule(…)`), never in the dashboard. They are in UTC, chosen to fall at a sensible clinic hour in both EST and EDT.
- **Catalogue:** `scheduled_jobs(key pk, module_key, label, description, cron_job_name, kind sql|function)`.
- **Per-org switch:** `org_scheduled_jobs(org_id, job_key, enabled)`. A cron entry is database-wide, so each run loops over the orgs where the job is enabled **and** its module is enabled.
- **Run log:** `scheduled_job_runs(id, job_key, org_id, started_at, finished_at, status ok|error, detail)`. pg_net calls are asynchronous, so the called function writes its own outcome; `cron.job_run_details` cannot tell.
- **Calling a function:** `net.http_post` to `<project_url>/functions/v1/<fn>` with `Authorization: Bearer <internal secret>`. Both values come from **database-level Vault secrets** (`project_url`, `internal_function_secret`; not org secrets), and the function checks the secret with `verifyServiceRoleAuth`.

**Jobs:**

| Job | Kind | Schedule (UTC) | Phase |
|---|---|---|---|
| `core.rate_limits_cleanup` | sql | hourly | 3 |
| `core.webhook_events_purge` | sql | daily 08:10 | 3 |
| `core.secure_links_purge` (12 months after use, revocation or expiry) | sql | daily 08:20 | 3 |
| `core.email_log_retention` (anonymise after 24 months) | sql | daily 08:30 | 3 |
| `core.storage_cleanup` | function | daily 08:40 | 3 |
| `core.signing_reconcile` (+ expiry) | function | daily 08:50 | 3 |
| `professionals.insurance_expiry_notice` (email 7 days before, business context §5) | function | daily 11:00 | 4c |

**« Tâches planifiées » section** (`/parametres/taches-planifiees`):

- **Visible with** `settings.view`. It lists each job (label, description, schedule shown in clinic time, last run, last status, last error) and the last 20 runs.
- **With `settings.manage`:** « Activer » / « Désactiver » for business jobs only (maintenance jobs are always on), and « Exécuter maintenant », which runs the job for the caller's org only, through `run_scheduled_job_now(p_key)`.

Phase 2 deferred this section to Phase 4. Phase 3 has jobs whose failures someone must see, so **build it in Phase 3** (Q11). The insurance job then only adds a row.

## 9. Settings sections added in Phase 3

They follow the Phase 2 patterns: `SettingsCard` stacks, outline « Enregistrer » until the card is dirty (#34), no save on arrow keys (#36), switches with Space or a click only (#39), « Lecture seule » for viewers, write-only secrets.

**New core permissions,** admin by default:

- **`settings.email_manage`** « Gérer les courriels de la clinique »: sender, templates, test sends, the send log;
- **`settings.integrations_manage`** « Gérer les clés d'intégration ».

**`set_org_secret` / `delete_org_secret` require `settings.integrations_manage`** instead of `settings.manage`. Every org secret is an integration key, and an adjointe given `settings.manage` by override to edit the clinic identity should not be able to replace the Resend key.

| Section | URL | Visible with | Editable with | Content |
|---|---|---|---|---|
| Courriels (`email`) | `/parametres/courriels` | `settings.view` | `settings.email_manage`; the key and domain with `settings.integrations_manage` | Expéditeur · Clé Resend + secret du webhook (write-only) and « Dernier événement reçu » · Modèles (§2.2) · Historique d'envoi (filters: template, status, period; visible with `settings.email_manage`) |
| Signature électronique (`signing`) | `/parametres/signature-electronique` | `settings.view` | `settings.integrations_manage` | §6.4 |
| Tâches planifiées (`jobs`) | `/parametres/taches-planifiees` | `settings.view` | `settings.manage` | §8 |
| Utilisateurs et accès (Phase 2) | — | `users.view` | `users.manage` | « Inviter », pending invitations (§4) |
| Identité légale, Signataire (Phase 2) | — | `settings.view` | `settings.manage` | Logo; signatory email and signature image |

**« Intégrations » is not built in Phase 3.** It has nothing to hold yet: Resend and Documenso have their own sections. It arrives with Google Places in Professionnels 4a. With the defaults, the adjointe sees Courriels, Signature électronique and Tâches planifiées read-only, and the conseillère still has no Paramètres (decision #19).

## 10. Edge functions

`verify_jwt` is declared per function in `config.toml`. « Public token » is the new §7 category: anon key required, no user, the token authorizes, rate limit first.

| Function | Caller | `verify_jwt` | Auth | Module gate |
|---|---|---|---|---|
| `email-preview` | Settings | false | `verifyAuth`, `settings.view` | core; a module template needs that module enabled |
| `email-test-send` | Settings | false | `verifyAuth`, `settings.email_manage` | same |
| `send-email` | cron / internal | false | `verifyServiceRoleAuth` | `requireModuleForOrg` from the row |
| `resend-webhook` | Resend | false | Svix signature, `timingSafeEqualBytes`, org secret | `requireModuleForOrg(org, email_log.module_key)`; ack if disabled |
| `resolve-link` | invitee | true | public token, rate limit | `requireModuleForOrg(link.org, purpose.module_key)` |
| `accept-invite` | invitee | true | public token, rate limit | same |
| `staff-invite` | Settings | false | `verifyAuth`, `users.manage` | core |
| `users-set-status` | Settings | false | `verifyAuth`, `users.manage` | core |
| `storage-upload`, `storage-confirm` | app | false | `verifyAuth` + purpose `upload_permission` | purpose's module |
| `storage-cleanup` | cron | false | `verifyServiceRoleAuth` | per org, from the rows |
| `signing-webhook` | Documenso | false | `X-Documenso-Secret`, `timingSafeEqual`, org secret | `requireModuleForOrg(org, request.module_key)` |
| `signing-sync` | app / cron | false | `verifyAuth` + row `view_permission`, or `verifyServiceRoleAuth` | request's module |
| `signing-test-connection`, `signing-test-document` | Settings | false | `verifyAuth`, `settings.integrations_manage` | core |

New shared files:

- `_shared/email.ts` (render, layout, transport, log);
- `_shared/svix.ts`;
- `_shared/documenso.ts`;
- `_shared/signing.ts`;
- `_shared/links.ts` (token, hash, URL);
- `_shared/rate-limit.ts`;
- `_shared/storage.ts` (paths, content sniffing);
- `_shared/webhooks.ts` (claim helpers, a response helper without CORS).

## 11. Testing

**pgTAP** (one file per migration, written first; `000_invariants` green, with its new commented exceptions):

- privileges and RLS for every new table, cross-org isolation, disabled users;
- `secure_links`:
  - atomic single use: two consumes, one wins;
  - expiry, revocation, purpose mismatch;
  - one live link per subject;
  - no client privilege;
- the staff invitation RPCs and their guards (provider refused, custom roles accepted, in-org duplicate, last-admin rule untouched);
- template resolution (override, else default), placeholder validation, `reset_email_template`;
- `email_log` transitions that never go backwards, and the `view_permission` policy;
- `claim_webhook_event` lease, duplicate and takeover; `consume_rate_limit` windows;
- `can_read_object` with `storage.objects` fixtures inserted as `postgres`: own org, other org, `pending`, `deleted`, owner branch;
- the permission switch on `set_org_secret`;
- the scheduled-job catalogue and the per-org switch;
- the audit rows, with `token_hash` redacted.

**Deno** (`npm run test:functions`, mocked `fetch`):

- Svix verification against the published test vectors (tolerance, multiple signatures, `whsec_` prefix);
- the Documenso secret check, fail-closed when unset;
- rendering: escaping, unknown and required variables, the plain-text part, the clinic-timezone dates;
- the Resend client: retry on 429/5xx, `Idempotency-Key`, tags, error reduced to a code;
- token generation and hashing;
- `resolve-link` responses: unknown and revoked byte-identical;
- the `accept-invite` compensation path (consumed link → created user deleted);
- MIME sniffing;
- the Documenso client payloads (`externalId`, fields, language);
- webhook transitions.

**Vitest:**

- each new section by permission (editable, read-only, hidden);
- the template editor (cheat-sheet, preview iframe `sandbox`, test send);
- the invite dialog and the pending invitations;
- the `/invitation` page states (valid, expired, used, invalid, rate-limited, password rules);
- `/connexion/confirmer`:
  - no `verifyOtp` before the click;
  - the recovery marker set before navigation;
  - `next` through `safeRedirect`;
  - an error never navigates to the reset page;
  - another signed-in user is left untouched;
- the ADR 0006 tests updated.

**Local, in the browser** (`http://localhost:5173`, the four accounts, Mailpit):

- an invitation round trip;
- recovery, magic link and double-confirm email change through `/connexion/confirmer`;
- a template edit, preview and test;
- logo upload;
- denial checks with the adjointe and the conseillère.

Documenso runs against a mock server locally (or its Docker image, optional).

**Staging smoke test** (after the merge, with Jonathan's go-ahead for each step):

1. Jonathan pastes the Resend key and the webhook secret.
2. « M'envoyer un test » arrives; the status reaches « Livré » through the webhook.
3. A send to `bounced@resend.dev` shows « Adresse introuvable »; `complained@resend.dev` shows its status too.
4. Invite a test address, accept it, sign in, check the role.
5. Disable that user, check that its refresh fails, re-enable.
6. Forgot password: the link is on `app.cliniquemana.com`, the reset completes. Magic link. Email change.
7. Check in Gmail that the auth emails land in the inbox (SPF, DKIM and DMARC pass in « Afficher l'original »).
8. Documenso: test the connection, send the test document, sign it; the signed PDF is in `signed-documents`, the webhook status shows the event.
9. Upload a logo and a signature image.
10. « Tâches planifiées » shows the maintenance runs from the next morning.

## 12. What Jonathan must provide or approve

| # | Item | Notes |
|---|---|---|
| 1 | **Resend API key for the app** | Sending-only, restricted to `gestion.cliniquemana.com`, separate from the Auth SMTP key. **Jonathan pastes it himself** in « Courriels » (write-only); it never goes through chat or git |
| 2 | **Resend webhook** | Create the endpoint in the Resend dashboard (`…/functions/v1/resend-webhook?org=<org_id>`, delivery events), paste its signing secret in « Courriels ». Turn **off** open and click tracking on the domain |
| 3 | **Documenso instance** | Self-hosted at e.g. `sign.cliniquemana.com`, hosted in Canada if possible. Needs a signing certificate (`.p12`; required by self-hosted Documenso to seal PDFs), SMTP through Resend on the clinic domain, clinic branding, an admin account and team, an **API token**, and a **webhook** (our URL + a secret), pasted in « Signature électronique » |
| 4 | **DNS** | Record and TLS for the signing domain; fix `_dmarc.cliniquemana.com` (missing `;` before `rua=`); confirm `app.cliniquemana.com` points at Vercel |
| 5 | **Supabase Auth on staging** | Paste the 5 updated templates, set Site URL, check the redirect URLs (§5) |
| 6 | **Staging secrets** | Function secrets `INTERNAL_FUNCTION_SECRET`, `ALLOWED_ORIGINS`, `EMAIL_TRANSPORT=resend`; database Vault secrets `project_url` and `internal_function_secret` for `pg_net` (SQL given in the plan, run by Jonathan or with his go-ahead) |
| 7 | **Drop: legacy bucket** `professional-documents` (39 test files) | Back up, then delete through the Storage API. No inventory feature is dropped |
| 8 | **Loi 25** | Christine decides on the EFVP for Resend (US) and the Documenso host, and updates the privacy policy's list of processors (§2.5) |
| 9 | **Merge = deploy** | As usual: push, PR, and merge each need his go-ahead (CLAUDE.md §11) |

## 13. Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | How are contract PDFs rendered server-side? Supabase Edge has tight CPU limits | Spike first in 3f. Restrict template bodies to structured markup (headings, paragraphs, lists, tables for Annexe A) and render with a pure-JS library (pdfmake) in an edge function, with Inter embedded. If it exceeds the CPU budget or Christine needs Word-level fidelity, run Gotenberg (HTML → PDF) on the Documenso host instead |
| Q2 | Which URL serves the app on staging (Auth Site URL, link host)? | `https://app.cliniquemana.com` while staging is the only remote environment; switch when production exists |
| Q3 | Who sends signing emails: Documenso or us? | Documenso (branded, Resend SMTP, sequential signing works). Revisit if Christine wants them in our templates and timeline (`distributionMethod: NONE`, plus our relay for the next signer) |
| Q4 | Background retry queue for failed sends? | Not in Phase 3: in-request retries plus a visible « Renvoyer ». Add an outbox if reminders (Phase 4c) show failures |
| Q5 | Our own suppression list after hard bounces? | Rely on Resend's suppression for now; show the bounce on the record |
| Q6 | `email_log` retention | Anonymise the recipient after 24 months, keep the row; Christine confirms |
| Q7 | Legacy « copier le lien » (A2): tokens are hashed, so a link can be shown only when it is created | Change: « Créer un nouveau lien et le copier » (revokes the previous one); decided in the Professionnels design |
| Q8 | Inviting an address that has an account in another org (impossible while there is one clinic) | Out of scope now; when a second org exists, answer neutrally and handle it at acceptance |
| Q9 | Ending a disabled user's sessions: `ban_duration`, or deleting `auth.sessions` rows? | `ban_duration` through the Auth admin API (supported, reversible); verify that it blocks refresh on staging |
| Q10 | Logo in emails: static app asset, or the org logo through a public bucket? | Static wordmark served by the app (one clinic, no per-recipient URL, so not a tracker). Public `org-branding` bucket only if a second clinic arrives |
| Q11 | « Tâches planifiées » in Phase 3 instead of 4 (Phase 2 deferral)? | Yes: Phase 3 creates the jobs and their failures must be visible |
| Q12 | `settings.integrations_manage` gates `set_org_secret` (changes Phase 1 behaviour) | Yes: integration keys are more sensitive than clinic identity fields |
| Q13 | Neutral email change at the API level (ADR 0006: GoTrue still answers 422 `email_exists`) | Defer; do it when clients get accounts (decision #32's warning), as an edge function in front of the change |
| Q14 | Antivirus scanning of uploads | Not now (only staff and known professionals upload); revisit before the client portal |

## 14. Proposed batches (for the Phase 3 plan)

Each batch follows the Phase 2 process:

- pgTAP first;
- `db:reset && db:test && db:types` after each migration;
- spec review and quality review with live probes;
- no push and no staging change without the go-ahead.

| Batch | Content | Depends on |
|---|---|---|
| **3a. Foundations** | `pg_cron` / `pg_net`; `rate_limits` + `consume_rate_limit`; `webhook_events` + claim RPCs; permissions `settings.email_manage`, `settings.integrations_manage` (+ the `set_org_secret` switch); new `ErrorCode`s; `_shared/webhooks.ts`, `rate-limit.ts`; scheduled-job catalogue, runs, per-org switch and the « Tâches planifiées » section; invariant exceptions; CLAUDE.md §7 « public token functions » | — |
| **3b. Email** | `email_settings`, `email_template_defaults`, `email_templates`, `email_log`; `_shared/email.ts` (layout, render, Resend + Mailpit transports), `_shared/svix.ts`; `email-preview`, `email-test-send`, `send-email`, `resend-webhook`; « Courriels » section; retention jobs | 3a |
| **3c. Auth links on the clinic domain** | Restyled templates with `token_hash` links; `/connexion/confirmer` (click-to-verify, recovery marker); hash-reader transition; ADR 0006 amendment; `config.toml`; staging dashboard checklist | — (can run beside 3b) |
| **3d. Secure links + staff invitations** | `secure_link_purposes`, `secure_links`, `_shared/links.ts`; `resolve-link`, `accept-invite`; `staff_invitations` + RPCs; `staff-invite`, `users-set-status`; `/invitation` page; « Inviter » and pending invitations; ADR 0007 « Secure links and public token functions » | 3a, 3b |
| **3e. Storage** | Buckets; `upload_purposes`, `stored_files`, `can_read_object` + `storage.objects` policy; `storage-upload`, `storage-confirm`, `storage-cleanup`; logo, signature image, `signatory_email`; legacy-bucket runbook (executed only with the go-ahead) | 3a |
| **3f. E-signature** | PDF renderer spike (Q1); `signing_settings`, `document_templates`, versions + RPCs, `signature_requests`, signers; `_shared/documenso.ts`, `_shared/signing.ts`; `signing-webhook`, `signing-sync`, `signing-test-connection`, `signing-test-document`; reconcile/expiry job; « Signature électronique » section; ADR 0005 status update | 3a, 3e |
| **3g. Wrap-up** | `docs/modules/core.md`, CLAUDE.md (§4, §7, §8), status doc, inventory ticks; full checks; browser walkthrough; final branch review; staging smoke plan (§11) handed to Jonathan | all |
