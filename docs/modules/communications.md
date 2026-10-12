# Module `communications` (« Communications »)

The clinic's conversations with its clients: the Gmail mailboxes `info@cliniquemana.com` (the clinic's inbox) and `administration@cliniquemana.com` (payments: the Interac notices, read by Facturation later), mirrored in the app and read in « Courriels » (CM1, CM2), the composer and the Gmail send (CM3), « Rédiger avec l'IA » (CM4), and the SMS (batch SM, lane C). Resend keeps the transactional email (invitations, reminders, notices). Plan: [coding plan §11](../plans/2026-10-11-modules-coding-plan.md#11-communications-communications--batches); roadmap [§2.4](../plans/2026-10-11-next-modules-roadmap.md) and §2.4 bis (what PS Hub brings and the flaws fixed); decisions CM-1… in the [decisions log](../plans/2026-10-07-decisions-log.md#communications-decisions-2026-10-12).

- **Registry:** `modules.key = 'communications'` (migration `20261012184051_communications_module`), no dependency besides core (Clients is optional: the thread → client link waits for it). It **starts disabled** in every clinic; an admin enables it in Paramètres → Modules.
- **Permissions:** `communications.inbox` (read the shared mailboxes), `communications.mailboxes_manage` (connect, disconnect, synchronise, the « Courriels Gmail » settings). Template defaults: admin only (CM-1); the clinic gives `communications.inbox` to Conseillère and Adjointe in Rôles. Later: `communications.send` (CM3), `communications.ai_draft` (CM4), `communications.sms` / `communications.sms_manage` (SM).
- **Frontend:** `src/modules/communications/` (manifest, `index.ts`, `api/`, `hooks/` (`mailKeys`), `lib/`, `schemas/`, `pages/`); i18n `modules.communications.*`.
- **Tests:** pgTAP `096_communications_module`, `103_communications_gmail`; Deno tests next to each function and `_shared/gmail/*`; Vitest next to each file.

## Batches

| Batch | What | Status |
|---|---|---|
| Skeleton | module row, the two first permissions, manifest | built |
| CM1 | the Gmail connection and mirror: `mail_connections` (encrypted tokens), `gmail-connect` / `gmail-callback` (signed state), `gmail-webhook`, `gmail-sync`, `gmail-watch-renew`, the jobs, the 24-month purge, Paramètres → « Courriels Gmail » (the status screen) | built |
| CM1b | the Interac notices of `administration@` parsed into `interac_notices` for Facturation (`private.interac_notices_since`) | waits for sample notices (status doc E11, CM-9) |
| CM2 | « Courriels »: three panes, read / archive / labels, attachments, search, the thread → client link | planned |
| CM3 | composer, `gmail-send`, templates | planned |
| CM4 | « Rédiger avec l'IA » | planned |
| SM | SMS through Yeastar (R-73), lane C | in progress |

## CM1: Gmail

Migrations `20261012204037_communications_gmail` (tables, RPCs, jobs) and `20261012204041_core_webhook_events_gmail_provider` (`gmail` joins `webhook_events`' providers and `claim_webhook_event`).

### Tables

| Table | Holds | Read by | Audited |
|---|---|---|---|
| `mail_connections` | one row per mailbox and clinic (`email_address` lower case, unique per clinic): `kind` (`shared`, or `personal` with its `owner_profile_id`), `status` (`connected`, `needs_reconnect` with a `status_reason` code, `disconnected`), the scopes granted, who connected and disconnected it | `select` through RLS: the shared ones for holders of `communications.inbox` or `.mailboxes_manage`, a personal one for its owner (`private.visible_mail_connection_ids()`) | yes |
| `mail_connection_tokens` | the access and refresh tokens, encrypted with `private.encrypt_pii` under a key version (ADR 0004; listed in `private.pii_encrypted_values()`, rotated by the runbook's step 4) | nobody: no privilege for any role, `service_role` included; `get_mail_connection_credentials` is the one reader | yes, both tokens redacted |
| `mail_sync_state` | the history id, the sync lease, `sync_requested_at`, the last outcome (a code), the 45-day first pass's page token, the Pub/Sub watch | nobody directly: `list_mail_connections` | no (CM-2) |
| `mail_labels` | the mailbox's labels (system and user) | RLS as above | no (CM-2) |
| `mail_threads` | one row per Gmail thread with its summary kept by the database (subject, last snippet and sender, counts, unread, labels union) | RLS as above | no (CM-2) |
| `mail_messages` | headers, addresses, labels, `body_html` / `body_text` (≤ 1 MB each) until the purge, `search_vector` (subject, sender, snippet; French) | RLS as above | no (CM-2) |
| `mail_attachments` | each part: `pending`, `stored` (with its `stored_file_id`, purpose `mail_attachment`), `unsupported_type`, `too_large`, `failed`, `purged`; inline images keep their `content_id` | RLS through the message | no (CM-2) |
| `mail_thread_links` | thread → client: `unlinked`, `needs_review` (several candidates: « À rattacher »), `linked`; `client_id` has no FK until Clients lands | RLS through the thread | yes |

The upload purpose `mail_attachment` (bucket `documents`, read with `communications.inbox` through `storage-sign`) takes PDF, JPEG, PNG, WebP and Word up to 10 MB; nothing is uploaded from a browser with it.

### RPCs

- **User:** `get_communications_settings()` / `set_communications_settings(p_patch)` (`communications.mailboxes_manage`; `pubsub_topic`, Google's full topic name, and `pubsub_service_account`, the push subscription's service account, both checked: a malformed one is a French P0001 whose HINT names it), `list_mail_connections()` (the caller's visible mailboxes with their sync state, thread and unread counts; never a token).
- **Service role only** (the functions; each takes the org from the database or the verified caller): `get_communications_settings_for_org`, `store_mail_connection` and `disconnect_mail_connection` (actor model, conventions §8b: `p_actor` re-checked as an active member holding `communications.mailboxes_manage`; audit actor and source set), `get_mail_connection_credentials`, `set_mail_access_token`, `set_mail_connection_status`, `request_mail_sync`, `list_mail_connections_to_sync`, `acquire_mail_sync_lease`, `finish_mail_sync`, `reset_mail_history` (refused while another pass holds the lease), `set_mail_watch`, `upsert_mail_labels`, `upsert_mail_messages` (≤ 50 a call; creates the threads and their link rows, keeps a body once stored, recomputes the summaries), `delete_mail_messages`, `apply_mail_label_changes`, `list_mail_attachments_to_store`, `record_mail_attachment`.

### Edge functions

| Function | Category | What |
|---|---|---|
| `gmail-connect` | user (`communications.mailboxes_manage`) | `start` → Google's consent URL for a shared mailbox (CM-10; scopes `gmail.modify` and `gmail.send` only, offline, `prompt=consent`, the fixed redirect `APP_URL/courriels/retour-google`, a signed state: clinic, person, nonce, 10 minutes); `disconnect` → stops the watch (with a refreshed token), revokes the grant, deletes the tokens and the sync state; the mirror stays |
| `gmail-callback` | user (`communications.mailboxes_manage`) | the app's return page posts `{ code, state }` with the session (CM-3): the state's MAC, age and purpose, the same clinic and person, the nonce spent once (`link_invalid` / `link_expired` / `link_used`), the code exchanged, `gmail.modify` required, then `store_mail_connection` |
| `gmail-webhook` | webhook | Pub/Sub's authenticated push at `?org=<id>` (CM-4): one per-IP hit, then Google's signed token verified (`_shared/google-oidc.ts`: keys, issuer, audience `clinique-mana:gmail-push:<org>`, expiry, `email` = the setting `pubsub_service_account`, required), the module gate, `claim_webhook_event('gmail', '<org>:<messageId>')`, the named mailbox matched exactly, then an inline sync (25 s); a held lease fails the claim with 503 so Pub/Sub redelivers |
| `gmail-sync` | user (« Synchroniser », `{ connection_id, full? }`) and job `communications.gmail_sync` (every 15 min) | the sync of `_shared/gmail/sync.ts` (below) |
| `gmail-watch-renew` | job `communications.gmail_watch_renew` (hourly at :35) | renews each mailbox's Pub/Sub watch within 2 days of its expiry (Google stops after 7 days) |

`_shared/gmail/`: `env.ts` (Google's origins; the local fake's only while `APP_URL` is local), `client.ts` (the Gmail API calls), `credentials.ts` (the OAuth application from the org secrets `google_oauth_client_id` / `google_oauth_client_secret`, the token exchange and refresh; `invalid_grant` → `needs_reconnect`), `mime.ts` (bodies, addresses, parts), `sync.ts`. `_shared/oauth-state.ts` signs and checks the state (HMAC of `INTERNAL_FUNCTION_SECRET`).

**One sync pass** (under the mailbox's 5-minute lease; a second caller is `skipped` and nothing is lost: `sync_requested_at` stays newer than `last_sync_at`): the access token, the labels, then the **first pass** (CM-7: the profile's history id read first, `newer_than:45d`, resumable by its page token) or the **incremental pass** (`history.list`; the history id advances to the largest record applied, CM-6; a 404 / 410 forgets it and runs the first pass again), the attachments still to copy (20 a pass, sniffed, `register_system_file` + upload, 5 attempts; CM-5), the watch, then `finish_mail_sync`. Nothing logs an address, a subject or a body.

**Jobs:** `communications.gmail_sync` and `communications.gmail_watch_renew` (business jobs: **off** until the clinic turns them on), `communications.mail_bodies_purge` (SQL, maintenance, daily 08:45 UTC: bodies and snippets of messages older than 24 months nulled, their files soft-deleted, headers kept; CM-8).

### Frontend

- Paramètres → **Courriels Gmail** (`courriels-gmail`, `communications.mailboxes_manage`): « Boîtes connectées » (each mailbox's state in plain words, last sync, counts, not watched while a topic is set, « Synchroniser », « Reconnecter », « Déconnecter » confirmed, « Connecter une boîte »), « Application Google » (the OAuth client's two secrets, write-only, changed with `settings.integrations_manage`; the redirect URI to copy), « Notifications de Google » (the topic and the service account in one form; the push address and the audience to copy), « Tâches planifiées » (the two jobs through core's `ScheduledJobState`).
- `/courriels/retour-google` (`communications.mailboxes_manage`): Google's return; posts the code and state once (a one-shot query keyed on the state), starts the first sync, then goes back to the settings, replacing the address.

### Local development

`npm run fake:gmail` (port 55392, `scripts/fake-gmail.ts` over `_shared/testing/fake-gmail.ts`): the consent page, the token endpoint and the Gmail API over one mailbox of fictional French messages. `supabase/functions/.env` points the functions at it (`GMAIL_API_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`, `GOOGLE_ACCOUNTS_BASE_URL`, `GOOGLE_ACCOUNTS_PUBLIC_URL`, `GOOGLE_CERTS_BASE_URL`, `.env.example`); the seed enables the module for the local clinic, stores the fake's OAuth client, and sets a topic and the service account the fake's signed pushes name (only Admin holds `communications.*`, as in the template). `curl -X POST http://127.0.0.1:55392/__fake/deliver` adds a message; once the mailbox is watched, the fake posts Pub/Sub's push, with a token signed by its own key (served at `/oauth2/v3/certs`), to the local `gmail-webhook`.

## What the module publishes

Nothing yet for other modules. CM1b will publish `private.interac_notices_since(org, since)` to Facturation; CM2 links threads to clients through the Clients module's published lookup.
