# Facturation Module Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix UI preview bugs showing 0$ prices, incorrect cancellation fees, timezone issues, and add parent billing option.

**Architecture:** All fixes are UI-only - the RPC `create_invoice_with_line_item()` already calculates prices correctly server-side. We're fixing the preview display using existing hooks and utilities.

**Tech Stack:** React, TypeScript, TanStack Query hooks, existing pricing utilities

---

## Task 1: Add Price Resolution Hooks to Invoice Billing Tab

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:1-20` (imports)
- Modify: `src/facturation/components/invoice-billing-tab.tsx:52-65` (hooks)

**Step 1: Add imports for price resolution**

Add after line 17 (after existing imports):
```typescript
import { useServicePrices, useProfessionTitles, useProfessionCategories } from '@/services-catalog/hooks'
import { determineIsTaxable, calculateCancellationFee } from '../utils/pricing'
```

**Step 2: Add hooks for price data**

Add after line 52 (after `useProfessional`):
```typescript
// Price resolution hooks
const { data: servicePrices = [] } = useServicePrices()
const { data: professionTitles = [] } = useProfessionTitles()
const { data: professionCategories = [] } = useProfessionCategories()
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "feat(facturation): add price resolution hooks to billing tab"
```

---

## Task 2: Add Price Resolution Logic

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:65-75` (add useMemos)

**Step 1: Add professionCategoryKey useMemo**

Add after the new hooks from Task 1:
```typescript
// Resolve professional's category key (pattern from invoice-creation-dialog.tsx:237-246)
const professionCategoryKey = useMemo(() => {
  if (!professional?.professions?.length) return null
  const firstProfession = professional.professions[0]
  const title = professionTitles.find(t => t.key === firstProfession.profession_title_key)
  return title?.profession_category_key ?? null
}, [professional, professionTitles])
```

**Step 2: Add resolvedServicePrice useMemo**

Add after professionCategoryKey:
```typescript
// Resolve service price (same logic as RPC create_invoice_with_line_item)
const resolvedServicePrice = useMemo(() => {
  if (!service) return null

  // Priority 1: Category-specific price
  if (professionCategoryKey) {
    const categoryPrice = servicePrices.find(
      p => p.serviceId === service.id && p.professionCategoryKey === professionCategoryKey && p.isActive
    )
    if (categoryPrice) {
      const isTaxable = determineIsTaxable(service, professionCategoryKey, professionCategories)
      return { priceCents: categoryPrice.priceCents, isTaxable, missingPrice: false }
    }
  }

  // Priority 2: Global price (profession_category_key = null)
  const globalPrice = servicePrices.find(
    p => p.serviceId === service.id && !p.professionCategoryKey && p.isActive
  )
  if (globalPrice) {
    const isTaxable = professionCategoryKey
      ? determineIsTaxable(service, professionCategoryKey, professionCategories)
      : (service.isTaxableOverride ?? false)
    return { priceCents: globalPrice.priceCents, isTaxable, missingPrice: false }
  }

  // No price found - return 0 with warning flag
  return { priceCents: 0, isTaxable: false, missingPrice: true }
}, [service, professionCategoryKey, servicePrices, professionCategories])
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "feat(facturation): add price resolution logic with category fallback"
```

---

## Task 3: Fix Default Line Items to Use Resolved Price

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:76-117` (defaultLineItems useMemo)

**Step 1: Update cancellation fee block (lines 80-95)**

Replace the cancellation fee block:
```typescript
// For cancelled appointments with fee
if (isCancelled && cancellationFeeApplied && cancellationFeePercent > 0) {
  const originalPrice = resolvedServicePrice?.priceCents ?? 0
  const isTaxable = resolvedServicePrice?.isTaxable ?? false
  const feeCalculation = calculateCancellationFee(originalPrice, cancellationFeePercent, isTaxable)

  return [{
    id: 'cancellation-fee',
    lineType: 'cancellation_fee' as const,
    serviceId: service.id,
    serviceName: `${service.nameFr} - Frais d'annulation (${cancellationFeePercent}%)`,
    serviceKey: null,
    quantityUnit: 'unit' as const,
    quantity: 1,
    billableMinutes: null,
    unitPriceCents: feeCalculation.unitPriceCents,
    isTaxable: feeCalculation.isTaxable,
    displayOrder: 0,
    description: `Frais d'annulation - ${cancellationFeePercent}% du service`,
  }]
}
```

**Step 2: Update normal service block (lines 102-117)**

Update to use resolved price:
```typescript
// For normal appointments - bill full service
return [{
  id: 'service',
  lineType: 'service' as const,
  serviceId: service.id,
  serviceName: service.nameFr,
  serviceKey: null,
  quantityUnit: 'unit' as const,
  quantity: 1,
  billableMinutes: appointment?.durationMinutes ?? service.durationMinutes,
  unitPriceCents: resolvedServicePrice?.priceCents ?? 0,
  isTaxable: resolvedServicePrice?.isTaxable ?? false,
  displayOrder: 0,
  description: null,
}]
```

**Step 3: Add resolvedServicePrice to useMemo dependencies**

Update the dependency array at the end of defaultLineItems useMemo:
```typescript
}, [service, isCancelled, cancellationFeeApplied, cancellationFeePercent, appointment?.durationMinutes, resolvedServicePrice])
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "fix(facturation): use resolved price in default line items"
```

---

## Task 4: Add Missing Price Warning UI

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:266-275` (service info card)

**Step 1: Add warning after service card**

Find the service info Card (around line 266-275) and add warning after it:
```typescript
{/* Service info */}
{service && (
  <Card className="bg-background border-border">
    <CardContent className="p-3 space-y-1">
      <div className="text-sm font-medium">{service.nameFr}</div>
      <div className="text-xs text-foreground-muted">
        {appointment?.durationMinutes || service.durationMinutes} minutes
      </div>
      {/* Price preview */}
      {resolvedServicePrice && (
        <div className="text-xs text-foreground-muted">
          {formatCentsCurrency(resolvedServicePrice.priceCents)}
          {resolvedServicePrice.isTaxable && ' + taxes'}
        </div>
      )}
      {/* Missing price warning */}
      {resolvedServicePrice?.missingPrice && (
        <div className="text-xs text-amber-600">
          ⚠️ Prix non configuré pour cette catégorie
        </div>
      )}
    </CardContent>
  </Card>
)}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "feat(facturation): add missing price warning in billing tab"
```

---

## Task 5: Fix Timezone in Invoice Creation Dialog

**Files:**
- Modify: `src/facturation/components/invoice-creation-dialog.tsx:1-35` (imports)
- Modify: `src/facturation/components/invoice-creation-dialog.tsx:154` (line item date)
- Modify: `src/facturation/components/invoice-creation-dialog.tsx:410` (invoice date)

**Step 1: Add timezone import**

Add after existing imports (around line 31):
```typescript
import { formatClinicDateShort } from '@/shared/lib/timezone'
```

**Step 2: Fix line item date (line 154)**

Replace:
```typescript
{new Date().toLocaleDateString('fr-CA')}
```
With:
```typescript
{formatClinicDateShort(new Date())}
```

**Step 3: Fix invoice date (line 410)**

Replace:
```typescript
{new Date().toLocaleDateString('fr-CA')}
```
With:
```typescript
{formatClinicDateShort(new Date())}
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/facturation/components/invoice-creation-dialog.tsx
git commit -m "fix(facturation): use clinic timezone for dates in creation dialog"
```

---

## Task 6: Fix Timezone in API Payment Date

**Files:**
- Modify: `src/facturation/api.ts:1-40` (imports)
- Modify: `src/facturation/api.ts:572` (payment date)

**Step 1: Add timezone import**

Add after existing imports (around line 37):
```typescript
import { getClinicDateString } from '@/shared/lib/timezone'
```

**Step 2: Fix payment date default (line 572)**

Replace:
```typescript
const paymentDate = input.paymentDate || new Date().toISOString().split('T')[0]
```
With:
```typescript
const paymentDate = input.paymentDate || getClinicDateString(new Date())
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/facturation/api.ts
git commit -m "fix(facturation): use clinic timezone for default payment date"
```

---

## Task 7: Fix canEdit Logic in Invoice Detail View

**Files:**
- Modify: `src/facturation/components/invoice-detail-view.tsx:99-102`

**Step 1: Update canEdit logic (line 99)**

Replace:
```typescript
const canEdit = invoice.status === 'draft'
```
With:
```typescript
const canEdit = !['paid', 'void'].includes(invoice.status)
const showQboWarning = invoice.qboSyncStatus === 'synced'
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/facturation/components/invoice-detail-view.tsx
git commit -m "fix(facturation): allow editing pending/partial invoices"
```

---

## Task 8: Add QuickBooks Warning Banner

**Files:**
- Modify: `src/facturation/components/invoice-detail-view.tsx:132-170` (after header)

**Step 1: Add QBO warning banner after header**

Find the closing `</div>` of the header section (around line 132) and add after it:
```typescript
{/* QuickBooks sync warning */}
{showQboWarning && canEdit && (
  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
    <div className="text-sm font-medium text-amber-800">
      ⚠️ Facture synchronisée avec QuickBooks
    </div>
    <div className="text-xs text-amber-700">
      Les modifications ici ne seront pas automatiquement reflétées dans QuickBooks.
    </div>
  </div>
)}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/facturation/components/invoice-detail-view.tsx
git commit -m "feat(facturation): add QuickBooks sync warning banner"
```

---

## Task 9: Add Parent Billing Option - Imports and Hook

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:1-20` (imports)
- Modify: `src/facturation/components/invoice-billing-tab.tsx:60-65` (hooks)

**Step 1: Add useClientRelations import**

Add with other client imports:
```typescript
import { useClientRelations } from '@/clients/hooks'
```

**Step 2: Add hook call for first client relations**

Add after other hooks (around line 63):
```typescript
// Load relations for first client (to find parents)
const firstClientId = selectedClients[0]?.id
const { data: firstClientRelations } = useClientRelations(firstClientId)
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "feat(facturation): add client relations hook for parent lookup"
```

---

## Task 10: Add Parent Billing Option - Logic and UI

**Files:**
- Modify: `src/facturation/components/invoice-billing-tab.tsx:65-75` (add billingOptions useMemo)
- Modify: `src/facturation/components/invoice-billing-tab.tsx:246-263` (update dropdown)

**Step 1: Add billingOptions useMemo**

Add after firstClientRelations hook:
```typescript
// Build billing options: participants + parents of first client
const billingOptions = useMemo(() => {
  const options = selectedClients.map(c => ({
    id: c.id,
    label: `${c.firstName} ${c.lastName}`,
    isParent: false,
    childName: undefined as string | undefined,
  }))

  // Add parents of first client as billing options
  if (firstClientRelations?.length) {
    for (const rel of firstClientRelations) {
      if (rel.relationType === 'parent' || rel.relationType === 'guardian') {
        if (!options.find(o => o.id === rel.relatedClientId)) {
          options.push({
            id: rel.relatedClientId,
            label: rel.relatedClientName,
            isParent: true,
            childName: selectedClients[0]?.firstName,
          })
        }
      }
    }
  }

  return options
}, [selectedClients, firstClientRelations])
```

**Step 2: Update client selector dropdown (lines 246-263)**

Replace the existing client selector with:
```typescript
{/* Client selector for multi-client or parent available */}
{billingOptions.length > 1 && (
  <div className="space-y-2">
    <label className="text-xs text-foreground-muted">
      Facturer à
    </label>
    <Select
      value={selectedClientId}
      onChange={(e) => setSelectedClientId(e.target.value)}
      placeholder="Sélectionner un client"
    >
      {billingOptions.map(option => (
        <option key={option.id} value={option.id}>
          {option.label}
          {option.isParent && option.childName && ` (parent de ${option.childName})`}
        </option>
      ))}
    </Select>
  </div>
)}
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/facturation/components/invoice-billing-tab.tsx
git commit -m "feat(facturation): add parent as billing option in dropdown"
```

---

## Task 11: Final Verification

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS or only minor warnings

**Step 3: Start dev server and test**

Run: `npm run dev`

Manual tests:
1. Open appointment → Billing tab → verify price shows (not 0)
2. Cancel appointment with 50% fee → verify fee amount correct
3. Check dates show clinic timezone
4. Create invoice → finalize → verify still editable
5. Pay invoice fully → verify NOT editable
6. Test child with parent → verify parent in dropdown

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(facturation): complete billing module bugfixes"
```

---

## Summary

| Task | File | Change |
|------|------|--------|
| 1-4 | invoice-billing-tab.tsx | Price resolution + warning |
| 5 | invoice-creation-dialog.tsx | Timezone fix |
| 6 | api.ts | Payment date timezone |
| 7-8 | invoice-detail-view.tsx | canEdit + QBO warning |
| 9-10 | invoice-billing-tab.tsx | Parent billing option |
| 11 | All | Final verification |
