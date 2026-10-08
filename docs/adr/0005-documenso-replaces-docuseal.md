# 0005 — Self-hosted Documenso replaces DocuSeal

**Status:** Accepted (not built yet: Phase 3) · **Date:** 2026-10-06 · **Design:** [D4](../plans/2026-10-06-foundation-rebuild-design.md#decisions-taken), [§4.3](../plans/2026-10-06-foundation-rebuild-design.md#43-e-signature-coresigning)

## Context
Legacy signed contracts through DocuSeal; `docuseal-create-submission` could be called by any signed-in user. PS Hub already runs a hardened Documenso integration (webhook with constant-time secret check, events claimed once). Clinic contracts and consents contain personal information (Loi 25) and must carry the clinic's branding.

## Decision
- E-signature uses **Documenso**, on a **separate self-hosted instance for the clinic** (e.g. `sign.cliniquemana.com`), not Pergolas Signature's.
- `core/signing` keeps legacy's good abstraction (`document_templates` versioned, `signature_requests`) and ports PS Hub's flow: server-side rendering (`signing-create`, permission-checked), Documenso v2 send, and a webhook verified with `timingSafeEqual` that stores the signed PDF and certificate in private storage.
- The Documenso URL and API key come from Settings and Vault (ADR 0004), never from code.

## Consequences
- Jonathan provisions and operates the clinic instance (owner action, Phase 0).
- Signing functions use `verifyAuth(req, { permission, module })`. The webhook is `verify_jwt = false` with a signature check; it has no user, so it resolves the org from the stored `signature_requests` row and calls `requireModuleForOrg()` before acting.
- DocuSeal code stays in `_legacy/` only as a reference.
- The configured URL is a place the server sends the API key, so it is constrained (P3-34, Task 3.34 review): `https://` to a public DNS name only (the database refuses IP literals and private names), no redirect followed, the host resolved before every request and refused when any address is private, loopback, link-local, CGNAT, multicast or unspecified (local dev excepted: the fake at `host.docker.internal`, only when `APP_URL` is local). Changing the address's origin deletes the stored key, so it is typed again for the new instance. A DNS-rebinding window remains between that check and `fetch`'s own lookup; https and no redirects narrow it.

## Alternatives
- **Keep DocuSeal:** no hardened integration to port; legacy one had an authorization hole.
- **Share PS Hub's Documenso instance:** mixes two companies' data and branding (Loi 25).
