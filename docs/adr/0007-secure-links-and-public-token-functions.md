# 0007 — Secure links and public token functions

**Status:** Accepted (built: Phase 3, Tasks 3.17–3.20b) · **Date:** 2026-10-08 · **Design:** [§3](../plans/2026-10-08-phase-3-shared-services-design.md#3-secure-links-corelinks), [§4](../plans/2026-10-08-phase-3-shared-services-design.md#4-staff-invitations-decision-22) · **Plan:** [P3-7, P3-8, P3-16, P3-31, P3-32](../plans/2026-10-08-phase-3-shared-services-plan.md) · **Code:** migrations `20261008060945_core_secure_links`, `20261008062413_core_staff_invitations`, `20261008074035_core_staff_access_followups`; functions `resolve-link`, `accept-invite`, `staff-invite`, `users-set-status`; `_shared/links.ts`, `_shared/rate-limit.ts`

## Context
Legacy (inventory A3) stored link tokens in clear and let `anon` list them; PS Hub's `get-quote-by-token` selects a clear UUID. Phase 3 needs links that open a flow without a session: staff invitations now, Professionnels invitations and profile updates in 4b. Only the link's holder may use it, and no answer may tell a stranger whether a link or an account exists.

## Decision
- **Token:** 32 bytes from `crypto.getRandomValues`, base64url without padding, 43 characters. The last character is restricted to the 16 values with zero padding bits, so a token has a single spelling. `isWellFormedToken` runs before any hash or lookup. The token lives only in the function's memory and in the email. It is never stored, logged, reported or returned.
- **Hash:** `secure_links.token_hash` is the SHA-256 of the 43-character string's UTF-8 bytes (not of the decoded bytes), sent as `\x…` hex. Lookup is by unique index; no secret is compared in code.
- **Fragment-only URL:** `APP_URL/invitation#t=<token>` (https only, except `http://localhost:5173`). The fragment never reaches the app host's logs or `Referer`, and the page clears it with `history.replaceState`. It limits where the token travels; it does not make it secret: link rewriters (Outlook Safe Links, mail scanners) copy the whole URL, fragment included. A scanner that opens the page can only resolve the link; consuming it takes a POST with a password.
- **Single use, one live link per subject:**
  - consumption is one `UPDATE … where revoked_at is null and expires_at > now() and use_count < max_uses returning` (`private.consume_secure_link`); a concurrent second submit waits on the row lock, then matches nothing;
  - `issue_secure_link` revokes the subject's live links under an advisory lock, and a unique partial index on `(org, purpose, subject) where revoked_at is null and use_count < max_uses` makes it a constraint;
  - a link is shown only when created (P3-7): « Renvoyer » issues a new one.
- **Neutral answers:** `peek_secure_link` answers unknown and revoked alike (`{"state":"invalid"}`). A malformed token, an unknown or revoked one and a disabled module all give a byte-identical 410 `link_invalid` (tested). Only `link_expired` and `link_used` differ: only the holder reaches them. An address that already has an account answers 409 « Ce lien ne peut plus être utilisé… », reported without the address (P3-8).
- **Pluggable purposes (P3-16):**
  - the owning module's migration seeds `secure_link_purposes`, which names two handlers:
    - `resolve_rpc(p_link_id uuid) → jsonb` returns what the page shows (it owns the minimisation);
    - for `creates_account`, `accept_rpc(p_token_hash bytea, p_user_id uuid, p_payload jsonb) → jsonb` consumes the link **itself**, does the module's work in the same transaction, and answers `accepted` or a link state;
  - both are `public`, security definer, service role only and not overloaded. `020_core_secure_links.test.sql` checks every seeded purpose against this contract, so core calls handlers by name and never imports module code (ADR 0003).
- **Public token functions** (`resolve-link`, `accept-invite`): `verify_jwt = true` (the anon key), and no user: the token authorizes.
  - CORS is restricted to `ALLOWED_ORIGINS`.
  - Rate limits run before the body is read: `links.resolve_ip` 30 per 10 min, `links.accept_ip` 10 per hour, then `links.accept_link` 5 per hour per link.
  - The org and module come from the link row, then `requireModuleForOrg`. `last_opened_at` is marked only past the gate.
- **Client IP:** `clientIp` takes the **rightmost** `X-Forwarded-For` entry, the one the gateway appends (entries to its left are client-forgeable), or `cf-connecting-ip` with `CLIENT_IP_SOURCE=cf-connecting-ip`. IPv6 is grouped by /64. A missing or malformed value shares the `unknown` bucket. **Staging check** (Mise en service 12): send a forged `X-Forwarded-For` and confirm that the rightmost entry is the caller's real address; otherwise the per-IP limits can be bypassed.
- **Actor model:**
  - `create_staff_invitation` and `renew_staff_invitation` are service role only and take `p_actor`;
  - `staff-invite` verifies the caller (`users.manage`), generates and hashes the token in memory, passes `p_actor` = the verified user (never a body value), emails the link and returns only `invitation_id`;
  - the inviter never sees the token, so she cannot accept for an address she does not control. The RPCs re-check every guard as `p_actor`, under the org lock.
- **Inviter re-checked at acceptance (P3-31):** `invited_by` must still be an active member holding `users.manage`, and still be allowed to invite to that role. Otherwise the answer is `link_invalid`, nothing is written, and the invitation stays pending for an admin.
- **Account only on acceptance, with compensation and an orphan purge:**
  - `accept-invite` creates the auth user (`email_confirm: true`, marker `app_metadata.invite_link_id`), then calls `accept_rpc`;
  - an answer other than `accepted` deletes the user. After an ambiguous RPC error, the user is deleted only if a fresh peek shows the link still unused;
  - `core.invite_orphans_purge` (hourly) deletes marked auth users that have no profile after 1 hour, so a failed compensation cannot block the invitation for good.
- **Disabling ends sessions (P3-32):** `set_user_status(…, 'disabled')` deletes the user's `auth.sessions` in the same transaction (refresh tokens cascade); `users-set-status` also bans the account in Auth (P3-9). An access token already issued lives until it expires (1 h at most), but a disabled profile holds no permission.

## Consequences
- Modules add purposes by migration, with handlers that meet the contract. A handler consumes the link with `private.consume_secure_link` in the same transaction as its work.
- A lost link is replaced, never shown again. Staging checks: the IP header (Mise en service 12), the anon JWT key (11), and the `auth.sessions` / `auth.users` deletes by the migration owner (16d).
- **Residual risks,** accepted because a link is single-use, expires (staff: 7 days by default, 14 at most; any purpose 30 days at most), and answers `link_used` once used:
  - **Resend keeps email bodies:** the invitation and its link are readable in the Resend dashboard until the link is used or expires. Resend access is therefore a path to an account (EFVP, Mise en service 16e), and click tracking must stay off (it would rewrite the link).
  - **Browser history on a shared PC:** the visited URL, fragment included, stays in the history list. Until the invitee sets her password, someone else on that PC could open it: up to 7 days, against 1 hour for auth links (ADR 0006).
  - **The 12-month purge:** `core.secure_links_purge` deletes a link 12 months after its last event (use, revocation or expiry). Until then the row (hash, subject, dates, `last_opened_at`) stays, though a dead link cannot be revived from its hash.
  - **Audit rows outlive the purge:** every issue, open, revocation and deletion is audited (with `token_hash` redacted). Those rows (subject ids, actors, dates) and the `staff_invitations` row with its address remain; there is no audit retention yet.

## Alternatives
- **Supabase's built-in invite:** it creates the account before acceptance, with a random password and links on Supabase's URLs.
- **Signed JWT links:** they cannot be revoked one by one, and single use needs a table anyway.
- **Stored readable tokens** (legacy, PS Hub): a link could be shown again, but anyone who reads the table can use it (A3).
