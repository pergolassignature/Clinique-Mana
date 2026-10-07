# Professionals Section — Architecture Map

> Generated during the Professionals Section Audit (2026-02-07)

---

## Routes

| Path | Component | Purpose |
|------|-----------|---------|
| `/professionnels` | `ProfessionalsPage` | Card grid list with search, status filter, create |
| `/professionnels/$id` | `ProfessionalDetailPage` | 7-tab detail view with header + status actions |

**Router**: TanStack Router, configured in `src/app/router.tsx` (lines 103-114)

---

## Components per Route

### List Page — `src/pages/professionals.tsx`

| Component | Purpose |
|-----------|---------|
| `ProfessionalCard` (inline) | Card displaying name, email, status badge, specialty/document counts |
| `ProfessionalCardSkeleton` (inline) | Loading placeholder |
| `CreateProfessionalDialog` | Modal: name + email + optional invite |

**Features**: Search by name/email, status filter (all/pending/invited/active/inactive), 3-column card grid

### Detail Page — `src/pages/professional-detail.tsx`

**Header**: Avatar/initials, display name, email, title, status badge, activate/deactivate button

**Tabs** (7 total):

| Tab ID | Label | Component | Purpose |
|--------|-------|-----------|---------|
| `apercu` | Aperçu | `apercu-tab.tsx` | Dashboard: alerts, quick actions, onboarding progress, PDF generation |
| `profil` | Profil | `profile-tab.tsx` | Internal data: phone, address, IVAC, professions, system dates |
| `profil-public` | Profil public | `profil-public-tab.tsx` | Public-facing: bio, approach, contact, specialties, motifs, questionnaire review |
| `services` | Services | `services-tab.tsx` | Service assignment per profession title |
| `documents` | Documents | `documents-tab.tsx` | Upload, verify, manage documents with expiry tracking |
| `calendrier` | Calendrier | `calendar-tab.tsx` | Google Calendar OAuth integration (in development) |
| `historique` | Historique | `history-tab.tsx` | Audit log timeline with humanized actions |

### Dialogs & Drawers

| Component | File | Trigger |
|-----------|------|---------|
| `CreateProfessionalDialog` | `create-professional-dialog.tsx` | List page "+" button |
| `UpdateRequestModal` | `update-request-modal.tsx` | Aperçu tab quick action |
| `SpecialtySelectorDrawer` | `specialty-selector-drawer.tsx` | Profil Public tab edit button |
| `MotifSelectorDrawer` | `motif-selector-drawer.tsx` | Profil Public tab edit button |
| `ProfessionEditor` | `profession-editor.tsx` | Profil tab inline |
| `AddressSection` | `address-section.tsx` | Profil tab inline |
| Profession Selector Dialog | Inside `apercu-tab.tsx` | PDF generation with 2+ professions |
| Status Change Dialog | Inside `professional-detail.tsx` | Activate/deactivate button |

---

## Data Dependencies

### Core Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/professionals/types.ts` | 545 | All TypeScript types, Zod schemas, enums |
| `src/professionals/api.ts` | 1709 | All Supabase queries and mutations |
| `src/professionals/hooks.ts` | 805 | React Query hooks (queries + mutations) |
| `src/professionals/mappers.ts` | 908 | View models, display status derivation, humanization |

### State Management

**React Query** with `professionalKeys` factory:
```
professionals.all → ['professionals']
professionals.list(filters, sort) → ['professionals', 'list', {filters, sort}]
professionals.detail(id) → ['professionals', 'detail', id]
professionals.documents(id) → [...detail(id), 'documents']
professionals.invites(id) → [...detail(id), 'invites']
professionals.questionnaire(id) → [...detail(id), 'questionnaire']
professionals.auditLog(id) → [...detail(id), 'audit']
professionals.services(id) → [...detail(id), 'services']
professionals.calendarConnection(id) → [...detail(id), 'calendar']
```

### External Module Integrations

| Module | Usage |
|--------|-------|
| `@/motifs` | Motif data and categories for selector |
| `@/services-catalog` | Service data for service assignment tab |
| `@/external-payers` | IVAC number management |
| `@/contracts` | Service contract section in documents tab |
| `@/document-templates` | Service contract status check |
| `@/shared/ui/*` | All UI primitives (Button, Dialog, Sheet, Badge, etc.) |
| `@/shared/lib/timezone` | Date formatting utilities |

---

## Database Tables

| Table | Purpose | FK |
|-------|---------|-----|
| `professionals` | Core provider record | `profile_id → profiles` |
| `professional_specialties` | Junction: professionals ↔ specialties | cascade delete |
| `professional_motifs` | Junction: professionals ↔ motifs | cascade delete |
| `professional_professions` | Profession titles (max 2) with license numbers | cascade delete |
| `professional_documents` | Uploaded files with verification/expiry | cascade delete |
| `professional_services` | Service assignments per profession title | cascade delete |
| `professional_onboarding_invites` | Invites with token, status, expiry | cascade delete |
| `professional_questionnaire_submissions` | Form responses (JSONB) with review workflow | cascade delete |
| `professional_audit_log` | Immutable audit trail (via triggers) | cascade delete |
| `specialties` | Reference: therapy types + clienteles | — |
| `profession_titles` | Reference: profession title labels | — |

---

## Permissions Overview

| Role | professionals | specialties | documents | invites | questionnaires | audit_log | storage |
|------|--------------|-------------|-----------|---------|----------------|-----------|---------|
| **Admin** | CRUD | CRUD | CRUD | CRUD | RU | R + insert | CRUD |
| **Staff** | CRU | R | CRU (no delete) | CRU (no delete) | RU + insert | R + insert | CRU |
| **Provider** | R own, U own | R | — | — | — | — | — |
| **Anon** | — | — | Insert photo/insurance | R by token | Insert, U draft→submitted | — | Insert photo/insurance |

**Key constraints**:
- Provider self-update: status changes enforced at application layer only (RLS fix for recursion)
- Anon access: requires valid, non-expired invite token
- Audit writes: via SECURITY DEFINER triggers only (append-only)

---

## Key Workflows

### 1. Create Professional
```
Staff clicks "+" → CreateProfessionalDialog → createProfessionalWithProfile()
  → Edge Function creates: auth.users + profiles (role: provider) + professionals (status: pending)
  → Optional: creates initial invite → status becomes 'invited'
  → Navigate to detail page
```

### 2. Onboarding (Invite → Questionnaire → Review → Activate)
```
Staff creates invite → professional status: pending → invited
  → Professional opens link → invite status: opened
  → Fills questionnaire (personal, professional, documents) → submits
  → invite status: completed, submission status: submitted
  → Staff reviews in Profil Public tab
  → Staff applies questionnaire → overwrites bio/approach/professions/specialties/motifs
  → submission status: approved
  → Staff activates → professional status: active
```

### 3. Update Request
```
Staff requests update (specific sections) → creates invite with pre-populated snapshot
  → Professional edits only requested sections
  → Same review/apply flow as onboarding
```

### 4. Document Management
```
Upload file → record in professional_documents + file in storage
  → Staff verifies (verified_at, verified_by)
  → Expiry tracking (auto March 31 for insurance)
  → Required docs: photo, insurance, image rights consent
```

### 5. Deactivation
```
Staff/admin clicks "Deactivate" → confirmation dialog
  → professional status: active → inactive
  → Optional deactivation_reason (manual, insurance_expired)
```
