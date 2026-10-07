# 0006 — Session and recovery policy

**Status:** Accepted · **Date:** 2026-10-07 · **Decisions log:** [#9–17, #32–33](../plans/2026-10-07-decisions-log.md) · **Code:** `src/core/auth/AuthProvider.tsx`, `src/core/auth/recovery.ts`, `src/core/access/AccessProvider.tsx`, `src/core/access/guards.tsx`

## Context
Reception computers are shared, staff also sign in on their phones, and a password-reset link signs the user in. auth-js emits `PASSWORD_RECOVERY` only once, in the tab that opened the link. Auth messages must not reveal whether an account exists (Loi 25, enumeration).

## Decision
- **Recovery is bound to the session:** the recovery session's JWT `session_id` is stored as a marker (`RECOVERY_STORAGE_KEY`). While it matches, `RequireAuth` sends every protected page to `/reinitialiser-mot-de-passe`, across reloads and tabs; the reset page refuses ordinary sessions and expired links (#12, #14).
- **After a reset by email, other sessions are signed out** (`signOut({ scope: 'others' })`) (#15).
- **Sign-out is per device** (`scope: 'local'`), always forgets the local session even offline, other tabs follow, and an explicit sign-out lands on plain `/connexion` (no return target) (#13, #17).
- **« Se déconnecter de tous les appareils »** (« Mon compte », #33) signs out with `scope: 'global'`, after a confirmation and the unsaved-changes guard. On success this tab is signed out like an explicit sign-out (#17). **On failure it keeps this session** and shows the error: forgetting it would hide that the other devices may still be signed in. `scope: 'global'` revokes the account's **refresh tokens** only: an access token already issued to another device stays valid until it expires (`jwt_expiry`, 1 h), so that device keeps working for up to an hour, then is signed out at its next refresh.
- **Enumeration-safe messages:** magic link and reset report success for unknown emails and for the per-email throttle; only real failures (IP throttling, outage) are shown (#9, #16).
- **The React Query cache is cleared whenever the signed-in user changes or signs out** (#10). A refetch error keeps the last verified access of the same user; only a first-load failure shows the retry screen (#11).

## Consequences
- These behaviours are covered by `AuthProvider`, `AccessProvider`, guard and app-level tests; change them only with a new decision.
- « Se déconnecter de tous les appareils » takes up to an hour (`jwt_expiry`) to reach a device that is in use. Lowering `jwt_expiry` would shorten that window at the cost of more refreshes.
- « Mon compte » reports `email_exists` when the new address belongs to another account (#32): an exception to the enumeration rule, since only a signed-in user can ask, for their own account.
- Staging must allow `/reinitialiser-mot-de-passe` as a redirect URL (plan amendment A4).

## Alternatives
- **Trust `PASSWORD_RECOVERY` alone:** a reload or second tab gets a full session without changing the password.
- **Global sign-out:** signing out at reception would sign the person out everywhere.
