# 0006 — Session and recovery policy

**Status:** Accepted · **Date:** 2026-10-07 · **Decisions log:** [#9–17, #32–33, #38](../plans/2026-10-07-decisions-log.md) · **Code:** `src/core/auth/AuthProvider.tsx`, `src/core/auth/recovery.ts`, `src/core/account/pages/AccountPage.tsx`, `src/core/access/AccessProvider.tsx`, `src/core/access/guards.tsx`

## Context
Reception computers are shared, staff also sign in on their phones, and a password-reset link signs the user in. auth-js emits `PASSWORD_RECOVERY` only once, in the tab that opened the link. Auth messages must not reveal whether an account exists (Loi 25, enumeration).

## Decision
- **Recovery is bound to the session:** the recovery session's JWT `session_id` is stored as a marker (`RECOVERY_STORAGE_KEY`). While it matches, `RequireAuth` sends every protected page to `/reinitialiser-mot-de-passe`, across reloads and tabs; the reset page refuses ordinary sessions and expired links (#12, #14).
- **After a reset by email, other sessions are signed out** (`signOut({ scope: 'others' })`) (#15).
- **Sign-out is per device** (`scope: 'local'`), always forgets the local session even offline, other tabs follow, and an explicit sign-out lands on plain `/connexion` (no return target) (#13, #17).
- **« Se déconnecter de tous les appareils »** (« Mon compte », #33) signs out with `scope: 'global'`, after a confirmation and the unsaved-changes guard. On success this tab is signed out like an explicit sign-out (#17). **On failure it keeps this session** and shows the error: forgetting it would hide that the other devices may still be signed in. `scope: 'global'` revokes the account's **refresh tokens** only: an access token already issued to another device stays valid until it expires (`jwt_expiry`, 1 h), so that device keeps working for up to an hour, then is signed out at its next refresh.
- **Enumeration-safe messages:** magic link and reset report success for unknown emails and for the per-email throttle; only real failures (IP throttling, outage) are shown (#9, #16).
- **Email change is neutral too** (« Mon compte », #38, which reverses #32): an address that another account uses (`email_exists`) answers exactly like a success, with the same notice: « Si cette adresse peut être utilisée, un lien de confirmation a été envoyé à l'ancienne et à la nouvelle adresse… ». The per-user email throttle (`over_email_send_rate_limit`) is neutral as well: GoTrue checks for a duplicate before the throttle, so within the throttle window « throttled » would mean « free ». Invalid addresses, IP throttling and outages are still shown. After a request the page shows that neutral notice, never « en attente vers … », even once GoTrue reports `new_email`; the pending address is shown only on a later visit, from `new_email`.
- **The React Query cache is cleared whenever the signed-in user changes or signs out** (#10). A refetch error keeps the last verified access of the same user; only a first-load failure shows the retry screen (#11).

## Consequences
- These behaviours are covered by `AuthProvider`, `AccessProvider`, guard and app-level tests; change them only with a new decision.
- « Se déconnecter de tous les appareils » takes up to an hour (`jwt_expiry`) to reach a device that is in use. Lowering `jwt_expiry` would shorten that window at the cost of more refreshes.
- There is no exception to the enumeration rule any more (#32 is reversed by #38). A user who asks for an address already in use (for example a typo matching a colleague's) sees the same notice and receives no link; a request repeated within the throttle window sends nothing either.
- **UI neutrality stops casual discovery, not a determined signed-in user.** The answer still shows elsewhere:
  - **The user's own inbox:** with `double_confirm_changes`, a real change emails the current address too, and a taken address emails nothing, whatever the UI shows.
  - **A remount:** navigating away from « Mon compte » and back remounts `EmailCard`, which shows « en attente vers … » from `new_email`, recorded only for a real change.
  - **The API:** `PUT /auth/v1/user` still answers 422 `email_exists`, visible in the browser's network tab.
  A server-side change (e.g. an edge function in front of the email change) could hide the last two, but would close the inbox signal only by also sending a decoy email for a taken address.
- Two weaker residual signals are accepted under #16: **timing** (a real change sends two emails before GoTrue answers, so « Envoi… » lasts longer) and **outage asymmetry** (an SMTP failure or `email_address_not_authorized` can only happen for a free address, so it shows `unknown`, while a taken address shows success).
- Staging must allow `/reinitialiser-mot-de-passe` as a redirect URL (plan amendment A4).

## Alternatives
- **Trust `PASSWORD_RECOVERY` alone:** a reload or second tab gets a full session without changing the password.
- **Global sign-out:** signing out at reception would sign the person out everywhere.
