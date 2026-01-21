# Pre-Tax Price Storage Refactor Design

**Date:** 2026-01-21
**Status:** Approved

## Summary

Refactor the services pricing system to store all prices as pre-tax amounts. This simplifies invoicing calculations and ensures consistent tax handling across the platform.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Price storage | Pre-tax (base price) | Simplifies invoicing, industry standard |
| Price display | Pre-tax + tax breakdown | Shows "$113.07 + $16.93 taxes = $130.00" |
| Admin entry | Enter final price | Backend extracts pre-tax automatically |
| Column rename | Keep `tax_included` | Less churn, update comments to clarify meaning |

## Quebec Tax Rates

- **TPS (GST):** 5% (500 bps)
- **TVQ (QST):** 9.975% (9975 bps)
- **Combined:** 14.975%

## Data Model

### Current State

| Category | `tax_included` | Current Meaning |
|----------|----------------|-----------------|
| Naturopathie | true | Price includes TPS+TVQ |
| Coaching professionnel | true | Price includes TPS+TVQ |
| All others | false | Price is pre-tax |

### Target State

All prices stored as **pre-tax** amounts. The `tax_included` flag becomes "is taxable":

| Category | `tax_included` | New Meaning |
|----------|----------------|-------------|
| Naturopathie | true | Service is taxable (add TPS+TVQ) |
| Coaching professionnel | true | Service is taxable (add TPS+TVQ) |
| All others | false | Service is tax-exempt |

### Migration Logic

For Naturopathie and Coaching professionnel, convert existing prices:

```sql
pre_tax_cents = ROUND(price_cents / 1.14975)
```

Example: $130.00 → $113.07 pre-tax

## Tax Utilities

New file: `src/utils/tax.ts`

```typescript
// Quebec tax rates
export const QC_TPS_RATE = 0.05      // 5%
export const QC_TVQ_RATE = 0.09975   // 9.975%
export const QC_COMBINED_RATE = 0.14975

// Calculate tax from pre-tax amount
export function calculateTax(preTaxCents: number): number {
  return Math.round(preTaxCents * QC_COMBINED_RATE)
}

// Extract pre-tax from total (for admin entry)
export function extractPreTax(totalCents: number): number {
  return Math.round(totalCents / (1 + QC_COMBINED_RATE))
}

// Format price with tax breakdown
export function formatPriceWithTax(
  preTaxCents: number,
  isTaxable: boolean
): string {
  if (!isTaxable) {
    return `${(preTaxCents / 100).toFixed(2)} $`
  }
  const taxCents = calculateTax(preTaxCents)
  const totalCents = preTaxCents + taxCents
  return `${(preTaxCents / 100).toFixed(2)} $ + ${(taxCents / 100).toFixed(2)} $ taxes = ${(totalCents / 100).toFixed(2)} $`
}
```

## UI Changes

### Price Display in Tables

**Taxable service:**
```
$113.07 + $16.93 taxes = $130.00
```

**Exempt service:**
```
$160.00
```

### Admin Price Entry

When admin enters a price:
1. User enters final price (e.g., $130.00)
2. If category is taxable, backend extracts pre-tax: `130.00 / 1.14975 = $113.07`
3. Store $113.07 in database

## Implementation Order

1. **Migration:** Convert Naturopathie/Coaching prices to pre-tax
2. **Tax utilities:** Create `src/utils/tax.ts`
3. **API update:** Use `extractPreTax` when saving taxable prices
4. **UI update:** Use `formatPriceWithTax` for display
5. **Translations:** Add tax-related strings

## Files to Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260121000023_convert_prices_to_pretax.sql` | CREATE |
| `src/utils/tax.ts` | CREATE |
| `src/services-catalog/api.ts` | MODIFY |
| `src/services-catalog/components/category-pricing-section.tsx` | MODIFY |
| `src/i18n/fr-CA.json` | MODIFY |

## Verification

- [ ] Naturopathie prices converted: $130.00 → $113.07 stored
- [ ] Coaching prices converted: $110.00/$70.00 → $95.67/$60.88 stored
- [ ] Display shows breakdown for taxable categories
- [ ] Display shows simple price for exempt categories
- [ ] Admin entry extracts pre-tax correctly
- [ ] `npm run typecheck` passes
