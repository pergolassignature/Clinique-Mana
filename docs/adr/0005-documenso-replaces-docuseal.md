# 0005 — Self-hosted Documenso replaces DocuSeal

**Status:** Accepted (built: Phase 3 core signing, Tasks 3.31–3.33 and their reviews) · **Date:** 2026-10-06 · **Finalised:** 2026-10-08 (Task 3.35) · **Design:** [D4](../plans/2026-10-06-foundation-rebuild-design.md#decisions-taken), [§6](../plans/2026-10-08-phase-3-shared-services-design.md#6-e-signature-coresigning) · **Plan:** [P3-3, P3-19, P3-26, P3-30, Tasks 3.31–3.33](../plans/2026-10-08-phase-3-shared-services-plan.md) · **Code:** migrations `20261008073909_core_signing`, `20261008082519_core_signing_function_support`; `_shared/{signing,signing-events,documenso}.ts`; functions `signing-webhook`, `signing-sync`, `signing-test-connection`, `signing-test-document`; CLAUDE.md §7

## Context
Legacy signed contracts through DocuSeal; `docuseal-create-submission` could be called by any signed-in user. PS Hub already runs a hardened Documenso integration (webhook with constant-time secret check, events claimed once). Clinic contracts and consents contain personal information (Loi 25) and must carry the clinic's branding.

## Decision
- E-signature uses **Documenso**, on a **separate self-hosted instance for the clinic** (e.g. `sign.cliniquemana.com`), not Pergolas Signature's. The URL is in `signing_settings`, the API key and webhook secret are org secrets in Vault (ADR 0004), never in code.
- **No `signing-create` function.** Module functions call `createSignatureRequest` in `_shared/signing.ts` (Professionnels 4d), as `signing-test-document` does with the built-in test document. That module renders the PDF on the server (ADR 0008), so only request-creating functions import it; the webhook and the sync use the render-free `_shared/signing-events.ts`.
- **Documenso sends the signing emails** (P3-3: `distributionMethod: EMAIL`, French, the template version's subject and message, sequential when there are several signers). The app sends no `contract.sent` email.
- **Templates** (`document_templates`, versioned draft → published → archived) are created with `settings.manage`; versions are edited by the template's `edit_permission`.
- **One open request per subject and purpose** (`signature_requests_open_subject_idx`): a new idempotency key for a record with an open request is refused until the old one is cancelled. The same key always returns its row, and with other signers is refused.
- **Signers are role-keyed:** a role is unique per request, Documenso recipients are recorded as `[{role, recipient_id}]`, and a recovered document's recipients are matched by signing order (sound because a key's stored orders are the ones every send used).
- **The send claim:** `begin_signature_request_send` allows one send per request at a time (a fresh claim → 409 « Un envoi est déjà en cours. »). A re-send (« Renvoyer ») settles the earlier document first: COMPLETED → recovered, nothing sent again; DRAFT or PENDING → cancelled (a failed cancel stops the re-send); cancelled, rejected or gone → sent again, and the earlier id is superseded.
- **Webhook** (`verify_jwt = false`): `?org=` → that org's secret, none → 401; `timingSafeEqual` on `X-Documenso-Secret` (PS Hub's `!==` fixed); body ≤ 256 KB; `claimEvent` on `<EVENT>:<doc>[:<version>]` with `{ event, document_id, external_id }` only. `apply_signing_event` finds the row in that org, gates the module, and answers `retry` (409, Documenso retries) for a draft whose send is under way.
- **State machine:** monotonic, terminal states never move. Once `DOCUMENT_COMPLETED` is recorded (`completed_event_at`) a signed contract is protected: no expiry, no cancel, rejected and cancelled events ignored, and the signed PDF is downloaded whatever the expiry. `recover_signature_request` adopts a draft Documenso completed only for the request's own document: `externalId` = the request id (checked by the functions) and the draft's recorded document id (checked by the RPC).
- **Signer emails stay hidden from clients:** `signature_request_signers` is granted column by column without `email`, the audit trail redacts `email` and `name`, and no log, claim, report or answer carries an address.

## Consequences
- Jonathan provisions and operates the clinic instance (Mise en service 4).
- `signing-sync` runs « Synchroniser » (caller's RLS read) and the daily `core.signing_reconcile` job (expire overdue requests after a last sync, settle drafts under their claim).
- **Residual risks, made visible rather than silent:** a double « Renvoyer » sends one document (the claim); a draft Documenso completed whose recipients do not match is reported `signing_orphan_completed` and left for a person; a document under another `externalId` is reported `signing_foreign_document`, never recovered nor cancelled; a completion after the clinic closed a request is reported `signing_completed_after_close`.
- **Before real use (Mise en service 4):** check every `// VERIFY` endpoint of `_shared/documenso.ts` against the instance's OpenAPI, and confirm that the document read returns `externalId` (string or null, never omitted) and each recipient's `signingOrder`, `signingStatus` and `readStatus`.
- DocuSeal code stays in `_legacy/` only as a reference.

## Alternatives
- **Keep DocuSeal:** no hardened integration to port; legacy one had an authorization hole.
- **Share PS Hub's Documenso instance:** mixes two companies' data and branding (Loi 25).
- **A generic `signing-create` function** (this ADR's first version): design §6.3 has each module's function call the shared library behind its own permission and module checks (plan inconsistency #13).
- **Our own signing emails:** sequential signing would need our own relay of Documenso's turn-taking (P3-3).
