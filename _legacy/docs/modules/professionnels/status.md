# Module Status — professionnels

Module: professionnels
Workflow: module.pipeline
Current Gate: 6.2 — Authority Flow
Last Updated: 2026-01-19

## Overview

The Professionnels module manages healthcare professionals in the Clinique MANA platform, including their onboarding workflow, documentation, professional profiles (portrait), and public-facing profile sheets (fiche).

## Progress

- [x] Gate 0 — UI Wireframe
- [x] Gate 1 — Data Contract
- [x] Gate 2 — Schema
- [x] Gate 3 — Security (RLS)
- [x] Gate 4 — Audit (Write)
- [x] Gate 5 — Local Dev Validation
- [x] Gate 6 — UI Integration
- [x] Gate 6.1 — UI Polish
- [x] Gate 6.2 — Authority Flow (STEP 1 COMPLETE)
- [ ] Gate 7 — Automated Tests
- [ ] Gate 8 — Production

## Operational Checklist

### What's Done
- [x] Profil tab: clean overview (indicators only, no duplicate onboarding progress)
- [x] Onboarding tab: "Copier le lien" is primary action, revoke has confirm dialog
- [x] Documents tab: per-card upload only (global upload button removed)
- [x] Portrait tab: provenance banner showing submission source + modification dates
- [x] Historique tab: short IDs (7 chars), "Copier l'ID complet" in expanded details
- [x] Consistent fr-CA microcopy (calm wording: "À compléter", "À téléverser", "À renouveler")
- [x] Consent document info banner (12 months, auto-renew, 3-month withdrawal notice)
- [x] Validation step shows clear blockers list, no contradictory states

### What's Stubbed ("Bientôt disponible")
- [ ] PDF fiche download (react-pdf not installed)
- [ ] Automatic activation button (needs status mutation wiring)

### What Remains (Next Steps)
1. **Storage Policies**: Verify Supabase storage bucket policies for `professional-documents`
2. **Audit Log Verification**: Confirm audit triggers are firing for all CRUD operations
3. **PDF Generation**: Install react-pdf and implement fiche PDF download
4. **Activation Wiring**: Connect activation button to `updateProfessionalStatus` mutation
5. **E2E Tests**: Add Playwright tests for onboarding flow

---

## Step 1: Questionnaire Authority Flow (COMPLETE)

### Summary
Implemented the "Questionnaire → Appliquer au profil" authority flow where:
- Questionnaire submissions are **staging only**
- When staff clicks "Appliquer au profil", submission data **overwrites** the professional profile
- After applying, UI reads from the **professional profile** (single source of truth), not submission
- Original submission remains accessible as historical reference
- Every apply action is audit-logged with **before/after snapshots**

### Mapping Rules Implemented

| Questionnaire Field | Professional Column | Action |
|---------------------|---------------------|--------|
| `bio` | `portrait_bio` | Overwrite |
| `approach` | `portrait_approach` | Overwrite |
| `public_email` | `public_email` | Overwrite |
| `public_phone` | `public_phone` | Overwrite |
| `license_number` | `license_number` | Overwrite |
| `years_experience` | `years_experience` | Overwrite |
| `specialties` (codes) | `professional_specialties` junction | **Replace all** |

**Rules:**
- Fields only overwritten if present in submission (undefined → skip, preserve existing)
- Empty string (`""`) is mapped to `null`
- Specialties are completely replaced (delete existing, insert new from codes)

### Mapping Gaps (Needs DB Later)

The following questionnaire fields are captured but **NOT mapped** to the `professionals` table because the columns don't exist:

| Field | Stored In | Notes |
|-------|-----------|-------|
| `full_name` | submission.responses only | Would require `professionals.legal_name` or update `profiles.display_name` |
| `preferred_name` | submission.responses only | Would require `professionals.preferred_name` |
| `pronouns` | submission.responses only | Would require `professionals.pronouns` |
| `title` | submission.responses only | Would require `professionals.title` or `profiles.title` |
| `education` | submission.responses only | Would require `professionals.education` (text or JSONB) |
| `languages` | submission.responses only | Would require `professional_languages` junction table |
| `availability_notes` | submission.responses only | Would require `professionals.availability_notes` |

These fields are preserved in the original submission and displayed in the "Voir la soumission originale" modal.

### UI Components Added/Modified

1. **Confirmation Dialog** (`portrait-tab.tsx`)
   - Title: "Appliquer le questionnaire au profil ?"
   - Lists fields that will be replaced
   - Warning: "Les informations actuelles seront remplacées"
   - Buttons: "Annuler" / "Appliquer"

2. **Original Submission Modal** (`portrait-tab.tsx`)
   - Displays all questionnaire responses in structured sections
   - Includes "Voir JSON" toggle for technical inspection
   - Shows submission date and approval status

3. **Provenance Banner** (`portrait-tab.tsx`)
   - Shows submission source and date
   - Shows "Approuvé" badge when applicable
   - Shows success message after apply: "Données appliquées au profil le..."
   - "Voir la soumission originale" button

4. **Apply Pipeline** (`api.ts`)
   - `applyQuestionnaireToProfile()` now returns `ApplyQuestionnaireResult`
   - Captures before/after snapshots for audit
   - Logs `questionnaire_approved` action with `old_value` and `new_value`

### Audit Log Format

```json
{
  "action": "questionnaire_approved",
  "entity_type": "questionnaire",
  "entity_id": "<submission_id>",
  "old_value": {
    "portrait_bio": "previous bio...",
    "portrait_approach": "previous approach...",
    "specialty_codes": ["cbt", "anxiety"]
  },
  "new_value": {
    "portrait_bio": "new bio from questionnaire...",
    "fields_updated": ["portrait_bio", "portrait_approach"],
    "specialties_replaced": 5,
    "submission_id": "<submission_id>"
  }
}
```

### Error Handling
- Apply failure: Toast "Impossible d'appliquer le questionnaire pour le moment"
- Missing submission: Toast "Données non disponibles"
- All errors keep user on page, no data loss

---

## Draft Save Bugfix — 2026-01-19

### Root Cause
The `saveDraftQuestionnaire` function was calling `fetchQuestionnaireSubmission` to check for existing drafts before deciding to INSERT or UPDATE. However:

1. **Anon users cannot SELECT** from `professional_questionnaire_submissions` table (RLS policy only allows admin/staff)
2. This caused the function to always think no draft exists → always INSERT
3. Multiple inserts created duplicate draft rows (no unique constraint)
4. No user feedback when save failed silently

### Solution
1. **Track submission_id in React state** after first INSERT
2. **Store submission_id in localStorage** for persistence across page refreshes
3. **Pass existing_submission_id** to save/submit functions to use UPDATE path
4. **localStorage for form data** — immediate persistence, restored on page load
5. **Auto-save with debounce** — 2.5 seconds after last change
6. **Visual save status indicator** — "Sauvegarde…" / "Sauvegardé à HH:MM" / error with retry link

### Files Changed
- `src/professionals/api.ts` — New `SaveDraftInput` type with `existing_submission_id` field
- `src/professionals/hooks.ts` — Updated to match new API signatures
- `src/pages/invite.tsx` — localStorage persistence, auto-save, status indicator

### Manual Test Checklist

Before testing, create a new professional and invitation link.

- [ ] **First Draft Save**
  1. Open token link `/invitation/:token`
  2. Type in 3 fields (full_name, title, bio)
  3. Click "Sauvegarder le brouillon"
  4. Verify: "Sauvegardé à HH:MM" appears
  5. Check DB: `professional_questionnaire_submissions` has 1 row with status='draft'

- [ ] **Form Restoration on Refresh**
  1. After step above, refresh the page
  2. Verify: Fields are restored from localStorage
  3. Verify: Form shows previously entered data

- [ ] **Update Same Draft (No Duplicates)**
  1. Modify more fields
  2. Click "Sauvegarder le brouillon" again
  3. Verify: Same row is updated (check `id` and `updated_at`)
  4. Verify: No new rows created in DB

- [ ] **Auto-Save Behavior**
  1. Type in a field
  2. Wait 2.5 seconds without clicking anything
  3. Verify: "Sauvegarde…" then "Sauvegardé à HH:MM" appears automatically

- [ ] **Submit Locks Form**
  1. Complete all required fields
  2. Click "Soumettre"
  3. Verify: Success screen shown
  4. Reopen same token link
  5. Verify: "Merci, votre formulaire a déjà été transmis" message

- [ ] **localStorage Cleanup**
  1. After successful submit, check localStorage
  2. Verify: Keys `clinique_mana_draft_<prof_id>` and `clinique_mana_submission_id_<prof_id>` are removed

### RLS Policies (Reference)
```sql
-- Anon can INSERT if valid invite exists
create policy "professional_questionnaire_submissions_insert_anon"
  on public.professional_questionnaire_submissions
  for insert to anon
  with check (
    exists (
      select 1 from public.professional_onboarding_invites
      where professional_id = professional_questionnaire_submissions.professional_id
        and status in ('pending', 'opened')
        and expires_at > now()
    )
  );

-- Anon can UPDATE drafts only
create policy "professional_questionnaire_submissions_update_anon"
  on public.professional_questionnaire_submissions
  for update to anon
  using (
    status = 'draft'
    and exists (
      select 1 from public.professional_onboarding_invites
      where professional_id = professional_questionnaire_submissions.professional_id
        and status in ('pending', 'opened')
        and expires_at > now()
    )
  )
  with check (
    status in ('draft', 'submitted')
  );
```

---

## Tab Structure

### Profil
Clean overview with:
- Identity card (name, email, title, status)
- Accreditation card (license number, years experience)
- Contact card (public email, phone)
- Dates card (created, modified, questionnaire submitted)
- Indicators sidebar (Portrait, Documents, Fiche status signals)
- Specialties summary (read-only)

### Intégration (Onboarding)
Four-step workflow cards:
1. **Invitation** — Primary: "Copier le lien", Secondary: view link icon, Destructive: revoke with confirm
2. **Questionnaire** — Shows status, blocked reason if waiting for invite
3. **Documents** — Summary + CTA to Documents tab
4. **Validation** — Blockers list (calm wording), "Prêt à activer" badge when ready

### Portrait
- Provenance banner: "Soumis via invitation le..." / "Dernière modification..."
- Bio and Approach cards with inline editing
- Contact public card
- Specialties manager with expandable picker
- "Voir la soumission originale" button (stubbed)

### Documents
- Summary bar with status badges (no global upload button)
- Required document cards: Photo, Insurance, Consent, Service Contract
- Per-card actions: Upload/Replace, Verify, View/Download, Edit expiry, Delete
- Consent info banner (auto-renew notice)
- Other documents section for non-required uploads

### Fiche
- Download-focused layout
- Preview modal with styled fiche card
- Quick preview (scaled) in main view
- "Télécharger la fiche (PDF)" button (stubbed)

### Historique
- Timeline grouped by date
- Humanized French labels for all actions
- Short IDs displayed (7 chars)
- Expandable details with "Copier l'ID complet" actions
- No raw UUID noise

## Technical Implementation

### Key Utilities
- `formatEntityId(id)` — Converts UUIDs to 7-char display codes
- `isUUID(id)` — Validates UUID format
- `mapOnboardingState()` — Derives step status from DB fields
- `mapRequiredDocumentsState()` — Maps documents to card states
- `mapProfessionalToViewModel()` — Full view model for detail page
- `mapAuditLogToHumanized()` — French labels + icon types for audit entries

### Status Badge Consistency
| State | Badge Variant | Label |
|-------|---------------|-------|
| missing | outline (wine) | Manquant |
| pending | warning | En attente |
| verified | success | Vérifié |
| expired | error | Expiré |
| complete | success | Complet |
| ready | success | Prêt à activer |
| activated | success | Activé |
| blocked | secondary | En attente |

### Microcopy Guidelines (fr-CA)
- Avoid: "échec", "non conforme", "bloqué" (without explanation)
- Use: "En attente", "À compléter", "À téléverser", "À renouveler", "À valider"
- Toast for stubs: `title: "Bientôt disponible"`, `description: "[Feature] sera disponible prochainement."`

## Files Modified (Gate 6.1 Polish)

- `src/professionals/mappers.ts` — Added formatEntityId, isUUID, calmer wording
- `src/professionals/components/profile-tab.tsx` — Removed duplicate onboarding progress card
- `src/professionals/components/onboarding-tab.tsx` — Copy link primary, revoke confirm dialog
- `src/professionals/components/documents-tab.tsx` — Removed global upload button, fixed consent banner
- `src/professionals/components/portrait-tab.tsx` — Added provenance banner
- `src/professionals/components/history-tab.tsx` — Short IDs, copy full ID actions

## Blockers
- None

## Notes
- Database schema unchanged — all state derived from existing fields
- All UI text in fr-CA with calm, non-clinical tone
- Uses shadcn/ui components + brand tokens (sage, honey, wine)
- Framer Motion for tab transitions and animations
- Progress bar visible in header when onboarding < 100%
