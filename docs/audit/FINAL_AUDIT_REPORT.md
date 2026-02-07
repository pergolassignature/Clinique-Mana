# Professionals Section — Audit Report

> Audit Date: 2026-02-07
> Scope: Professionals module only
> Approach: Understand first, ask before fixing, minimal safe changes

---

## 1. What Was Understood

### Architecture
The Professionals section is a well-structured module with clear separation of concerns:
- **2 routes**: list page (`/professionnels`) and detail page (`/professionnels/$id`)
- **7 detail tabs**: aperçu, profil, profil public, services, documents, calendrier, historique
- **4 core data files**: types (545L), api (1709L), hooks (805L), mappers (908L)
- **Full component set**: dialogs, drawers, inline editors, PDF generation

### Data Model
- Professionals link 1:1 to profiles via `profile_id`
- Junction tables for specialties, motifs, professions (max 2), services, documents
- Full audit trail via SECURITY DEFINER triggers (append-only)
- Onboarding flow: invites → questionnaire → review → apply → activate

### Tab Responsibilities (Confirmed Well-Separated)
| Tab | Responsibility |
|-----|---------------|
| Profil | Internal data: phone, address, IVAC, professions, system dates |
| Profil Public | Public-facing: bio, approach, public contact, specialties, motifs, questionnaire review |

Initial concern about field overlap between these tabs was **incorrect** — `portrait_bio` and `portrait_approach` exist only in the Profil Public tab. The tabs have distinct responsibilities with no duplication.

### Permissions Model
- **Admin**: Full CRUD on all professional entities
- **Staff**: CRU on most entities (no deletes except storage files)
- **Provider**: Read/update own record only (status protected at app layer)
- **Anon**: Invite-gated access to questionnaire submission and photo/insurance upload

---

## 2. What Was Improved

### Bug Fix: Auto-transition `pending → invited` on invite creation

**Problem**: Creating an invite for a professional didn't change their status from `pending` to `invited`. The transition had to be done manually.

**Fix**: Added automatic status update (`pending → invited`) in 3 locations:
- `createInvite()` in `src/professionals/api.ts`
- `createUpdateRequestInvite()` in `src/professionals/api.ts`
- `create-professional` Edge Function in `supabase/functions/create-professional/index.ts`

**Guard**: Only transitions if current status is `pending` (won't downgrade active/inactive).

### Fix: Stale specialty category references

**Problem**: The `issue` and `modality` specialty categories were deprecated and soft-deleted (migration `20260125000001`) but stale references remained in 3 frontend files.

**Fix**: Removed `issue` and `modality` from category labels and sort order in:
- `src/professionals/mappers.ts` — `SPECIALTY_CATEGORY_LABELS` (also typed with `SpecialtyCategory` instead of `string`)
- `src/professionals/components/specialty-selector-drawer.tsx` — `categoryLabels` + `categoryOrder`
- `src/professionals/components/profil-public-tab.tsx` — `categoryLabels` + `categoryOrder`

Note: `src/shared/components/specialty-accordion-picker.tsx` was already correct.

### Database Migration: Tighten CHECK constraint

**File**: `supabase/migrations/20260207000002_tighten_specialty_category_check.sql`

**Change**: Updated `specialties_category_check` constraint to only allow `therapy_type` and `clientele`. Used `NOT VALID` to preserve existing soft-deleted rows with deprecated categories.

---

## 3. What Remains Intentionally Untouched

### Large file sizes
- `api.ts` (1709L), `mappers.ts` (908L), `hooks.ts` (805L) — noted for future refactoring
- No changes made: splitting these files would be a large refactor with risk

### Calendar tab
- Status: **Still in development** — Edge Functions not fully deployed
- No code changes. Recommended: consider hiding for launch or displaying "coming soon" state

### Provider self-update RLS gap
- Status changes enforced at application layer only (not RLS), due to infinite recursion fix
- Risk: Low — providers don't have direct Supabase API access
- Documented as a known limitation

### Pre-existing lint/type errors
- 4 lint errors and 5 warnings in professionals module (all pre-existing)
- 30+ TypeScript errors in other modules (clients, request-analysis, services, templates)
- No new errors introduced by audit changes

---

## 4. Permissions Sanity Check Results

| Check | Result | Notes |
|-------|--------|-------|
| Provider self-select isolation | PASS | `profile_id = current_profile_id` filter correctly applied |
| Anon document upload restrictions | PASS | Limited to photo/insurance, requires valid invite token |
| Anon questionnaire restrictions | PASS | Can only insert (with invite) and update draft→submitted |
| Audit log trigger coverage | PASS | All entity types covered: professionals, documents, invites, questionnaires, specialties |
| Storage path enforcement | PASS | Regex validates `professionals/{id}/(photo\|insurance)/*` for anon |

---

## 5. UX Notes — Professionals

### Observations (Code-Based Review)

1. **7-tab structure**: Well-organized, each tab has a clear purpose. The aperçu (overview) tab serves as a useful dashboard.

2. **Inline editing pattern**: The `EditableField` component in profile-tab and profil-public-tab provides a consistent edit/save/cancel pattern.

3. **Onboarding progress**: The 3-step onboarding state (formulaire, documents, activation) with completion percentage is well-designed and provides clear guidance.

4. **Alert cards on aperçu tab**: Proactively surface missing data (portrait, specialties, documents) — good for guiding staff through the onboarding process.

5. **Questionnaire provenance**: The Profil Public tab's provenance banner clearly shows data source and provides a way to view original submissions — excellent for audit trail.

### Potential Improvements (Not Implemented — For Discussion)

1. **Empty states**: Should verify that all tabs gracefully handle empty state (no specialties, no documents, no services, no audit log). Code review suggests these are handled, but visual verification recommended.

2. **Calendar tab visibility**: Since the feature is in development, the tab is visible but may confuse users. Consider hiding it or showing a clear "coming soon" indicator.

3. **Deactivation reason**: The `deactivation_reason` field (`manual`, `insurance_expired`) exists in the schema but its visibility in the UI is unclear. May want to surface this in the status change dialog or history tab.

---

## 6. Commits Made

| Type | Scope | Description |
|------|-------|-------------|
| `fix` | professionals | Auto-transition `pending → invited` on invite creation (api.ts + Edge Function) |
| `chore` | professionals | Remove stale `issue`/`modality` specialty category references (3 files) |
| `chore` | db | Add migration to tighten specialty category CHECK constraint |
| `docs` | audit | Create PROFESSIONALS_MAP.md architecture map |
| `docs` | audit | Create FINAL_AUDIT_REPORT.md |

*Note: Commits not yet created — changes are staged for review.*

---

## Reference

- Architecture map: `docs/audit/PROFESSIONALS_MAP.md`
- Plan file: `.claude/plans/expressive-hopping-bunny.md`
- Migration files modified/created:
  - `supabase/migrations/20260207000002_tighten_specialty_category_check.sql` (new)
  - `supabase/functions/create-professional/index.ts` (modified)
- Frontend files modified:
  - `src/professionals/api.ts`
  - `src/professionals/mappers.ts`
  - `src/professionals/components/specialty-selector-drawer.tsx`
  - `src/professionals/components/profil-public-tab.tsx`
