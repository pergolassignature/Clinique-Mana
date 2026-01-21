# Services & Pricing Design

## Overview

Update the services catalog to match the clinic's actual service offerings and add a pricing management UI to the Services page.

## Services List (12 total)

| # | Service | Key | Duration | Color | Pricing Model |
|---|---------|-----|----------|-------|---------------|
| 1 | Rencontre d'intervention web | `intervention_web_30` | 30 min | #22C55E (green) | by_profession_category |
| 2 | Rencontre d'intervention web | `intervention_web_50` | 50 min | #22C55E (green) | by_profession_category |
| 3 | Rencontre d'intervention couple - famille | `intervention_couple_famille_60` | 60 min | #F472B6 (pink) | by_profession_category |
| 4 | Rencontre d'intervention individuelle (couple-famille) | `intervention_individuelle_60` | 60 min | #F472B6 (pink) | by_profession_category |
| 5 | Appel découverte | `appel_decouverte` | 15 min | #22C55E (green) | fixed (free) |
| 6 | Discussion avec un autre intervenant | `discussion_intervenant` | — | #22C55E (green) | by_profession_hourly_prorata |
| 7 | Ouverture de dossier | `ouverture_dossier` | — | #EF4444 (red) | fixed ($43.49 + tax) |
| 8 | PAE externe | `pae_externe_30` | 30 min | #F97316 (orange) | by_profession_category |
| 9 | PAE externe | `pae_externe_50` | 50 min | #F97316 (orange) | by_profession_category |
| 10 | PAE externe - couple | `pae_externe_couple` | — | #FACC15 (yellow) | by_profession_category |
| 11 | Rédaction de rapport | `redaction_rapport` | — | #06B6D4 (cyan) | by_profession_hourly_prorata |
| 12 | Service de consultation | `service_consultation` | — | #D946EF (magenta) | by_profession_category |

## Profession Categories (8 total)

From the pricing sheet:
1. Psychologie / Psychothérapeute
2. Sexologie / Sexologue
3. Travail social / Travailleur.euse social.e
4. Orientation / Conseiller.ère en orientation
5. Psychoéducation / Psychoéducateur.trice
6. Naturopathie / Naturopathe
7. Coaching professionnel / Coach professionnel.le certifié.e

Note: Some categories may have special tax handling (e.g., Naturopathie and Coach include tax in price).

## UI Design

### Location

Services page (`/services`) - add pricing section below the services table.

### Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Services et tarification                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [+ Nouveau service]                    [Filter] [Search]   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Services Table (existing)                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Tarification par catégorie professionnelle                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Psychologie / Psychothérapeute              [Save]   │   │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐        │   │
│  │ │ Web 30min  │ │ Web 50min  │ │ Couple 60  │        │   │
│  │ │ $ 120.00   │ │ $ 160.00   │ │ $ 185.00   │        │   │
│  │ └────────────┘ └────────────┘ └────────────┘        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Sexologie / Sexologue                       [Save]   │   │
│  │ ...                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ... more categories                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Pricing Card Component

Each category displays as a card with:
- **Header**: Category name + title (e.g., "Psychologie / Psychothérapeute")
- **Grid**: 2-4 columns of service price inputs (responsive)
- **Save button**: Only enabled when changes detected

### Price Input Behavior

- Shows current price or empty placeholder
- Empty input = category doesn't offer this service (no price row in DB)
- Currency prefix ($) built into input
- Validates: positive number, max 2 decimal places
- On blur: auto-format to 2 decimals
- Save: upsert to `service_prices` table

## Data Model

### Existing Tables Used

- `services` - Service catalog
- `service_prices` - Price per service × category
- `profession_categories` - Category definitions
- `profession_titles` - Titles mapped to categories

### service_prices Table

```sql
service_prices (
  id uuid,
  service_id uuid,
  profession_category_key text,  -- NULL = global fixed price
  duration_minutes int,          -- NULL = default duration
  price_cents int,
  currency text
)
```

For category-based pricing:
- `profession_category_key` = category key (e.g., 'psychologie')
- `duration_minutes` = NULL (use service's default duration)
- `price_cents` = price in cents

## API Functions

### Queries

```typescript
// Fetch all prices for category-based services
fetchCategoryPrices(): Promise<ServicePrice[]>

// Already exists
fetchProfessionCategories(): Promise<ProfessionCategory[]>
```

### Mutations

```typescript
// Upsert prices for a category (bulk operation)
upsertCategoryPrices(
  categoryKey: string,
  prices: { serviceId: string; priceCents: number | null }[]
): Promise<void>
```

- `priceCents: null` = delete the price row (category doesn't offer service)
- `priceCents: number` = upsert the price

## Implementation Steps

1. **Migration**: Replace seed data with correct 12 services
2. **API**: Add `upsertCategoryPrices` function and RLS policies for `service_prices`
3. **Hooks**: Add `useCategoryPrices` and `useUpsertCategoryPrices`
4. **Component**: Create `CategoryPricingCard` component
5. **Page**: Add pricing section to Services page
6. **Translations**: Add FR-CA strings

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260121000014_services_v3_seed.sql` | New - replace services |
| `supabase/migrations/20260121000015_service_prices_rls.sql` | New - RLS for prices |
| `src/services-catalog/api.ts` | Modify - add price mutations |
| `src/services-catalog/hooks.ts` | Modify - add price hooks |
| `src/services-catalog/components/category-pricing-card.tsx` | New |
| `src/services-catalog/components/category-pricing-section.tsx` | New |
| `src/pages/services.tsx` | Modify - add pricing section |
| `src/i18n/fr-CA.json` | Modify - add translations |
