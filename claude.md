# Clinique MANA - Claude Code Context

## Project Overview

Clinique MANA is a mental health clinic management platform built with React + TypeScript + Supabase.

## Environment

### STAGING (Current Target)

| Property | Value |
|----------|-------|
| Project ID | `vnmbjbdsjxmpijyjmmkh` |
| Name | `clinique-mana-staging` |
| Region | Canada (Central) |
| URL | https://vnmbjbdsjxmpijyjmmkh.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/vnmbjbdsjxmpijyjmmkh |

### Supabase CLI

```bash
# Link to staging
supabase link --project-ref vnmbjbdsjxmpijyjmmkh

# Check migration status
supabase migration list

# Push pending migrations
supabase db push
```

## Database Schema

### Applied Migrations (14 total)

1. `20260118000001_auth_foundation_schema.sql` - profiles + audit tables
2. `20260118000002_auth_foundation_rls.sql` - RLS policies
3. `20260118000003_professionals_schema.sql` - professionals + specialties + documents
4. `20260118000004_professionals_rls.sql` - Professional RLS policies
5. `20260118000005_professionals_storage.sql` - Storage buckets
6. `20260118000006_professionals_audit_helpers.sql` - Audit functions
7. `20260118000007_motifs_schema.sql` - motifs + junction tables
8. `20260118000008_motifs_seed.sql` - 72 official motifs (FR-CA)
9. `20260119000001_fix_professionals_rls_recursion.sql` - RLS recursion fix
10. `20260119000002_motifs_rls_write_access.sql` - Motifs write access
11. `20260119000003_professional_motifs_rls_fix.sql` - Professional motifs RLS
12. `20260119000004_anon_document_upload_policies.sql` - Document upload policies
13. `20260119000005_services_schema.sql` - services + variants + taxes + consent + professional junction
14. `20260119000006_services_seed.sql` - sample services + QC tax rates

### Key Tables

- `profiles` - Application-layer user identity (admin, staff, provider)
- `professionals` - Provider details linked to profiles
- `professional_specialties` - Junction: professionals ↔ specialties
- `professional_documents` - Uploaded documents (CV, license, etc.)
- `motifs` - Consultation motifs (72 items, non-clinical orientation tags)
- `professional_motifs` - Junction: professionals ↔ motifs
- `demande_motifs` - Junction: demandes ↔ motifs (demandes table pending)
- `services` - Service catalog (name, duration, price, online availability)
- `service_variants` - Variants to avoid duplicates (e.g., Couple, Médiation)
- `tax_rates` - Tax rates for invoicing (TPS 5%, TVQ 9.975%)
- `service_tax_rules` - Service-to-tax mapping
- `service_consent_requirements` - Consent documents per service
- `professional_services` - Junction: professionals ↔ services

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Routing**: TanStack Router
- **Styling**: Tailwind CSS + shadcn/ui + Radix UI
- **Animation**: Framer Motion
- **Backend**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **i18n**: French-Canadian (FR-CA)

## Design Principles

1. **Non-clinical language**: Motifs are orientation tags, NOT diagnoses
2. **Calm, human tone**: Avoid clinical/medical terminology in UI
3. **Display-only groupings**: Motif categories ("spheres of life") are UI-only, not stored
4. **Soft-delete pattern**: Use `is_active` flags, never hard delete reference data
5. **FR-CA first**: All user-facing labels in French-Canadian
6. **Timezone consistency**: All dates must use clinic timezone utilities (see below)

## Timezone Handling (IMPORTANT)

All dates in the database are stored as UTC (`timestamptz`). The clinic operates in a configurable timezone (default: `America/Toronto` for EST/EDT).

### Rules

1. **NEVER use `new Date().toLocaleDateString()` or `format()` from date-fns directly** for user-facing dates
2. **ALWAYS use the centralized timezone utilities** from `@/shared/lib/timezone`
3. **Database storage**: Always store as UTC ISO strings
4. **Display**: Always convert to clinic timezone before display

### Timezone Utilities (`src/shared/lib/timezone.ts`)

```typescript
import {
  // For timestamptz fields (appointments, created_at, etc.)
  formatInClinicTimezone,    // Generic: formatInClinicTimezone(date, 'EEEE d MMMM')
  toClinicTime,              // Convert UTC to clinic time for comparisons
  getClinicDateString,       // Get 'yyyy-MM-dd' in clinic timezone
  getClinicTimeString,       // Get 'HH:mm' in clinic timezone
  formatClinicDateFull,      // 'mercredi 21 janvier 2026'
  formatClinicDateShort,     // '21 janv. 2026'
  formatClinicTime,          // '14:30'
  formatClinicDateTime,      // '21 janv. 2026 à 14:30'
  clinicTimeToUTC,           // Convert form inputs to UTC for storage

  // For date-only fields (birthday, expiry_date, event_date, etc.)
  formatDateOnly,            // '1 janvier 2020' - NO timezone conversion
  formatDateOnlyFull,        // 'mercredi 1 janvier 2020'
  formatDateOnlyShort,       // '1 janv. 2020'
} from '@/shared/lib/timezone'
```

### Examples

```typescript
// ❌ WRONG - will show browser's local timezone
format(new Date(apt.startTime), 'dd MMM yyyy', { locale: fr })
new Date(dateStr).toLocaleDateString('fr-CA', {...})

// ✅ CORRECT - uses clinic timezone
formatClinicDateShort(apt.startTime)
formatInClinicTimezone(apt.startTime, 'dd MMM yyyy')

// ❌ WRONG - date comparisons in wrong timezone
const aptDate = new Date(apt.startTime)
if (isToday(aptDate)) { ... }

// ✅ CORRECT - convert to clinic time first
const aptDate = toClinicTime(apt.startTime)
if (isToday(aptDate)) { ... }

// ❌ WRONG - saving form input without timezone conversion
const startTime = `${date}T${time}:00`

// ✅ CORRECT - convert clinic time to UTC before saving
const startTimeUTC = clinicTimeToUTC(date, time)
```

### Date-Only Fields (Birthday, Expiry Dates, etc.) - CRITICAL

For **date-only fields** stored as `date` type (not `timestamptz`), do NOT apply timezone conversion. These are calendar dates without time components.

**Common date-only fields:**
- `birthday` / `date_of_birth`
- `expiry_date` (licenses, external payers)
- `event_date` (IVAC)
- Any field storing just a calendar date without time

```typescript
// ❌ WRONG - will shift date by timezone offset (e.g., 2020-01-01 → 2019-12-31)
formatInClinicTimezone(client.birthday, 'dd MMMM yyyy')
formatInClinicTimezone(payer.expiry_date, 'dd MMMM yyyy')

// ✅ CORRECT - use formatDateOnly utility (no timezone conversion)
import { formatDateOnly, formatDateOnlyFull, formatDateOnlyShort } from '@/shared/lib/timezone'

formatDateOnly(client.birthday)           // "1 janvier 2020"
formatDateOnly(client.birthday, 'dd/MM/yyyy')  // "01/01/2020"
formatDateOnlyFull(payer.event_date)      // "mercredi 1 janvier 2020"
formatDateOnlyShort(payer.expiry_date)    // "1 janv. 2020"
```

**Why this bug happens:** When you pass a date-only string like `"2020-01-01"` to `formatInClinicTimezone()`, JavaScript interprets it as UTC midnight. Converting to EST/EDT shifts it back 4-5 hours, resulting in December 31, 2019 at 19:00.

### Configuration

The clinic timezone is stored in `clinic_settings.timezone` and can be configured in:
**Settings → Configuration clinique → Fuseau horaire**

## File Structure

```
src/
├── i18n/             # Translations (fr-CA.json)
├── motifs/           # Motifs module (types, constants, components)
├── services-catalog/ # Services module (types, constants, components)
├── professionals/    # Professionals module
├── pages/            # Route pages
├── shared/           # Shared components and utilities
└── lib/              # Supabase client, utils

supabase/
├── migrations/     # Database migrations
├── config.toml     # Local dev config
└── seed.sql        # Local seed data

docs/
├── deploy/         # Deployment guides
├── modules/        # Module status docs
└── standards/      # Design standards
```

## Form Accessibility & Tab Order (IMPORTANT)

All forms must follow proper keyboard navigation patterns for professional SaaS UX.

### Tab Order Rules

1. **Close buttons (X) should NOT be in the tab order** - Users expect Tab to navigate form fields, not UI chrome
2. **Section navigation tabs should NOT be in the tab order** - These are clicked with mouse, not keyboard-navigated
3. **Form fields should flow naturally** - Prénom → Nom → Sexe → Langue → etc.

### Implementation

#### Sheet/Dialog Close Buttons

Both `Sheet` and `Dialog` components have `tabIndex={-1}` on their default close buttons. This is automatic.

```tsx
// If you add a CUSTOM close button in your header, use hideClose:
<SheetContent hideClose>
  <header>
    <h2>Title</h2>
    <Button onClick={onClose} tabIndex={-1}>  {/* Custom close also needs tabIndex={-1} */}
      <X />
    </Button>
  </header>
</SheetContent>

// If using the DEFAULT close button, nothing special needed:
<SheetContent>
  {/* Default X button already has tabIndex={-1} */}
</SheetContent>
```

#### Section Navigation Tabs

For form section tabs (Identité, Coordonnées, Adresse, etc.), use `NavTabs` component:

```tsx
import { NavTabs, NavTab } from '@/shared/ui/nav-tabs'

<NavTabs className="border-b border-border px-6">
  {sections.map((section) => (
    <NavTab
      key={section.id}
      active={activeSection === section.id}
      icon={<section.icon className="h-4 w-4" />}
      onClick={() => setActiveSection(section.id)}
    >
      {section.label}
    </NavTab>
  ))}
</NavTabs>
```

Or manually with `tabIndex={-1}`:

```tsx
<button
  type="button"
  tabIndex={-1}  // Exclude from tab order
  onClick={() => setActiveSection(section.id)}
>
  {section.label}
</button>
```

### hideClose Prop

Both `SheetContent` and `DialogContent` support `hideClose` prop to prevent double X buttons:

```tsx
// ❌ WRONG - will show TWO close buttons
<SheetContent>
  <header>
    <Button onClick={onClose}><X /></Button>  {/* Custom X */}
  </header>
  {/* PLUS the default X from SheetContent */}
</SheetContent>

// ✅ CORRECT - hide default X when using custom
<SheetContent hideClose>
  <header>
    <Button onClick={onClose} tabIndex={-1}><X /></Button>
  </header>
</SheetContent>
```

## Common Commands

```bash
# Development
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Supabase local
supabase start
supabase stop

# Deploy migrations to staging
supabase db push
```
