# Documenso envelope API migration — plan

**Date:** 2026-10-08 · **Status:** approved 2026-10-08 (Jonathan: E-3 single step, R3 → E-13); Batches 1–4 implemented 2026-10-08 (§6), Batch 5 (live checks) open · **ADR:** [0005](../adr/0005-documenso-replaces-docuseal.md) (amended by this plan) · **Design:** [Phase 3 §6](2026-10-08-phase-3-shared-services-design.md#6-e-signature-coresigning) · **Plan:** [Tasks 3.31–3.33](2026-10-08-phase-3-shared-services-plan.md#task-331-signing-database) · **Instance:** `https://sign.cliniquemana.com`, Documenso 2.20.0

## 1. Summary and decisions

The clinic's instance marks every `/api/v2/document/*` route deprecated. This plan moves `_shared/documenso.ts` and everything that stores or matches a Documenso id to `/api/v2/envelope/*`. Some things stay exactly as they are: the state machine, the send claim, recovery, idempotency, webhook security, recipient matching (by address after create, by signing order on recovery) and every user-visible answer. Nothing real has been signed and staging has no Documenso configured, but the Phase 3 migrations are applied there. So the DB change is one **new** migration; no applied migration is edited.

Facts used below that the brief did not establish (from the instance's OpenAPI and server bundle, `server-build-2.20.js`):

- **Envelope ids.** They are `envelope_` + 16 characters of `abcdefhiklmnorstuvwxyz` (`prefixedId` → `fancyId = customAlphabet("abcdefhiklmnorstuvwxyz", 16)`). The clinic's org id has the same shape: `org_sduaarmnmsunmwvt`, in the runbook §6. **Confirmed live** (staging, 2026-10-08): `envelope_hsnzzscbexaddcar`.
- **`identifier` in an inline field** is the index of the file in `files`, or its name. Documenso's own embed client sends `identifier: itemIdToIndex.get(field.envelopeItemId)`.
- **Expiry is per recipient.** The job is `internal.process-recipient-expired`, the audit entry is `DOCUMENT_RECIPIENT_EXPIRED`, recipients carry `expired` / `expiresAt`, and the owner gets an email. The envelope **stays PENDING**, and `redistribute` "refreshes the signing-link expiration… renewing any expired links".
- **Error responses.** `GET /envelope/{id}` documents 404 `{ message, code, issues? }`. `cancel` and `delete` document only 200/400/401/403/500: their answer for a missing envelope is undocumented.
- **Secrets in responses.** `GET /envelope/{id}` recipients carry `token`. `distribute` and `redistribute` answers carry `token` and `signingUrl` per recipient. These are never parsed or logged.
- **Webhook header** (`execute-webhook-call.js`, confirmed live 2026-10-08): exactly `X-Documenso-Secret: <raw secret>`, as `signing-webhook` reads it.
- **The deprecated document read embeds the file** (confirmed live on staging, 2026-10-08): `GET /api/v2/document/{id}` carries `documentData`, which with the database upload transport is the whole PDF in base64 (1,122,716 characters for the signed test document), over the client's 1 MB JSON cap (`MAX_JSON_BYTES`): `badResponse` → `signing-sync` 502. The envelope read carries only `envelopeItems[].documentDataId`, so the move fixes it; the client's `envelopeSchema` reads nothing of the file, and a test pins that an over-1 MB read is refused while unknown fields are dropped.
- **Download content type.** `GET /envelope/item/{id}/download` declares `application/json` for its 200, but the OpenAPI text says `signed` "returns the completed document with all signatures and the audit trail". The client keeps checking `%PDF-`.

### Decisions

| # | Decision | Why |
|---|---|---|
| E-1 | **The canonical Documenso reference is the envelope id**, stored in the existing `signature_requests.envelope_id`. There is no new column and the CHECK `^envelope_[A-Za-z0-9_-]{1,64}$` stays (a superset of the observed `envelope_[a-z]{16}`; `documenso.ts` `ENVELOPE_ID` is the same regex, and a parity test pins them). New: every non-draft request must have one (`signature_requests_sent_has_envelope`, replacing `signature_requests_check2`), and it is unique per org (`signature_requests_org_id_envelope_id_key`, like `unique (org_id, documenso_document_id)`). | One id addresses every envelope route. The column already exists, is validated and is returned by every read RPC. A second `documenso_envelope_id` column would duplicate it, and renaming it is destructive for no gain. The CHECK stays loose on purpose: a tighter one would refuse at `mark_signature_request_sent`, i.e. after the emails left, if Documenso ever changed the length. |
| E-2 | **`documenso_document_id` and `superseded_document_ids` are deprecated.** They stay (nullable, `comment on column … 'Deprecated'`), are never written again, and still come back as `null` from the read RPCs whose return type would otherwise change (`create_signature_request`, `get_signature_request`, `list_signature_requests_to_reconcile`, `get_signing_request`). Superseded envelopes go to the new `superseded_envelope_ids text[]` (same cap of 20, same `private.signing_superseded`). The migration refuses to run (P0001) if any row holds a document id without an envelope id. A later cleanup migration (two-step rule, conventions §1) drops both columns and the four RPCs' dead output columns. | The envelope API never returns the numeric id at create; the webhook's legacy `payload.id` is not needed. The guard makes "no data to migrate" a checked fact, not an assumption. |
| E-3 | **The four RPCs whose parameters name the document are dropped and re-created, keyed by envelope:** `mark_signature_request_sent(p_id, p_envelope_id, p_source_file_id, p_signer_recipients, p_expires_at)`, `mark_signature_request_failed(p_id, p_error_code, p_envelope_id default null)`, `apply_signing_event(p_org_id, p_request_id, p_envelope_id, p_event, p_recipient_id, p_at, p_reason)` and `recover_signature_request(p_org_id, p_id, p_envelope_id, p_signer_recipients)`. Two whose signature does not change use `create or replace` with one-line changes: `list_signature_requests_to_reconcile` and `set_signing_settings`. **Deviation:** conventions §1 asks for two steps before a destructive change. It is done in one step here (recorded in ADR 0005). | Postgres cannot rename a parameter with `create or replace`, and `apply_signing_event` has no envelope parameter at all. Overloads would leave old bodies that break the new check. These RPCs are service-role only; their only callers are this repo's functions, checked by `_shared/rpc-contract.test.ts`, which already follows `drop function`. No caller can run on staging (no Documenso, so every send stops at `not_configured` before the claim). |
| E-4 | **Webhook matching: `externalId` first, then `envelopeId`.** An `externalId` that is not a uuid → 200 `ignored` before the claim (unchanged). Then `payload.envelopeId` is required and must pass `ENVELOPE_ID`, else 400. `apply_signing_event` finds the row by request id and compares the envelope with the recorded or superseded one (same outcomes as today). The legacy numeric `payload.id` and `payload.Recipient` are ignored. **Claim id** `<org>:<EVENT>:<envelopeId>[:<version>]`. The version is now ISO-normalised (`isoTime(createdAt) ?? isoTime(payload.updatedAt)`, else `unversioned`), which bounds the id at 36+1+64+1+73+1+24 = 200 characters, the `webhook_events.event_id` limit; with today's raw version (≤ 64) the worst case would be 240. Claim payload `{ event, envelope_id, external_id }`. **`webhook_events` needs no migration:** old ids (`…:<digits>`) and new ones (`…:envelope_…`) cannot collide, none exist on staging, and the retention job purges them. | The order keeps "a document made outside the app" free (no claim, no row) and keeps "Documenso ids are per instance" safe (matched by our own id, never by envelope alone). |
| E-5 | **Fields go inline in `/envelope/create` (one call).** Each recipient carries `fields: [{ identifier: 0, type, page, positionX, positionY, width, height }]`; there is no `fieldMeta`, as today. `field/create-many` and `addFields` are dropped. The flow becomes **create → read (recipient ids by address, as today) → distribute**. **Simplification:** a refused field now fails the create, so there is no orphan draft to cancel, and there is one call fewer. | The recipient ids are not read from `distribute`'s answer: it carries tokens and signing URLs, and it arrives after the emails have left, so a bad answer would force cancelling a sent contract. |
| E-6 | **Expiry:** keep sending `envelopeExpirationPeriod: { unit: 'day', amount: expiry_days }` (already sent today). **The daily `core.signing_reconcile` stays the authority:** expire here, then cancel there. It is not merely a backstop, because Documenso expires only the signing links and leaves the envelope PENDING. The cancel of an "expired" envelope is therefore expected to answer **200**, which inverts status-doc VERIFY 8. The existing 400 tolerance in `reconcileRow` stays (it covers a race with a completion or a rejection). | Without the job, an expired request would stay `sent` forever. |
| E-7 | **Signed PDF:** `downloadSigned(envelopeId)` = `GET /envelope/{id}` → exactly one `envelopeItems` entry (else `provider_error`) → `GET /envelope/item/{itemId}/download?version=signed`. The item id is checked path-safe (`^[A-Za-z0-9_-]{1,100}$`) and **not stored** (one cheap read at completion, no schema change). The read is cheap because it carries no file data (live finding, §1: the deprecated document read embedded the PDF and overran the 1 MB cap). **The audit log and certificate are not stored separately:** the org includes both in the downloaded PDF (runbook §6, "Certificates") and the OpenAPI says `signed` carries the audit trail. The runbook marks those two settings as "do not turn off". | Fewer files, one PDF per signed contract as today. |
| E-8 | **One cancel:** `cancel(envelopeId, { reason?, draft? })` POSTs `/envelope/cancel`. On a 400 it reads the envelope back: CANCELLED → done; DRAFT → `/envelope/delete` (Documenso's 404 `NOT_FOUND` → done); anything else → the cancel's error. `draft: true`, passed when the caller *read* DRAFT or never called `distribute`, goes straight to delete. **`/envelope/delete` is never sent to a non-draft envelope.** **Simplification:** callers no longer choose a route from "is the envelope id known" (`envelopeId: state.status === 'PENDING' ? … : null` disappears), and status-doc VERIFY 3 (document delete cancels a pending one) goes away. | One id for both routes. An ambiguous `distribute` failure (timed out, but done at Documenso) is handled by cancel-then-fallback, as the document delete did before. |
| E-9 | **Ping:** `GET /api/v2/envelope?perPage=1`, with the same `{ data: [...] }` check. | The cheapest authenticated envelope read. Every JSON read the client makes stays under `MAX_JSON_BYTES` only because none embeds file data (§1). |
| E-10 | **Recipient ids stay numeric** (`signature_request_signers.documenso_recipient_id`, `signing_recipients_valid`: unchanged). `redistribute` sends `{ envelopeId, recipients: number[] }`. | The OpenAPI and the webhook payload. |
| E-11 | **Names in code follow the id:** `createDocument` → `createEnvelope`, `DocumensoDocumentState` / `…Status` → `DocumensoEnvelopeState` / `…Status`, `DocumensoError.documentId` → `envelopeId`, `ownsDocument` → `ownsEnvelope`, `readDraftDocument` → `readDraftEnvelope`; report ids `document_id` → `envelope_id` (a valid `_id` key for `report.ts`). | Every call site changes anyway; stale names would invite numeric assumptions. |
| E-12 | **The fake mirrors the envelope routes with realistic ids:** `envelope_` + 16 letters of Documenso's alphabet (counter encoded, `envelope_aaaaaaaaaaaaaaab`…), items `envelope_item_…`, recipients 101… Webhook payloads include the legacy numeric `id`, `Recipient` and recipient `token`s, and `distribute` answers include `signingUrl` / `token`, so tests prove these are ignored and never stored, claimed or reported. | A fake with `envelope_<digits>` ids would hide a leftover numeric assumption. |
| E-13 | **No owner email when a signing link expires:** `createEnvelope` sends `meta.emailSettings.ownerRecipientExpired: false`. **Correction (implementation):** the other settings do not keep the org's preferences: Documenso takes `meta.emailSettings \|\| org settings` and fills the missing keys with its defaults (all `true`, OpenAPI), so an app envelope gets every other email on. That equals the clinic's settings today (runbook §6: « default notifications unchanged »), and the runbook now says a change there does not reach app envelopes. **Help text:** the « Adresse de l'instance » example becomes `https://sign.cliniquemana.com` (`fr-CA.json` `baseUrlHelp`, and the `SigningSettingsPage` test value). | Jonathan, 2026-10-08 (R3): the app shows expired requests and its daily job closes them; a second notice in `info@` is noise. |
| E-14 | **`DocumensoError.notFound`** (default false): true only for a 404 whose body is Documenso's own `NOT_FOUND` error (`notFoundSchema`, the test `cancel` and `delete` use), on every operation, the envelope read included (`get`, and the reads inside `createEnvelope` / `downloadSigned`). Codes and `status` are unchanged. | notFound flag for outage classification, Phase 4 request (2026-10-08). |

## 2. Changes per file

### 2.1 Database: `supabase/migrations/<date -u +%Y%m%d%H%M%S>_core_signing_envelope.sql` (new)

Header: purpose, this plan, E-1…E-4, the single-step deviation (E-3), and "staging holds no Documenso id (guard)".

```sql
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_envelope', true);

-- E-2 guard: nothing to migrate, checked.
do $$ begin
  if exists (select 1 from public.signature_requests r
              where r.documenso_document_id is not null and r.envelope_id is null) then
    raise exception 'core_signing_envelope: a request holds a Documenso document id without an envelope id'
      using errcode = 'P0001';
  end if;
end $$;

alter table public.signature_requests
  add column superseded_envelope_ids text[] not null default '{}'
    check (pg_catalog.cardinality(superseded_envelope_ids) <= 20
           and pg_catalog.array_to_string(superseded_envelope_ids, ',', '-')
               ~ '^(envelope_[A-Za-z0-9_-]{1,64}(,envelope_[A-Za-z0-9_-]{1,64})*)?$'
           and (pg_catalog.cardinality(superseded_envelope_ids) = 0)
               = (pg_catalog.array_to_string(superseded_envelope_ids, ',', '-') = '')),
  add constraint signature_requests_org_id_envelope_id_key unique (org_id, envelope_id);

-- The unnamed table check of 20261008073909 l.462 is the third multi-column check:
-- signature_requests_check2. Assert it before dropping it.
do $$ begin
  if (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.signature_requests'::regclass and c.conname = 'signature_requests_check2')
     not like '%documenso_document_id IS NOT NULL%sent_at IS NOT NULL%' then
    raise exception 'core_signing_envelope: signature_requests_check2 is not the sent-needs-a-document check';
  end if;
end $$;
alter table public.signature_requests
  drop constraint signature_requests_check2,
  add constraint signature_requests_sent_has_envelope
    check (status = 'draft' or (envelope_id is not null and sent_at is not null));

comment on column public.signature_requests.documenso_document_id is
  'Deprecated (envelope API, 2026-10-08): never written; dropped by a later migration.';
comment on column public.signature_requests.superseded_document_ids is
  'Deprecated: superseded_envelope_ids replaces it.';

drop function public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz);
create function public.mark_signature_request_sent(
  p_id uuid, p_envelope_id text, p_source_file_id uuid, p_signer_recipients jsonb, p_expires_at timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
-- body of 20261008073909 l.1454–1501, with:
--   if p_envelope_id is null or p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$'
--      or p_expires_at is null or p_expires_at <= now() → 22023 'Invalid envelope id or expiry'
--   superseded_envelope_ids = private.signing_superseded(r.superseded_envelope_ids, r.envelope_id, p_envelope_id),
--   envelope_id = p_envelope_id            -- documenso_document_id not written
$$;

drop function public.mark_signature_request_failed(uuid, text, text, text);
create function public.mark_signature_request_failed(p_id uuid, p_error_code text, p_envelope_id text default null)
-- body of l.1521–1539, with:
--   p_envelope_id is not null and !~ envelope regex → 22023
--   superseded_envelope_ids = private.signing_superseded(r.superseded_envelope_ids, r.envelope_id, p_envelope_id),
--   envelope_id = coalesce(p_envelope_id, r.envelope_id)        -- the old case/when on the document id goes

drop function public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text);
create function public.apply_signing_event(p_org_id uuid, p_request_id uuid, p_envelope_id text, p_event text,
                                           p_recipient_id text, p_at timestamptz, p_reason text)
returns table (outcome text, request_id uuid, module_key text, needs_download boolean)
-- body of l.1580–1683 verbatim, with three substitutions:
--   p_documenso_document_id → p_envelope_id; v_row.documenso_document_id → v_row.envelope_id;
--   v_row.superseded_document_ids → v_row.superseded_envelope_ids

drop function public.recover_signature_request(uuid, uuid, text, text, jsonb);
create function public.recover_signature_request(p_org_id uuid, p_id uuid, p_envelope_id text, p_signer_recipients jsonb)
returns uuid
-- body of 20261008082519 l.126–177, with:
--   p_envelope_id null or !~ regex → 22023 'Invalid envelope id'
--   v_row.envelope_id is distinct from p_envelope_id → 22023 'Not the request''s envelope'
--   the final update no longer sets envelope_id

create or replace function public.list_signature_requests_to_reconcile(p_org_id uuid, p_limit int default 100) …
-- l.1757–1790 verbatim; l.1775 and l.1783: r.documenso_document_id is null → r.envelope_id is null

create or replace function public.set_signing_settings(p jsonb) …
-- l.568–~645 verbatim; l.623: r.documenso_document_id is not null → r.envelope_id is not null

revoke all on function
  public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.recover_signature_request(uuid, uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function <the same four> to service_role;
```

Each re-created function keeps its header comment, updated for "envelope". `create or replace` keeps the existing grants of the two replaced functions.

**`000_invariants`:** no change, and it must stay green. There is no new table or FK; the four functions have `search_path = ''` and are revoked from `PUBLIC` / `anon`; the new unique constraint is an index, not an FK; the audit trigger already covers the new column.

**pgTAP:**

- **New `supabase/tests/database/026_core_signing_envelope.test.sql`**, written first, in `begin … rollback`, with its own orgs A/B. Assertions (descriptions):
  - `superseded_envelope_ids exists, not null, default {}`;
  - `a sent request needs an envelope id (23514)`;
  - `signature_requests_check2 is gone; no check mentions documenso_document_id IS NOT NULL`;
  - `superseded_envelope_ids refuses a numeric id / an empty element / 21 ids (23514)`;
  - `an envelope is unique per org (23505); the same envelope in org B is accepted`;
  - `the old signatures are gone` (`hasnt_function` ×4) and `the envelope signatures exist` (`has_function` ×4);
  - `function_privs_are: anon none, authenticated none, service_role EXECUTE` ×4;
  - `mark_sent: a null or numeric envelope id → 22023`;
  - `mark_sent records the envelope and leaves documenso_document_id null`;
  - `a re-send supersedes the earlier envelope`;
  - `mark_failed records an envelope; a new one supersedes the recorded one; an abandoned draft stays abandoned`;
  - `apply_signing_event: another envelope on a sent request → not_found`;
  - `a superseded envelope's late event → ignored`;
  - `a draft holding an envelope → retry`;
  - `recover: only the draft's recorded envelope (22023 otherwise); a draft without an envelope is never recovered`;
  - `reconcile: a draft with an envelope → sync after an hour, without → abandon after a day`;
  - `set_signing_settings: an origin change is refused (P0001) while a draft holds an envelope, allowed when the open draft has none`.
- **`023_core_signing.test.sql`:**
  - the privilege table (l.76, 90, 91) gets the new signatures;
  - every `mark_signature_request_sent(…, '11', 'envelope_11', …)` loses the numeric argument;
  - every `apply_signing_event(…, '15', …)` and `mark_signature_request_failed(…, '14', 'envelope_14')` passes `'envelope_…'`;
  - assertions on `documenso_document_id` / `superseded_document_ids` (l.756, 848, 856, 864, 1012) read `envelope_id` / `superseded_envelope_ids`;
  - adjust `plan(297)`. The scenarios are unchanged.
- **`025_core_signing_function_support.test.sql`:** the `::regprocedure` casts and the privilege row (l.29, 36) get `recover_signature_request(uuid,uuid,text,jsonb)`; the calls at l.168–190 pass the envelope; adjust `plan(30)`.
- **`npm run db:types`** regenerates `src/core/supabase/database.types.ts`: `superseded_envelope_ids` and the four Args. No frontend file reads these (`src/core/signing` uses none of them).

### 2.2 Deno client: `supabase/functions/_shared/documenso.ts`

- **Module comment (l.1–48):** envelope family only, string ids, which VERIFY items are left (see §4).
- **`DOCUMENSO_PATHS` (l.53–85):**
  - `create: '/api/v2/envelope/create'`
  - `envelope: (id) => '/api/v2/envelope/' + id`
  - `distribute: '/api/v2/envelope/distribute'`
  - `redistribute: '/api/v2/envelope/redistribute'`
  - `cancel: '/api/v2/envelope/cancel'`
  - `delete: '/api/v2/envelope/delete'`
  - `download: (itemId) => '/api/v2/envelope/item/' + itemId + '/download'`
  - `list: '/api/v2/envelope'`
  - `fields` is removed.
- **Types:**
  - `CreateEnvelopeInput` (was `CreateDocumentInput`, l.104): `recipients[]` gains `fields: { type, page, x, y, width, height }[]`.
  - `DocumensoFieldInput.recipientId` goes. A `SigningField` from `_shared/pdf` (minus `role`) fits a recipient's `fields` as is.
  - `DocumensoCancelOptions` → `{ reason?: string; draft?: boolean }`.
  - `DocumensoClient` (l.187–228):
    - `createEnvelope(pdf, input) → { envelopeId, recipients: { id, email }[] }`
    - `distribute(envelopeId)`
    - `redistribute(envelopeId, recipientIds)`
    - `get(envelopeId) → DocumensoEnvelopeState`
    - `cancel(envelopeId, options?)`
    - `downloadSigned(envelopeId)`
    - `ping()`
    - `addFields` goes.
  - `DocumensoError.documentId` → `envelopeId`.
- **Ids:**
  - export `isEnvelopeId(v)` (`ENVELOPE_ID`, l.305–307, unchanged; the VERIFY marker goes once §4.2 confirms);
  - `ITEM_ID = /^[A-Za-z0-9_-]{1,100}$/`;
  - `NUMERIC_ID` (l.304) stays for recipient ids only;
  - `numericId()` → `recipientId()`; a new `envelopeId()` guard throws `provider_error` "invalid id" before any request.
- **Schemas:**
  - `createdSchema` (l.467) → `{ id: z.string() }`, then `isEnvelopeId` (else `badResponse('create')`, no id to cancel; see §5 R7);
  - `documentSchema` (l.485) → `envelopeSchema`: `id` (must equal the id asked, else bad response), `status`, `completedAt`, `externalId: z.string().nullable()` (required, as today), `recipients[{ id, email, signingOrder, signingStatus, readStatus, signedAt, rejectionReason }]` (zod drops `token`), `envelopeItems: z.array(z.object({ id: z.string() }))`;
  - `notFoundSchema` (l.475) unchanged; its VERIFY moves to §4.
- **`createEnvelope` (was l.774–827):**
  - `checkInput` unchanged, plus `subject.length <= 254` and `message.length <= 5000` → `invalid_request` (OpenAPI limits, refused before any request; see R8);
  - the payload is `{ title, type: 'DOCUMENT', externalId, recipients: recipients.map(r => ({ email, name, role, signingOrder, fields: r.fields.map(f => ({ identifier: 0, type: f.type, page: f.page, positionX: f.x, positionY: f.y, width: f.width, height: f.height })) })), meta: { …meta, dateFormat, envelopeExpirationPeriod? } }`;
  - the file goes as `form.append('files', blob, 'document.pdf')`;
  - after the create, `readEnvelope`, then match recipients by address (unchanged); a failure carries `envelopeId` so the caller can cancel.
- **`distribute` / `redistribute`** (l.848–864): `{ envelopeId }` and `{ envelopeId, recipients: number[] }`. The body is discarded unread (it holds tokens and signing URLs; the comment says so).
- **`get`** (l.866): maps `envelopeSchema` to the state (no address, no token, no items).
- **`cancel`** (l.883–921), rewritten per E-8:
  1. `draft` → `delete` first.
  2. Otherwise `cancel`: 2xx → done; 404 with Documenso's `NOT_FOUND` body → done (any other 404 is an error).
  3. A 400 → read back: CANCELLED → done; DRAFT → `delete` (2xx or Documenso 404 → done); else `statusError('cancel', 400)`.
  4. The read-back's own error never replaces the cancel's.
- **`downloadSigned`** (l.923): `readEnvelope` → one item → `ITEM_ID` → GET `download(item)?version=signed` → `readCapped` + `%PDF-` (unchanged). Zero or several items → `badResponse('download', 200)`.
- **`ping`** (l.941): `list` path; `listSchema` unchanged.
- **`documensoEventId`** (l.331): parameter `envelopeId`; doc comment gives the 200-character bound (E-4).
- **`Operation`:** drop `'fields'`, add `'delete'` (for messages).

### 2.3 `supabase/functions/_shared/signing.ts`

- **Module comment, steps 3c and 6:**
  - step 6: `createEnvelope` (fields inline) → `distribute`;
  - "cancelled first, best effort (straight to delete before `distribute`, else cancel with the fallback, E-8)".
- **`settleEarlierDocument`** (l.420–514):
  - l.429 `current?.envelope_id`;
  - l.446 `readDraftEnvelope(…, envelopeId)`;
  - l.505 `documenso.cancel(envelopeId, { draft: state.status === 'DRAFT' })`.
- **`send`** (l.517–644):
  - `documentId` / `envelopeId` / `distributed` → `envelopeId` and `distributing`;
  - `cancelAndMark` → `cleanup.cancel(envelopeId, { draft: !distributing })` then `markFailed(code, { envelopeId })`;
  - `createEnvelope` gets each signer's `fields: rendered.fields.filter(f => f.role === s.role)`. A box whose role has no signer is left out, as before;
  - delete the `addFields` block (l.601–608);
  - `distributing = true` before `distribute(envelopeId)`;
  - `documentId ??= error.documentId` → `envelopeId ??= error.envelopeId`;
  - `mark_signature_request_sent` args (l.631–638) → `{ p_id, p_envelope_id, p_source_file_id, p_signer_recipients, p_expires_at }`.
- **`SendPlan.markFailed`** ids → `{ envelopeId?: string | null }`.

### 2.4 `supabase/functions/_shared/signing-events.ts`

- **`applyEvents`** (l.233–265): `ref: { requestId, envelopeId }`, `p_envelope_id`.
- **`signingRequestSchema`** (l.267): drop `documenso_document_id`.
- **`markDraftFailed`** (l.327–347): `ids: { envelopeId? }` → `p_envelope_id` only.
- **`storeSignedPdf`** (l.496): `request.envelopeId`.
- **`SyncRow`** (l.554) and `reconcileSchema` (l.824): drop `documenso_document_id`.
- **`ownsDocument` → `ownsEnvelope`**; `readDraftDocument` → `readDraftEnvelope` (l.588–612, report id `envelope_id`).
- **`syncRequest`** (l.622–661): key on `row.envelope_id`; the re-read check compares `request.envelope_id`.
- **`settleDraft`** (l.670–718): `currentId = request.envelope_id`; cancel with `{ draft: current.status === 'DRAFT' }`.
- **`recoverCompletedDraft`** (l.768–822):
  - compares `request.envelope_id`;
  - RPC args `{ p_org_id, p_id, p_envelope_id, p_signer_recipients }`;
  - report id `envelope_id`.
- **`reconcileRow`** (l.858–868): `cancel(row.envelope_id!)`. Replace the VERIFY comment: "Documenso expires the signing links, not the envelope (E-6), so this is normally 200. A 400 means it is no longer pending (completed, rejected or cancelled in between): over there too."
- **Module comment:** "document" → "envelope" where it means the id.

### 2.5 Functions

- **`signing-webhook/handler.ts`:**
  - module comment steps 5–7 per E-4;
  - delete `DOCUMENT_ID` (l.86);
  - `webhookSchema.payload` (l.97–110) drops `id`, adds `envelopeId: z.string().max(100)`;
  - order after `normaliseEventName`: `externalId` uuid check (→ 200 `ignored`), then `isEnvelopeId(payload.envelopeId)` (else 400);
  - `ids.envelope_id`;
  - `documensoEventId(org, event, envelopeId, isoTime(createdAt) ?? isoTime(payload.updatedAt))`;
  - claim payload `{ event, envelope_id, external_id }`;
  - `applyEvents(…, { requestId, envelopeId })`;
  - `storeSignedPdf(…, { id, envelopeId, viewPermission })`.
- **`signing-sync/handler.ts`:** `rowSchema` (l.65–71) drops `documenso_document_id`.
- **`signing-test-connection` / `signing-test-document`:** no code change. Their tests change with the fake (paths, ids).
- **`_shared/webhooks.ts` l.29:** comment `<org_id>:<event>:<envelope_id>`.

### 2.6 Fakes, fixtures, script

- **`_shared/testing/fake-documenso.ts`:**
  - documents keyed by envelope id (E-12);
  - `FakeDocumensoDocument` gains `items: [{ id }]`, keeps a legacy numeric `legacyId` for payloads, and its `fields` record `{ recipientId, type, page, positionX, positionY, width, height, identifier }` from the create payload. Create refuses (400) a field with `identifier` other than `0` / omitted, a page < 1 or a coordinate outside 0–100;
  - `operationOf` routes POST by exact path first, then `GET ^/api/v2/envelope/(envelope_[a-z]+)$` and `GET ^/api/v2/envelope/item/(envelope_item_[a-z]+)/download$`;
  - `failures` operations drop `fields`;
  - `distribute` answers `{ success, id, recipients: [{ id, name, email, token, role, signingOrder, signingUrl }] }`;
  - `cancel` keeps its rules (pending → CANCELLED + `onEvent('DOCUMENT_CANCELLED')`; other status → 400 `BAD_REQUEST`; unknown → 404 `NOT_FOUND`); `delete` drafts only (removed); unknown → 404;
  - download only for COMPLETED and `version=signed`;
  - `webhookRequest(url, event, envelopeId)` payload = `{ id: legacyId, envelopeId, externalId, status, completedAt, updatedAt, recipients: [...with token, envelopeId, documentId], Recipient: [...] }`;
  - the module comment is updated.
- **`fake-documenso-server.ts`:** admin routes `/__fake/(open|sign|complete|reject)/(envelope_[a-z]+)`; `GET /__fake/documents` lists envelope ids (no address); `WebhookOutcome.documentId` → `envelopeId`.
- **`scripts/fake-documenso.ts`:** comment block (admin routes with `:envelopeId`).
- **`fake-signing-db.ts`:** mirror §2.1:
  - the RPC routes take the new argument names;
  - `superseded_envelope_ids`;
  - reconcile action and interval on `envelope_id`;
  - `recover` checks `envelope_id`;
  - drop `documenso_document_id` writes (keep the field, null).
- **`signing-fixtures.ts` `sentRequest`:** `createEnvelope` with inline SIGNATURE fields, `distribute(envelopeId)`, insert with `envelope_id` only.

### 2.7 Deno tests (rewrite in place; keep every scenario)

- **`documenso.test.ts`:**
  - `createDocument:*` → `createEnvelope:*` ("multipart: payload with type DOCUMENT and inline fields (identifier 0, positionX/positionY), one `files` part, then reads the recipients"; expiry; duplicate address; subject/message too long → `invalid_request`; "an answer without a well-formed envelope id → provider_error"; "a failed read keeps the envelope id"; address case);
  - the `addFields:*` tests go;
  - "distribute: `{ envelopeId }`; its answer (tokens, signing URLs) is not read";
  - redistribute: numbers;
  - `get:*` (status, recipients, no token or address; `id` mismatch → provider_error);
  - `cancel:*` per E-8 (200; 404 `NOT_FOUND` done; foreign 404 error; 400 → CANCELLED done; 400 → DRAFT → delete; `draft: true` → delete only; 400 → COMPLETED error; malformed id refused, no request);
  - `downloadSigned:*` (item download; zero or two items; malformed item id, no download request; not a PDF; over cap);
  - ping path;
  - "a non-envelope id is refused before any request" (replaces the numeric-id tests; keep "a 15-digit recipient id is accepted");
  - `documensoEventId:*` with envelope ids + "the worst-case id is ≤ 200 characters";
  - "ENVELOPE_ID equals the database check" (reads the new migration).
- **`signing.test.ts`, `signing-events.test.ts`, `signing-webhook/handler.test.ts`, `signing-sync/handler.test.ts`, `signing-test-document/handler.test.ts`, `fake-documenso*.test.ts`:** ids and expected calls. New webhook cases:
  - "a missing or malformed envelopeId → 400 after the externalId check";
  - "the legacy numeric id is ignored";
  - "the claim payload holds the envelope id and no recipient token";
  - "createdAt is ISO-normalised in the claim id".
- **`rpc-contract.test.ts`:** no edit; it must pass (it proves every call uses the new argument names).

### 2.8 Docs

- **ADR 0005:**
  - Decision: webhook bullet (claim `<EVENT>:<envelope>[:<version>]`, `{ event, envelope_id, external_id }`); recovery ("the draft's recorded envelope id");
  - a new bullet "Envelope API (2026-10-08)" naming E-1…E-8, the single-step RPC replacement and the deprecated columns;
  - Consequences: replace the VERIFY sentence with a link to §4 of this plan.
- **`CLAUDE.md` §7 (signing bullets):** "Documenso create (`externalId` = the request id), fields, distribute" → "`envelope/create` (`externalId` = the request id, fields inline), read, distribute"; "cancels the Documenso document" → "envelope"; claim `<org>:<EVENT>:<envelope>[:<version>]` with `{ event, envelope_id, external_id }`; "the document id the draft's recorded one" → "the envelope id".
- **`docs/modules/core.md`:** l.207 (columns: envelope id canonical, `superseded_envelope_ids`, deprecated document id), l.222 (RPC signatures), l.287, l.289.
- **Design §6.1** (l.343–346): envelope routes, with a pointer here.
- **Status doc** "Vérifications `VERIFY`" (l.157–165): replace with a French summary of §4.
- **Runbook:** §7.4 points to §4; §6 "Certificates" adds « ne pas désactiver : le PDF signé est la seule copie du certificat et du journal (E-7) ».
- **Phase 3 plan**, decisions table: one pointer row "P3-35 → Documenso envelope API, see this plan".

## 3. Batches (in order)

Batches 1–3 share one type graph (the migration's RPC names ↔ the Deno calls). Commit each batch, but **push only after Batch 3**. The red checks expected in between are listed.

**Batch 0 (optional, before Batch 2): live probes §4.2 items 1–6**, if the token is available. Their answers (cancel on a draft, the 404 body, the item id format, `identifier`) settle E-8 and E-7 before the client is written.

**Batch 1 — Database** (§2.1):
- Write `026` first, then the migration, then the `023` / `025` edits.
- Run `npm run lint:migrations && npm run db:reset && npm run db:test && npm run db:types`, then `supabase db reset --no-seed && supabase test db`, then `npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run`.
- Expected red: `npm run test:functions` (`rpc-contract.test.ts`, old argument names) until Batch 3.

**Batch 2 — Client and fake** (§2.2, §2.6 minus `fake-signing-db` / `signing-fixtures`, `documenso.test.ts`, `fake-documenso*.test.ts`):
- Run `deno test --frozen --allow-env --allow-read=supabase/functions,supabase/migrations --config supabase/functions/deno.json supabase/functions/_shared/documenso.test.ts supabase/functions/_shared/testing/fake-documenso.test.ts supabase/functions/_shared/testing/fake-documenso-server.test.ts`, then `deno check --frozen --config supabase/functions/deno.json scripts/fake-documenso.ts` and `npm run lint:functions`.
- Expected red: `npm run check:functions` (callers) until Batch 3.

**Batch 3 — Signing libraries and functions** (§2.3–§2.5, `fake-signing-db.ts`, `signing-fixtures.ts`, the remaining tests):
- Run `npm run test:functions && npm run check:functions && npm run lint:functions`, `deno fmt --check --config supabase/functions/deno.json supabase/functions/`, then the full set `npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run`.
- **Local end-to-end:** `npm run db:reset`, `npm run fake:documenso`, functions served. In the app, « Tester la connexion », then « Envoyer un document test ». `curl -X POST http://127.0.0.1:55390/__fake/complete/<envelope id>` (id from `GET /__fake/documents`) → the request reads « signée » and the PDF opens. Re-run « Envoyer » on a failed draft (fake `failures.distribute = 500`) → the earlier envelope is cancelled and superseded.

**Batch 4 — Docs** (§2.8): review only. Every `// VERIFY` left in code is listed in §4.

**Batch 5 — Live verification** (§4, after staging deploy): remove each `// VERIFY` it confirms; record the results (date, version 2.20.0) in ADR 0005 Consequences and the status doc.

**Deploy order** (status doc, Mise en service): `supabase db push` then deploy all functions in the same release (`_shared/` changed). Between the two steps old functions call dropped RPCs. That is harmless while Documenso is not configured (staging today); see R5 if it is by then.

## 4. Live verification against sign.cliniquemana.com

This replaces the VERIFY list in ADR 0005 and status doc l.157–165.

### 4.0 Already confirmed live (2026-10-08, 2.20.0)

- Envelope ids `envelope_` + 16 lowercase letters (`envelope_hsnzzscbexaddcar`): `ENVELOPE_ID`'s VERIFY marker is removed; the regex stays loose on purpose (E-1).
- The webhook header is exactly `X-Documenso-Secret: <raw secret>`.
- The deprecated document read embeds the PDF (`documentData`, 1,122,716 characters signed): over `MAX_JSON_BYTES`, `signing-sync` 502 on staging. The envelope read does not (§1).

### 4.0b `// VERIFY` markers left in code (all in `supabase/functions/_shared/documenso.ts`)

| Marker | Settled by |
|---|---|
| `DOCUMENSO_PATHS.create`: an inline field's `identifier` 0 names the file | §4.2 item 2 |
| `DOCUMENSO_PATHS.cancel`: the answer for a draft or an already-cancelled envelope (R1) | §4.2 items 4 and 6 |
| `DOCUMENSO_PATHS.download`: PDF bytes though JSON is declared; certificate and audit log inside | §4.3 items 9 and 11 |
| `ITEM_ID`: the envelope item id format (R10) | §4.2 item 3 |
| `notFoundSchema`: `NOT_FOUND` body from the read, the cancel and the delete (R2) | §4.2 item 5 |
| `envelopeSchema.externalId`: the read carries `externalId` | §4.2 item 3 |

The old `signing-events.ts` VERIFY (an expired envelope refuses the cancel) is replaced by E-6's comment: no marker.

### 4.1 Rules

- **The token is never pasted in chat.** Jonathan types it in his terminal (`read -s DOCUMENSO_TOKEN; export DOCUMENSO_TOKEN`) and pastes it in the app's « Clé d'API ».
- Probes use `distributionMethod: NONE` (no email) and his own address as the only recipient.
- `jq` filters print shapes only: no `token`, `signingUrl` or `email`.
- Delete the probe envelopes at the end.

```sh
B=https://sign.cliniquemana.com/api/v2; H="Authorization: $DOCUMENSO_TOKEN"; PDF=<a one-page PDF>
```

### 4.2 Probes (curl; can run before the code ships)

1. **Ping.** `curl -s -H "$H" "$B/envelope?perPage=1" | jq '{keys: keys, data: (.data|type)}'` → `data` is an array (E-9).
2. **Create with inline fields.**
   ```sh
   curl -s -H "$H" -F 'payload={"title":"Sonde","type":"DOCUMENT","externalId":"probe-1","recipients":[{"email":"<own address>","name":"Sonde","role":"SIGNER","signingOrder":1,"fields":[{"identifier":0,"type":"SIGNATURE","page":1,"positionX":10,"positionY":80,"width":20,"height":5}]}],"meta":{"distributionMethod":"NONE","language":"fr","timezone":"America/Toronto","dateFormat":"dd/MM/yyyy","envelopeExpirationPeriod":{"unit":"day","amount":1}}}' -F "files=@$PDF;type=application/pdf" "$B/envelope/create" | jq .
   ```
   → `{ id }` matching `^envelope_[a-z]{16}$` (E-1). Repeat once without `identifier` and note whether it is accepted (E-5 sends `0` either way).
3. **Read.** `curl -s -H "$H" "$B/envelope/$E" | jq '{id, status, externalId, items: [.envelopeItems[]|{id, order}], recipients: [.recipients[]|{id, signingOrder, signingStatus, readStatus, expiresAt, expired}], fields: [.fields[]|{type, page, positionX, positionY, envelopeItemId}]}'` → `externalId` present (string), `status` DRAFT, recipient `id` a number, one item (note the **item id format**: E-7's `ITEM_ID`), one field on page 1 with our coordinates.
4. **Cancel a draft.** `curl -s -w '\n%{http_code}\n' -H "$H" -H 'Content-Type: application/json' -d "{\"envelopeId\":\"$E\"}" "$B/envelope/cancel" | jq -R .` → record the status and `.code`. E-8 handles both 400 and 200; a 500 is a finding.
5. **Delete a draft and an unknown envelope.**
   - Delete `$E` → 200 `{ success }`.
   - `GET $B/envelope/$E` → 404 with `.code` (expected `NOT_FOUND`: `notFoundSchema`).
   - Delete `$E` again and delete `envelope_aaaaaaaaaaaaaaaa` → record status and `.code`. E-8 assumes 404 `NOT_FOUND`; if it is 400 or 500, change the "already gone" rule before Batch 2.
6. **Distribute, expiry, cancel a pending envelope.**
   - Create a second probe, then `POST /envelope/distribute {envelopeId}` → `jq '{success, id, n: (.recipients|length)}'`.
   - GET → `status` PENDING, the recipient's `expiresAt` ≈ now + 1 day, `expired` false (E-6: expiry is on the recipient).
   - `POST /envelope/cancel` → 200; GET → CANCELLED; cancel again → 400 (the read-back path).
   - Optional, the next day: a probe left PENDING past its expiry still reads PENDING, `expired` true, and cancels with 200 (old VERIFY 8 inverted).

### 4.3 Through the app on staging (after Batch 3 is deployed)

7. **Connection:** « Tester la connexion » → « Connexion réussie » (also proves `Deno.resolveDns` works hosted, status item 16f).
8. **Test document:** « Envoyer un document test » → the email arrives in French with the template subject, and the signature box sits where the PDF draws it. In Documenso → Webhooks → the endpoint's calls, the latest payload has `envelopeId` (envelope form), `externalId` = the request id and numeric `recipients[].id`, and our answer is 200 `{ outcome }`.
9. **Sign it:** `DOCUMENT_OPENED` / `DOCUMENT_SIGNED` / `DOCUMENT_COMPLETED` → the request reads « signée ». The signed PDF opens and **contains the certificate and the audit log pages** (E-7).
10. **Claims:** Supabase SQL editor, read only: `select event_id, event_type, status, last_error, payload from public.webhook_events where provider = 'documenso' order by received_at desc limit 10;` → ids `<org>:<EVENT>:envelope_…[:<ISO>]`, terminal events without a version, payload exactly `{event, envelope_id, external_id}`, no `failed` rows.
11. **Direct download** (optional): `curl -s -H "$H" -D - -o signed.pdf "$B/envelope/item/<item id>/download?version=signed" | grep -i '^content-type'; head -c 5 signed.pdf` → `%PDF-` (the client checks the bytes, not the declared JSON type).
12. **Webhook triggers:** note whether 2.20 offers a recipient-expired trigger. The app ignores it (E-6), so no subscription is needed.
13. **Clean up:** delete the probe envelopes in Documenso.

## 5. Risks and open questions

- **R1 — `/envelope/cancel` on a draft** is undocumented (400, 200, or something else). E-8 is correct for 400 and 200. Another answer makes every draft cleanup fail: best effort in `send`, but `previous_cancel_failed` on « Renvoyer » and a reconcile error every day. Settled by §4.2 item 4, ideally before Batch 2.
- **R2 — "already gone" detection** relies on a 404 `NOT_FOUND` body that `cancel` and `delete` do not document (§4.2 item 5). If Documenso answers 400 for a missing envelope, a settle of a draft whose envelope was deleted loops on `previous_cancel_failed`. Fallback: treat a 400 whose read-back is 404 `NOT_FOUND` as done.
- **R3 — Recipient expiry emails (settled: E-13):** Documenso emails the owner when a link expires (`ownerRecipientExpired`). Open question for Jonathan: keep it, or send `meta.emailSettings.ownerRecipientExpired: false` at create? The default is kept (behaviour unchanged).
- **R4 — Event-id bound:** 200 characters is reached only with a 64-character event name and a 73-character envelope id. The test pins the bound; a future longer Documenso id format would fail the claim (500, reported), not corrupt data.
- **R5 — Deploy window:** if a Documenso instance is configured on the target before this ships, a send that straddles `db push` and the function deploy fails at `mark_signature_request_sent` (`mark_sent_failed`, retryable) and its envelope is cancelled. Deploy the functions right after the push.
- **R6 — Single-step RPC replacement** (E-3) deviates from conventions §1. Approved by Jonathan on 2026-10-08. The alternative is overloads kept one release, rejected because their bodies would violate `signature_requests_sent_has_envelope`.
- **R7 — A create answer with a malformed id** leaves an unaddressable DRAFT at Documenso. It is never emailed, and it is reported as `provider_unavailable` on the request. Accepted; found by Documenso's own list if it ever happens.
- **R8 — `subject` ≤ 254 / `message` ≤ 5000** are now refused before any request (`invalid_request`). Today the instance's 400 surfaces as `provider_error`. Open question: should template version editing enforce the same limits (Phase 4)?
- **R9 — Deprecated columns** (`documenso_document_id`, `superseded_document_ids`, and the dead output columns of four read RPCs) need a cleanup migration. Schedule it at the start of Phase 4, with the regenerated types.
- **R10 — Envelope item id format** is unknown until §4.2 item 3; `ITEM_ID` is deliberately loose. Several items in one envelope (never created by the app) → `provider_error` at download, reported, PDF not stored.

## 6. Implementation notes (Batches 1–4, 2026-10-08)

Commits on `claude/documenso-clinique-mana-62cb9d`: the migration and pgTAP (Batch 1), the client and fake (Batch 2), the signing libraries and functions (Batch 3), these docs (Batch 4). Deviations from §2–§3, each the safer or the only correct option:

1. **check2 guard:** the migration compares `signature_requests_check2`'s exact definition, not a `like` pattern.
2. **pgTAP `026`:** `apply_signing_event` keeps its argument types, so « the old signature is gone » is asserted on the parameter names (`proargnames`) of the four functions, one version each, plus `hasnt_function` for the three whose types changed.
3. **`signing-fixtures.ts`** (`sentRequest` → `createEnvelope`) moved to Batch 2: `documenso.test.ts` and the fake tests import it.
4. **Claim id bound:** `isoTime` in `signing-webhook` returns null for a time outside four-digit years (`toISOString` gives 27 characters there), so the id stays ≤ 200 (E-4); such a time falls back to `updatedAt`, then `unversioned`.
5. **E-13:** see the correction in the decision row (a partial `emailSettings` replaces the org's preferences).
6. **E-8:** when the read-back says DRAFT and the delete itself fails, the delete's error is thrown (`Documenso delete failed (…)`), not the cancel's 400.
7. **The fake** refuses (400) a delete of a non-draft envelope and any download version but `signed`, so a test sees a call the client must never make; `fakeEnvelopeId(n)` names its envelopes in tests.
8. **The parity test** (`ENVELOPE_ID equals the database check`) reads every `'^envelope_…'` literal of `*_core_signing.sql` and `*_core_signing_envelope.sql`.
9. **Names:** `settleEarlierDocument` → `settleEarlierEnvelope` (E-11's rule); `DocumentSnapshot` / `documentEvents` keep their names (Documenso's events are `DOCUMENT_*`).
10. **`CLAUDE.md` §7 is not edited by the implementing agent** (an agent cannot authorise a CLAUDE.md change): the §2.8 edit is left for Jonathan, as a ready patch.
11. **`deno fmt --check`** failed on `main` already (two email tests): fixed in its own commit.

