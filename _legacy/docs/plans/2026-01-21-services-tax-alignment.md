# Services & Tax System Alignment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align frontend and backend for a production-ready tax system with category-level tax control.

**Architecture:** Single source of truth: `profession_categories.tax_included` determines if prices for that category include TPS+TVQ (14.975%). Service-level `service_tax_rules` is deprecated for category-based services.

**Tech Stack:** Supabase (PostgreSQL), React + TypeScript, React Query

---

## Root Cause Analysis

The current system has **two conflicting tax models**:

1. **Category-Level Tax** (`profession_categories.tax_included`)
   - Recently added flag
   - When `true`: prices include 14.975% taxes (Naturopathie, Coaching)
   - When `false`: prices are tax-exempt (most health professions)

2. **Service-Level Tax** (`service_tax_rules`)
   - Original system with per-service tax rules
   - Only `ouverture_dossier` has rules (fixed taxable service)
   - Unused for category-based services

**Issues Identified:**

| Issue | Impact | Fix |
|-------|--------|-----|
| Two conflicting tax systems | Confusion on which applies | Deprecate service-level for category services |
| `profession_category_rates` table empty | Hourly prorata can't calculate prices | Seed hourly rates |
| Frontend doesn't show tax clearly | Users can't understand tax status | Add clear tax indicators |
| Missing RLS for some operations | Frontend can't update data | Add RLS policies |

---

## Task 1: Seed Hourly Rates for Prorata Services

**Files:**
- Create: `supabase/migrations/20260121000021_seed_profession_category_rates.sql`

**Step 1: Create the migration file**

```sql
-- Migration: Seed profession_category_rates for hourly billing
-- Date: 2026-01-21
--
-- Hourly rates are derived from 50-min session prices:
--   hourly_rate = (50_min_price / 50) * 60
--
-- Example: Psychologie $160/50min → $192/hour

INSERT INTO public.profession_category_rates (profession_category_key, hourly_rate_cents, currency)
VALUES
  -- Psychologie: $160/50min → $192/hour
  ('psychologie', 19200, 'CAD'),
  -- Psychothérapie: $160/50min → $192/hour
  ('psychotherapie', 19200, 'CAD'),
  -- Sexologie: $130/50min → $156/hour
  ('sexologie', 15600, 'CAD'),
  -- Travail social: $110/50min → $132/hour
  ('travail_social', 13200, 'CAD'),
  -- Orientation: $130/50min → $156/hour
  ('orientation', 15600, 'CAD'),
  -- Psychoéducation: $130/50min → $156/hour
  ('psychoeducation', 15600, 'CAD'),
  -- Naturopathie: $130/50min → $156/hour (tax included)
  ('naturopathie', 15600, 'CAD'),
  -- Coaching: $110/50min → $132/hour (tax included)
  ('coaching_professionnel', 13200, 'CAD')
ON CONFLICT (profession_category_key) DO UPDATE SET
  hourly_rate_cents = EXCLUDED.hourly_rate_cents,
  updated_at = now();
```

**Step 2: Push migration to staging**

Run: `supabase db push`
Expected: Migration applied successfully

**Step 3: Verify data**

Run: `supabase db query "SELECT profession_category_key, hourly_rate_cents FROM profession_category_rates ORDER BY profession_category_key"`
Expected: 8 rows with correct hourly rates

**Step 4: Commit**

```bash
git add supabase/migrations/20260121000021_seed_profession_category_rates.sql
git commit -m "feat(services): seed hourly rates for prorata billing"
```

---

## Task 2: Add RLS Policies for Hourly Rates

**Files:**
- Create: `supabase/migrations/20260121000022_profession_category_rates_rls_write.sql`

**Step 1: Create the migration file**

```sql
-- Migration: Add RLS write access for profession_category_rates
-- Date: 2026-01-21
--
-- Allows admin/staff to update hourly rates from the frontend.

-- UPDATE policy for admin/staff
CREATE POLICY "profession_category_rates_update_authenticated"
  ON public.profession_category_rates FOR UPDATE
  TO authenticated
  USING ((SELECT public.get_my_role()) IN ('admin', 'staff'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('admin', 'staff'));

-- INSERT policy for admin/staff (in case new categories are added)
CREATE POLICY "profession_category_rates_insert_authenticated"
  ON public.profession_category_rates FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('admin', 'staff'));
```

**Step 2: Push migration to staging**

Run: `supabase db push`
Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add supabase/migrations/20260121000022_profession_category_rates_rls_write.sql
git commit -m "feat(services): add RLS write access for hourly rates"
```

---

## Task 3: Add Frontend Types for Hourly Rates

**Files:**
- Modify: `src/services-catalog/types.ts`

**Step 1: Add the interface**

Add after `ServicePrice` interface (around line 71):

```typescript
// =============================================================================
// PROFESSION CATEGORY RATES (Hourly billing)
// =============================================================================

export interface ProfessionCategoryRate {
  id: string
  professionCategoryKey: string
  hourlyRateCents: number
  currency: string
  isActive: boolean
}
```

**Step 2: Commit**

```bash
git add src/services-catalog/types.ts
git commit -m "feat(services): add ProfessionCategoryRate type"
```

---

## Task 4: Add API Functions for Hourly Rates

**Files:**
- Modify: `src/services-catalog/api.ts`

**Step 1: Add import for ProfessionCategoryRate**

Update the import at line 9:

```typescript
import type {
  Service,
  ServiceFormData,
  ProfessionCategory,
  ProfessionTitle,
  ServicePrice,
  ProfessionCategoryRate,
  PricingModel,
  TaxRate,
  ServiceTaxRule,
  ServiceTaxProfile,
} from './types'
```

**Step 2: Add fetch function**

Add after `fetchProfessionTitles` (around line 190):

```typescript
// =============================================================================
// PROFESSION CATEGORY RATES (Hourly billing)
// =============================================================================

export async function fetchProfessionCategoryRates(): Promise<ProfessionCategoryRate[]> {
  const { data, error } = await supabase
    .from('profession_category_rates')
    .select('*')
    .eq('is_active', true)

  if (error) throw error

  return (data || []).map((row) => ({
    id: row.id,
    professionCategoryKey: row.profession_category_key,
    hourlyRateCents: row.hourly_rate_cents,
    currency: row.currency,
    isActive: row.is_active,
  }))
}

/**
 * Update the hourly rate for a profession category.
 */
export async function updateProfessionCategoryRate(
  categoryKey: string,
  hourlyRateCents: number
): Promise<void> {
  const { error } = await supabase
    .from('profession_category_rates')
    .upsert({
      profession_category_key: categoryKey,
      hourly_rate_cents: hourlyRateCents,
      currency: 'CAD',
      is_active: true,
    }, {
      onConflict: 'profession_category_key',
    })

  if (error) throw error
}
```

**Step 3: Commit**

```bash
git add src/services-catalog/api.ts
git commit -m "feat(services): add API functions for hourly rates"
```

---

## Task 5: Add React Query Hooks for Hourly Rates

**Files:**
- Modify: `src/services-catalog/hooks.ts`

**Step 1: Add imports**

Update imports to include new functions:

```typescript
import {
  fetchServices,
  fetchActiveServices,
  fetchServiceById,
  createService,
  updateService,
  archiveService,
  restoreService,
  fetchProfessionCategories,
  fetchProfessionTitles,
  fetchServicePrices,
  fetchAllServicePrices,
  fetchCategoryPrices,
  upsertCategoryPrices,
  upsertServiceBasePrice,
  fetchTaxRates,
  fetchServiceTaxRules,
  fetchAllServiceTaxProfiles,
  setServiceTaxProfile,
  updateCategoryTaxIncluded,
  fetchProfessionCategoryRates,
  updateProfessionCategoryRate,
  type CategoryPriceInput,
} from './api'
```

**Step 2: Add query key**

Add to `professionKeys` object:

```typescript
export const professionKeys = {
  all: ['professions'] as const,
  categories: () => [...professionKeys.all, 'categories'] as const,
  titles: () => [...professionKeys.all, 'titles'] as const,
  rates: () => [...professionKeys.all, 'rates'] as const,
}
```

**Step 3: Add hooks**

Add after `useUpdateCategoryTaxIncluded`:

```typescript
/**
 * Fetch all profession category hourly rates.
 */
export function useProfessionCategoryRates() {
  return useQuery({
    queryKey: professionKeys.rates(),
    queryFn: fetchProfessionCategoryRates,
    staleTime: 1000 * 60 * 10, // 10 minutes
  })
}

/**
 * Update hourly rate for a profession category.
 */
export function useUpdateProfessionCategoryRate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      categoryKey,
      hourlyRateCents,
    }: {
      categoryKey: string
      hourlyRateCents: number
    }) => updateProfessionCategoryRate(categoryKey, hourlyRateCents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: professionKeys.rates() })
    },
  })
}
```

**Step 4: Commit**

```bash
git add src/services-catalog/hooks.ts
git commit -m "feat(services): add React Query hooks for hourly rates"
```

---

## Task 6: Update Category Pricing Section UI

**Files:**
- Modify: `src/services-catalog/components/category-pricing-section.tsx`

**Step 1: Import hourly rate hook**

Update imports:

```typescript
import {
  useServices,
  useProfessionCategories,
  useProfessionTitles,
  useCategoryPrices,
  useUpsertCategoryPrices,
  useUpdateCategoryTaxIncluded,
  useProfessionCategoryRates,
} from '../hooks'
```

**Step 2: Add hourly rate data fetching**

After line 185 (existing data queries), add:

```typescript
const { data: hourlyRates = [] } = useProfessionCategoryRates()
```

**Step 3: Create hourly rate lookup**

Add after `priceLookup` useMemo (around line 232):

```typescript
const hourlyRateLookup = useMemo(() => {
  const lookup = new Map<string, number>()
  for (const rate of hourlyRates) {
    lookup.set(rate.professionCategoryKey, rate.hourlyRateCents)
  }
  return lookup
}, [hourlyRates])
```

**Step 4: Update HourlyServiceRow to show rate**

Update the HourlyServiceRow component to display the hourly rate:

```typescript
interface HourlyServiceRowProps {
  service: Service
  taxIncluded: boolean
  hourlyRateCents: number | null
}

function HourlyServiceRow({ service, taxIncluded, hourlyRateCents }: HourlyServiceRowProps) {
  const formattedRate = hourlyRateCents !== null
    ? `${(hourlyRateCents / 100).toFixed(2)} $/h`
    : t('pages.services.pricing.rateNotSet')

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {service.colorHex && (
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: service.colorHex }}
          />
        )}
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{service.name}</p>
            <p className="text-xs text-foreground-muted">
              {t('pages.services.pricing.hourlyProrata')}
            </p>
          </div>
          <Badge
            variant={taxIncluded ? 'warning' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-4"
          >
            {taxIncluded
              ? t('pages.services.pricing.taxIncluded')
              : t('pages.services.pricing.taxExempt')}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {formattedRate}
        </span>
      </div>
    </div>
  )
}
```

**Step 5: Update HourlyServiceRow usage**

Update the rendering to pass hourly rate (around line 471):

```typescript
{hourlyProrataServices.map((service) => (
  <HourlyServiceRow
    key={service.id}
    service={service}
    taxIncluded={localTaxIncluded ?? categoryInfo?.category?.taxIncluded ?? false}
    hourlyRateCents={hourlyRateLookup.get(selectedCategoryKey) ?? null}
  />
))}
```

**Step 6: Commit**

```bash
git add src/services-catalog/components/category-pricing-section.tsx
git commit -m "feat(services): display hourly rates in category pricing section"
```

---

## Task 7: Add Translations for New UI Elements

**Files:**
- Modify: `src/i18n/fr-CA.json`

**Step 1: Add new translation keys**

Add to `pages.services.pricing` section:

```json
"rateNotSet": "Taux non défini",
"hourlyRate": "Taux horaire"
```

**Step 2: Commit**

```bash
git add src/i18n/fr-CA.json
git commit -m "feat(i18n): add hourly rate translations"
```

---

## Task 8: Verify Type Safety

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Fix any type errors if present**

If errors occur, fix them before proceeding.

---

## Task 9: Test the Complete Flow

**Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts at localhost:5173 or 5174

**Step 2: Navigate to services page**

Open: `/reglages/services-offerts`
Expected: Category pricing section loads

**Step 3: Verify hourly rates display**

Select a category and verify:
- Hourly prorata services show the hourly rate (e.g., "$192.00/h")
- Tax badge shows correct status (Taxable/Exempté)

**Step 4: Toggle tax status**

Toggle the tax switch for a category and save.
Expected:
- Badge updates to reflect new status
- Toast shows success

---

## Task 10: Final Commit and Summary

**Step 1: Run final type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (or only warnings)

**Step 3: Create summary commit if needed**

If any fixes were made during testing:

```bash
git add -A
git commit -m "fix(services): address issues found during testing"
```

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| **Database** | Seeded `profession_category_rates` with 8 hourly rates |
| **Database** | Added RLS write policies for rates table |
| **Frontend Types** | Added `ProfessionCategoryRate` interface |
| **Frontend API** | Added `fetchProfessionCategoryRates`, `updateProfessionCategoryRate` |
| **Frontend Hooks** | Added `useProfessionCategoryRates`, `useUpdateProfessionCategoryRate` |
| **Frontend UI** | Updated `HourlyServiceRow` to display actual hourly rate |
| **i18n** | Added `rateNotSet` translation |

## Tax System Architecture (Final)

```
┌─────────────────────────────────────────────────────────────────┐
│                     profession_categories                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ key: psychologie         │ tax_included: false          │    │
│  │ key: naturopathie        │ tax_included: true           │    │
│  │ key: coaching_professionnel │ tax_included: true        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       service_prices                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ service: web_50           │ category: psychologie       │    │
│  │ price_cents: 16000        │ (tax_included from category)│    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  profession_category_rates                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ category: psychologie     │ hourly_rate_cents: 19200    │    │
│  │ (for prorata billing: minutes/60 * hourly_rate)         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Invoice Calculation Logic:**

For `tax_included = false` (exempt):
- Display: $160.00
- Invoice: $160.00 (no tax line)

For `tax_included = true`:
- Display: $130.00 (includes tax)
- Invoice back-calculation:
  - Pre-tax: $130.00 / 1.14975 = $113.07
  - TPS (5%): $5.65
  - TVQ (9.975%): $11.28
  - Total: $130.00
