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
