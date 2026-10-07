# Services offerts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a staff-facing service catalog management page with table view, search, filters, create dialog, edit drawer, and archive/unarchive functionality (Phase 1 = UI only with mock data).

**Architecture:** New `/services` route with mock data isolated in constants. Table-like list view (not card grid). Right drawer for editing with sections: Détails, Paramètres (including variants), Statut. Follow Motifs module patterns for structure.

**Tech Stack:** React + TypeScript, TanStack Router, Tailwind CSS, shadcn/ui (Dialog, Button, Input, Badge), Framer Motion for drawer animations.

---

## Task 1: Create Types & Mock Data

**Files:**
- Create: `src/services-catalog/types.ts`
- Create: `src/services-catalog/constants/mock-services.ts`
- Create: `src/services-catalog/constants/index.ts`
- Create: `src/services-catalog/index.ts`

**Step 1: Create the types file**

```typescript
// src/services-catalog/types.ts

// Service variant (for handling Couple/Médiation/etc without duplicating services)
export interface ServiceVariant {
  id: string
  label: string
  priceOverride?: number  // If null/undefined, uses parent price
  durationOverride?: number  // If null/undefined, uses parent duration
}

// Internal type enum (UI-only categorization)
export type ServiceInternalType =
  | 'ouverture_dossier'
  | 'consultation'
  | 'appel_decouverte'
  | 'annulation_frais'
  | 'autre'

// Main service type
export interface Service {
  id: string
  name: string
  description?: string
  duration: number  // minutes
  price: number  // dollars (allow 0)
  isOnlineAvailable: boolean
  internalType: ServiceInternalType
  variants: ServiceVariant[]
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

// Form data for create/edit (subset of Service)
export interface ServiceFormData {
  name: string
  description: string
  duration: number
  price: number
  isOnlineAvailable: boolean
  internalType: ServiceInternalType
  variants: Omit<ServiceVariant, 'id'>[]
}

// Status filter type
export type ServiceStatusFilter = 'active' | 'archived' | 'all'

// Sort options
export type ServiceSortOption = 'order' | 'name' | 'duration' | 'price'
```

**Step 2: Create the mock data file**

```typescript
// src/services-catalog/constants/mock-services.ts

import type { Service } from '../types'

// Mock services matching GoRendezVous list but with variants instead of duplicates
export const MOCK_SERVICES: Service[] = [
  {
    id: 'srv-001',
    name: 'Ouverture de dossier',
    description: 'Première rencontre pour ouvrir un dossier client.',
    duration: 60,
    price: 43.49,
    isOnlineAvailable: true,
    internalType: 'ouverture_dossier',
    variants: [
      { id: 'var-001-1', label: 'Individuel' },
      { id: 'var-001-2', label: 'Couple' },
      { id: 'var-001-3', label: 'Médiation' },
      { id: 'var-001-4', label: 'Service de consultation' },
    ],
    isActive: true,
    displayOrder: 1,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-002',
    name: 'Consultation individuelle',
    description: 'Séance de suivi individuel avec un professionnel.',
    duration: 50,
    price: 130,
    isOnlineAvailable: true,
    internalType: 'consultation',
    variants: [],
    isActive: true,
    displayOrder: 2,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-003',
    name: 'Consultation de couple',
    description: 'Séance de suivi pour couples.',
    duration: 60,
    price: 150,
    isOnlineAvailable: true,
    internalType: 'consultation',
    variants: [],
    isActive: true,
    displayOrder: 3,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-004',
    name: 'Appel découverte',
    description: 'Appel gratuit de 15 minutes pour évaluer les besoins.',
    duration: 15,
    price: 0,
    isOnlineAvailable: true,
    internalType: 'appel_decouverte',
    variants: [],
    isActive: true,
    displayOrder: 4,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-005',
    name: 'Séance prolongée',
    description: 'Séance de 90 minutes pour situations complexes.',
    duration: 90,
    price: 195,
    isOnlineAvailable: false,
    internalType: 'consultation',
    variants: [],
    isActive: true,
    displayOrder: 5,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-006',
    name: 'Frais d\'annulation',
    description: 'Frais appliqués pour annulation tardive (< 24h).',
    duration: 0,
    price: 80,
    isOnlineAvailable: false,
    internalType: 'annulation_frais',
    variants: [],
    isActive: true,
    displayOrder: 6,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'srv-007',
    name: 'Consultation famille',
    description: 'Séance de thérapie familiale.',
    duration: 75,
    price: 170,
    isOnlineAvailable: false,
    internalType: 'consultation',
    variants: [],
    isActive: false,  // Archived example
    displayOrder: 7,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-06-01T10:00:00Z',
  },
]

// Internal type display labels (i18n keys)
export const INTERNAL_TYPE_LABELS: Record<string, string> = {
  ouverture_dossier: 'pages.services.internalTypes.ouvertureDossier',
  consultation: 'pages.services.internalTypes.consultation',
  appel_decouverte: 'pages.services.internalTypes.appelDecouverte',
  annulation_frais: 'pages.services.internalTypes.annulationFrais',
  autre: 'pages.services.internalTypes.autre',
}
```

**Step 3: Create constants barrel export**

```typescript
// src/services-catalog/constants/index.ts

export * from './mock-services'
```

**Step 4: Create module barrel export**

```typescript
// src/services-catalog/index.ts

export * from './types'
export * from './constants'
```

**Step 5: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors related to services-catalog files

**Step 6: Commit**

```bash
git add src/services-catalog/
git commit -m "feat(services): add types and mock data for service catalog

- Define Service, ServiceVariant, ServiceFormData types
- Add mock services with 'Ouverture de dossier' showing variants pattern
- Include internal type labels for i18n

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add i18n Translations

**Files:**
- Modify: `src/i18n/fr-CA.json`

**Step 1: Add services translations block**

Add the following to `src/i18n/fr-CA.json` inside the `pages` object (after `motifs`):

```json
"services": {
  "page": {
    "title": "Services offerts",
    "subtitle": "Gérez les services de la clinique (durée, tarif, disponibilité interne).",
    "action": "Créer un service",
    "searchPlaceholder": "Rechercher un service...",
    "noResults": "Aucun service ne correspond à votre recherche.",
    "filters": {
      "active": "Actifs",
      "archived": "Archivés",
      "all": "Tous"
    },
    "sort": {
      "order": "Ordre",
      "name": "Nom (A–Z)",
      "duration": "Durée",
      "price": "Tarif"
    }
  },
  "disclaimer": {
    "message": "Ces services servent à structurer l'offre de la clinique. Ils ne gèrent pas les rendez-vous."
  },
  "table": {
    "name": "Nom",
    "duration": "Durée",
    "price": "Tarif",
    "mode": "Mode",
    "online": "En ligne",
    "status": "Statut",
    "actions": "Actions"
  },
  "values": {
    "minutes": "min",
    "onlineYes": "Oui",
    "onlineNo": "Non",
    "active": "Actif",
    "archived": "Archivé",
    "modeAppointment": "Sur rendez-vous",
    "variantsCount": "variante(s)"
  },
  "actions": {
    "edit": "Modifier",
    "archive": "Archiver",
    "restore": "Restaurer",
    "duplicate": "Dupliquer"
  },
  "archive": {
    "title": "Archiver ce service?",
    "description": "Il ne sera plus proposé aux clients, mais restera dans l'historique.",
    "cancel": "Annuler",
    "confirm": "Archiver"
  },
  "restore": {
    "success": "Service restauré"
  },
  "create": {
    "title": "Créer un service",
    "subtitle": "Ce service sera disponible pour la prise de rendez-vous.",
    "tabs": {
      "details": "Détails",
      "parameters": "Paramètres",
      "status": "Statut"
    },
    "fields": {
      "name": "Nom du service",
      "namePlaceholder": "Ex: Consultation individuelle",
      "nameHelper": "Nom affiché aux clients et dans les rapports.",
      "description": "Description interne",
      "descriptionPlaceholder": "Notes internes sur ce service...",
      "descriptionHelper": "Visible uniquement par l'équipe.",
      "duration": "Durée (minutes)",
      "durationPlaceholder": "50",
      "price": "Tarif ($)",
      "pricePlaceholder": "130",
      "priceHelper": "0 $ pour les services gratuits.",
      "isOnlineAvailable": "Disponible en ligne",
      "isOnlineAvailableHelper": "Permet la réservation en ligne par les clients.",
      "internalType": "Type interne",
      "internalTypeHelper": "Catégorisation pour les rapports et le triage."
    },
    "variants": {
      "title": "Variantes (optionnel)",
      "subtitle": "Ajoutez des variantes si ce service a plusieurs déclinaisons (ex: Couple, Famille).",
      "add": "Ajouter une variante",
      "label": "Libellé",
      "labelPlaceholder": "Ex: Couple",
      "priceOverride": "Tarif",
      "durationOverride": "Durée",
      "remove": "Retirer",
      "inheritPrice": "Même tarif",
      "inheritDuration": "Même durée"
    },
    "cancel": "Annuler",
    "submit": "Créer le service",
    "success": "Service créé"
  },
  "edit": {
    "title": "Modifier le service",
    "submit": "Enregistrer",
    "success": "Modifications enregistrées"
  },
  "internalTypes": {
    "ouvertureDossier": "Ouverture de dossier",
    "consultation": "Consultation",
    "appelDecouverte": "Appel découverte",
    "annulationFrais": "Annulation / frais",
    "autre": "Autre"
  },
  "empty": {
    "title": "Aucun service défini",
    "description": "Les services permettent de structurer l'offre de la clinique."
  },
  "errors": {
    "archiveFailed": "Impossible d'archiver ce service.",
    "restoreFailed": "Impossible de restaurer ce service.",
    "createFailed": "Impossible de créer ce service.",
    "editFailed": "Impossible de modifier ce service."
  },
  "validation": {
    "nameRequired": "Le nom est requis.",
    "durationRequired": "La durée est requise.",
    "durationMin": "La durée doit être positive.",
    "priceRequired": "Le tarif est requis.",
    "priceMin": "Le tarif ne peut être négatif."
  }
}
```

**Step 2: Add nav.services**

In the `nav` object, add:

```json
"services": "Services"
```

**Step 3: Verify i18n file is valid JSON**

Run: `cat src/i18n/fr-CA.json | jq . > /dev/null && echo "Valid JSON"`
Expected: "Valid JSON"

**Step 4: Commit**

```bash
git add src/i18n/fr-CA.json
git commit -m "feat(services): add FR-CA translations for service catalog

- Page labels, filters, table columns
- Create/edit form fields and validation messages
- Archive dialog copy
- Internal type labels

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Service Disclaimer Banner Component

**Files:**
- Create: `src/services-catalog/components/service-disclaimer-banner.tsx`
- Create: `src/services-catalog/components/index.ts`

**Step 1: Create the banner component**

```typescript
// src/services-catalog/components/service-disclaimer-banner.tsx

import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

interface ServiceDisclaimerBannerProps {
  className?: string
}

export function ServiceDisclaimerBanner({ className }: ServiceDisclaimerBannerProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-sage-200/60 bg-sage-50/50 p-4',
        className
      )}
    >
      <Info className="h-5 w-5 shrink-0 text-sage-600 mt-0.5" />
      <p className="text-sm text-sage-700">
        {t('pages.services.disclaimer.message')}
      </p>
    </div>
  )
}
```

**Step 2: Create components barrel export**

```typescript
// src/services-catalog/components/index.ts

export * from './service-disclaimer-banner'
```

**Step 3: Update module barrel export**

```typescript
// src/services-catalog/index.ts

export * from './types'
export * from './constants'
export * from './components'
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/services-catalog/
git commit -m "feat(services): add disclaimer banner component

- Info banner explaining services don't manage appointments
- Follows MANA sage color scheme

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Archive Service Dialog Component

**Files:**
- Create: `src/services-catalog/components/archive-service-dialog.tsx`
- Modify: `src/services-catalog/components/index.ts`

**Step 1: Create the archive dialog component**

```typescript
// src/services-catalog/components/archive-service-dialog.tsx

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ArchiveServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serviceName: string
  onConfirm: () => Promise<{ success: boolean; error?: Error }>
  onSuccess?: () => void
}

export function ArchiveServiceDialog({
  open,
  onOpenChange,
  serviceName,
  onConfirm,
  onSuccess,
}: ArchiveServiceDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    setIsLoading(true)
    const result = await onConfirm()
    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      onSuccess?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pages.services.archive.title')}</DialogTitle>
          <DialogDescription className="pt-2">
            <span className="font-medium text-foreground">{serviceName}</span>
            <br />
            <span className="mt-2 block">
              {t('pages.services.archive.description')}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t('pages.services.archive.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('pages.services.archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Update components barrel export**

Add to `src/services-catalog/components/index.ts`:

```typescript
export * from './archive-service-dialog'
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services-catalog/components/
git commit -m "feat(services): add archive confirmation dialog

- Non-punitive tone matching MANA style
- Loading state on confirm button
- Follows ArchiveMotifDialog pattern

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create Service Table Row Component

**Files:**
- Create: `src/services-catalog/components/service-table-row.tsx`
- Modify: `src/services-catalog/components/index.ts`

**Step 1: Create the table row component**

```typescript
// src/services-catalog/components/service-table-row.tsx

import { MoreHorizontal, Pencil, Archive, RotateCcw, Copy } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { Service } from '../types'

interface ServiceTableRowProps {
  service: Service
  onEdit: (service: Service) => void
  onArchive: (service: Service) => void
  onRestore: (service: Service) => void
  onDuplicate?: (service: Service) => void
}

export function ServiceTableRow({
  service,
  onEdit,
  onArchive,
  onRestore,
  onDuplicate,
}: ServiceTableRowProps) {
  const formatPrice = (price: number) => {
    if (price === 0) return '0 $'
    return `${price.toFixed(2).replace('.00', '')} $`
  }

  const formatDuration = (minutes: number) => {
    if (minutes === 0) return '—'
    return `${minutes} ${t('pages.services.values.minutes')}`
  }

  return (
    <tr
      className={cn(
        'border-b border-border last:border-b-0 transition-colors',
        service.isActive
          ? 'hover:bg-sage-50/30'
          : 'bg-background-secondary/50 opacity-75'
      )}
    >
      {/* Name + variants count */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{service.name}</span>
          {service.variants.length > 0 && (
            <span className="text-xs text-foreground-muted">
              {service.variants.length} {t('pages.services.values.variantsCount')}
            </span>
          )}
        </div>
      </td>

      {/* Duration */}
      <td className="px-4 py-3 text-sm text-foreground-secondary">
        {formatDuration(service.duration)}
      </td>

      {/* Price */}
      <td className="px-4 py-3 text-sm text-foreground-secondary">
        {formatPrice(service.price)}
      </td>

      {/* Mode */}
      <td className="px-4 py-3 text-sm text-foreground-muted">
        {t('pages.services.values.modeAppointment')}
      </td>

      {/* Online availability */}
      <td className="px-4 py-3">
        <Badge
          variant={service.isOnlineAvailable ? 'default' : 'secondary'}
          className="text-xs"
        >
          {service.isOnlineAvailable
            ? t('pages.services.values.onlineYes')
            : t('pages.services.values.onlineNo')}
        </Badge>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <Badge
          variant={service.isActive ? 'success' : 'secondary'}
          className="text-xs"
        >
          {service.isActive
            ? t('pages.services.values.active')
            : t('pages.services.values.archived')}
        </Badge>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onEdit(service)}>
              <Pencil className="h-4 w-4 mr-2" />
              {t('pages.services.actions.edit')}
            </DropdownMenuItem>

            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(service)}>
                <Copy className="h-4 w-4 mr-2" />
                {t('pages.services.actions.duplicate')}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {service.isActive ? (
              <DropdownMenuItem
                onClick={() => onArchive(service)}
                className="text-wine-600 focus:text-wine-600"
              >
                <Archive className="h-4 w-4 mr-2" />
                {t('pages.services.actions.archive')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => onRestore(service)}
                className="text-sage-600 focus:text-sage-600"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('pages.services.actions.restore')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}
```

**Step 2: Update components barrel export**

Add to `src/services-catalog/components/index.ts`:

```typescript
export * from './service-table-row'
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services-catalog/components/
git commit -m "feat(services): add service table row component

- Display name, duration, price, mode, online status, status
- Show variants count below name
- Dropdown menu with edit/archive/restore/duplicate actions
- Calm styling with sage hover states

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Service Editor Drawer Component

**Files:**
- Create: `src/services-catalog/components/service-editor-drawer.tsx`
- Modify: `src/services-catalog/components/index.ts`

**Step 1: Create the editor drawer component**

```typescript
// src/services-catalog/components/service-editor-drawer.tsx

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  Dialog,
  DialogContent,
} from '@/shared/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import type { Service, ServiceFormData, ServiceInternalType, ServiceVariant } from '../types'
import { INTERNAL_TYPE_LABELS } from '../constants'

interface ServiceEditorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null  // null = create mode
  onSubmit: (data: ServiceFormData) => Promise<{ success: boolean; error?: Error }>
  onSuccess?: () => void
}

const INTERNAL_TYPES: ServiceInternalType[] = [
  'ouverture_dossier',
  'consultation',
  'appel_decouverte',
  'annulation_frais',
  'autre',
]

interface FormErrors {
  name?: string
  duration?: string
  price?: string
}

export function ServiceEditorDrawer({
  open,
  onOpenChange,
  service,
  onSubmit,
  onSuccess,
}: ServiceEditorDrawerProps) {
  const isEditMode = !!service

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [price, setPrice] = useState('')
  const [isOnlineAvailable, setIsOnlineAvailable] = useState(false)
  const [internalType, setInternalType] = useState<ServiceInternalType>('consultation')
  const [variants, setVariants] = useState<Omit<ServiceVariant, 'id'>[]>([])

  // UI state
  const [variantsExpanded, setVariantsExpanded] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'parameters' | 'status'>('details')

  // Initialize form when service changes
  useEffect(() => {
    if (service) {
      setName(service.name)
      setDescription(service.description || '')
      setDuration(service.duration.toString())
      setPrice(service.price.toString())
      setIsOnlineAvailable(service.isOnlineAvailable)
      setInternalType(service.internalType)
      setVariants(service.variants.map(v => ({
        label: v.label,
        priceOverride: v.priceOverride,
        durationOverride: v.durationOverride,
      })))
      setVariantsExpanded(service.variants.length > 0)
    } else {
      resetForm()
    }
  }, [service, open])

  const resetForm = () => {
    setName('')
    setDescription('')
    setDuration('')
    setPrice('')
    setIsOnlineAvailable(false)
    setInternalType('consultation')
    setVariants([])
    setVariantsExpanded(false)
    setErrors({})
    setActiveTab('details')
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!name.trim()) {
      newErrors.name = t('pages.services.validation.nameRequired')
    }

    const durationNum = parseInt(duration, 10)
    if (isNaN(durationNum)) {
      newErrors.duration = t('pages.services.validation.durationRequired')
    } else if (durationNum < 0) {
      newErrors.duration = t('pages.services.validation.durationMin')
    }

    const priceNum = parseFloat(price)
    if (isNaN(priceNum)) {
      newErrors.price = t('pages.services.validation.priceRequired')
    } else if (priceNum < 0) {
      newErrors.price = t('pages.services.validation.priceMin')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsLoading(true)

    const formData: ServiceFormData = {
      name: name.trim(),
      description: description.trim(),
      duration: parseInt(duration, 10),
      price: parseFloat(price),
      isOnlineAvailable,
      internalType,
      variants: variants.filter(v => v.label.trim()),
    }

    const result = await onSubmit(formData)
    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      resetForm()
      onSuccess?.()
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    resetForm()
  }

  const addVariant = () => {
    setVariants([...variants, { label: '' }])
  }

  const updateVariant = (index: number, updates: Partial<Omit<ServiceVariant, 'id'>>) => {
    const newVariants = [...variants]
    newVariants[index] = { ...newVariants[index], ...updates }
    setVariants(newVariants)
  }

  const removeVariant = (index: number) => {
    setVariants(variants.filter((_, i) => i !== index))
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="fixed right-0 top-0 h-full max-h-full w-full max-w-lg translate-x-0 translate-y-0 rounded-none rounded-l-2xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-300"
        style={{
          left: 'auto',
          top: 0,
          transform: 'none',
        }}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('pages.services.edit.title') : t('pages.services.create.title')}
              </h2>
              {!isEditMode && (
                <p className="text-sm text-foreground-muted mt-0.5">
                  {t('pages.services.create.subtitle')}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border px-6">
            {(['details', 'parameters', 'status'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-sage-500 text-sage-700'
                    : 'border-transparent text-foreground-muted hover:text-foreground'
                )}
              >
                {t(`pages.services.create.tabs.${tab}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <AnimatePresence mode="wait">
              {activeTab === 'details' && (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  {/* Name */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t('pages.services.create.fields.name')}
                      <span className="text-wine-500 ml-0.5">*</span>
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('pages.services.create.fields.namePlaceholder')}
                      className={cn(errors.name && 'border-wine-300')}
                    />
                    {errors.name ? (
                      <p className="text-xs text-wine-600">{errors.name}</p>
                    ) : (
                      <p className="text-xs text-foreground-muted">
                        {t('pages.services.create.fields.nameHelper')}
                      </p>
                    )}
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t('pages.services.create.fields.description')}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('pages.services.create.fields.descriptionPlaceholder')}
                      rows={3}
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-foreground-muted focus:border-sage-300 focus:outline-none focus:ring-2 focus:ring-sage-500/20"
                    />
                    <p className="text-xs text-foreground-muted">
                      {t('pages.services.create.fields.descriptionHelper')}
                    </p>
                  </div>
                </motion.div>
              )}

              {activeTab === 'parameters' && (
                <motion.div
                  key="parameters"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  {/* Duration & Price row */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Duration */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.duration')}
                        <span className="text-wine-500 ml-0.5">*</span>
                      </label>
                      <Input
                        type="number"
                        min="0"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder={t('pages.services.create.fields.durationPlaceholder')}
                        className={cn(errors.duration && 'border-wine-300')}
                      />
                      {errors.duration && (
                        <p className="text-xs text-wine-600">{errors.duration}</p>
                      )}
                    </div>

                    {/* Price */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.price')}
                        <span className="text-wine-500 ml-0.5">*</span>
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={t('pages.services.create.fields.pricePlaceholder')}
                        className={cn(errors.price && 'border-wine-300')}
                      />
                      {errors.price ? (
                        <p className="text-xs text-wine-600">{errors.price}</p>
                      ) : (
                        <p className="text-xs text-foreground-muted">
                          {t('pages.services.create.fields.priceHelper')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Online availability */}
                  <div className="flex items-center justify-between rounded-xl border border-border p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.isOnlineAvailable')}
                      </p>
                      <p className="text-xs text-foreground-muted mt-0.5">
                        {t('pages.services.create.fields.isOnlineAvailableHelper')}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOnlineAvailable}
                      onClick={() => setIsOnlineAvailable(!isOnlineAvailable)}
                      className={cn(
                        'relative h-6 w-11 rounded-full transition-colors',
                        isOnlineAvailable ? 'bg-sage-500' : 'bg-background-tertiary'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          isOnlineAvailable && 'translate-x-5'
                        )}
                      />
                    </button>
                  </div>

                  {/* Internal type */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t('pages.services.create.fields.internalType')}
                    </label>
                    <Select
                      value={internalType}
                      onValueChange={(v) => setInternalType(v as ServiceInternalType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INTERNAL_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(INTERNAL_TYPE_LABELS[type] as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-foreground-muted">
                      {t('pages.services.create.fields.internalTypeHelper')}
                    </p>
                  </div>

                  {/* Variants section */}
                  <div className="rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setVariantsExpanded(!variantsExpanded)}
                      className="flex w-full items-center justify-between p-4 hover:bg-background-secondary/50 transition-colors"
                    >
                      <div className="text-left">
                        <p className="text-sm font-medium text-foreground">
                          {t('pages.services.create.variants.title')}
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {t('pages.services.create.variants.subtitle')}
                        </p>
                      </div>
                      {variantsExpanded ? (
                        <ChevronUp className="h-5 w-5 text-foreground-muted" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-foreground-muted" />
                      )}
                    </button>

                    <AnimatePresence>
                      {variantsExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-border"
                        >
                          <div className="p-4 space-y-3">
                            {variants.map((variant, index) => (
                              <div
                                key={index}
                                className="flex items-start gap-2 rounded-lg border border-border-light bg-background-secondary/30 p-3"
                              >
                                <div className="flex-1 space-y-2">
                                  <Input
                                    value={variant.label}
                                    onChange={(e) => updateVariant(index, { label: e.target.value })}
                                    placeholder={t('pages.services.create.variants.labelPlaceholder')}
                                    className="h-9"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={variant.priceOverride ?? ''}
                                      onChange={(e) => updateVariant(index, {
                                        priceOverride: e.target.value ? parseFloat(e.target.value) : undefined,
                                      })}
                                      placeholder={t('pages.services.create.variants.inheritPrice')}
                                      className="h-9"
                                    />
                                    <Input
                                      type="number"
                                      min="0"
                                      value={variant.durationOverride ?? ''}
                                      onChange={(e) => updateVariant(index, {
                                        durationOverride: e.target.value ? parseInt(e.target.value, 10) : undefined,
                                      })}
                                      placeholder={t('pages.services.create.variants.inheritDuration')}
                                      className="h-9"
                                    />
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-foreground-muted hover:text-wine-600"
                                  onClick={() => removeVariant(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={addVariant}
                              className="w-full"
                            >
                              <Plus className="h-4 w-4 mr-1.5" />
                              {t('pages.services.create.variants.add')}
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {activeTab === 'status' && (
                <motion.div
                  key="status"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t('pages.services.table.status')}
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {isEditMode && service
                            ? service.isActive
                              ? 'Ce service est actuellement actif et visible.'
                              : 'Ce service est archivé et non visible.'
                            : 'Le service sera créé comme actif.'}
                        </p>
                      </div>
                      <Badge variant={(!isEditMode || service?.isActive) ? 'success' : 'secondary'}>
                        {(!isEditMode || service?.isActive)
                          ? t('pages.services.values.active')
                          : t('pages.services.values.archived')}
                      </Badge>
                    </div>
                  </div>

                  {isEditMode && service && (
                    <p className="text-xs text-foreground-muted text-center">
                      Pour archiver ou restaurer ce service, utilisez le menu d'actions dans la liste.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" className="flex-1" onClick={handleClose}>
              {t('pages.services.create.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditMode ? t('pages.services.edit.submit') : t('pages.services.create.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Update components barrel export**

Add to `src/services-catalog/components/index.ts`:

```typescript
export * from './service-editor-drawer'
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services-catalog/components/
git commit -m "feat(services): add service editor drawer component

- Right-side drawer with tabs: Détails, Paramètres, Statut
- Collapsible variants section with add/remove
- Form validation for required fields
- Supports create and edit modes
- Smooth animations with Framer Motion

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create Services Page

**Files:**
- Create: `src/pages/services.tsx`
- Modify: `src/pages/index.ts`

**Step 1: Create the services page**

```typescript
// src/pages/services.tsx

import { useState, useMemo, useCallback } from 'react'
import { Plus, Search, ArrowUpDown } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  MOCK_SERVICES,
  ServiceDisclaimerBanner,
  ServiceTableRow,
  ServiceEditorDrawer,
  ArchiveServiceDialog,
  type Service,
  type ServiceFormData,
  type ServiceStatusFilter,
  type ServiceSortOption,
} from '@/services-catalog'

export function ServicesPage() {
  // Filter & sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ServiceStatusFilter>('active')
  const [sortOption, setSortOption] = useState<ServiceSortOption>('order')

  // Mock services state (in Phase 2, this becomes DB-backed)
  const [services, setServices] = useState<Service[]>(MOCK_SERVICES)

  // Editor drawer state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [serviceToArchive, setServiceToArchive] = useState<Service | null>(null)

  // Filter by status
  const statusFilteredServices = useMemo(() => {
    switch (statusFilter) {
      case 'active':
        return services.filter((s) => s.isActive)
      case 'archived':
        return services.filter((s) => !s.isActive)
      case 'all':
      default:
        return services
    }
  }, [services, statusFilter])

  // Filter by search
  const searchFilteredServices = useMemo(() => {
    if (!searchQuery.trim()) return statusFilteredServices

    const query = searchQuery.toLowerCase().trim()
    return statusFilteredServices.filter((service) =>
      service.name.toLowerCase().includes(query) ||
      service.description?.toLowerCase().includes(query)
    )
  }, [statusFilteredServices, searchQuery])

  // Sort services
  const sortedServices = useMemo(() => {
    const sorted = [...searchFilteredServices]
    switch (sortOption) {
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'))
      case 'duration':
        return sorted.sort((a, b) => a.duration - b.duration)
      case 'price':
        return sorted.sort((a, b) => a.price - b.price)
      case 'order':
      default:
        return sorted.sort((a, b) => a.displayOrder - b.displayOrder)
    }
  }, [searchFilteredServices, sortOption])

  // Counts for filter badges
  const activeCount = useMemo(() => services.filter((s) => s.isActive).length, [services])
  const archivedCount = useMemo(() => services.filter((s) => !s.isActive).length, [services])

  const hasServices = services.length > 0
  const hasResults = sortedServices.length > 0

  // Handle create
  const handleCreate = useCallback(() => {
    setEditingService(null)
    setEditorOpen(true)
  }, [])

  // Handle edit
  const handleEdit = useCallback((service: Service) => {
    setEditingService(service)
    setEditorOpen(true)
  }, [])

  // Handle archive click
  const handleArchiveClick = useCallback((service: Service) => {
    setServiceToArchive(service)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirm (mock)
  const handleArchiveConfirm = useCallback(async () => {
    if (!serviceToArchive) return { success: false }

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceToArchive.id ? { ...s, isActive: false } : s
      )
    )

    return { success: true }
  }, [serviceToArchive])

  // Handle archive success
  const handleArchiveSuccess = useCallback(() => {
    toast({ title: 'Service archivé' })
    setServiceToArchive(null)
  }, [])

  // Handle restore (no confirmation)
  const handleRestore = useCallback(async (service: Service) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 300))

    setServices((prev) =>
      prev.map((s) =>
        s.id === service.id ? { ...s, isActive: true } : s
      )
    )

    toast({ title: t('pages.services.restore.success') })
  }, [])

  // Handle duplicate
  const handleDuplicate = useCallback((service: Service) => {
    const newService: Service = {
      ...service,
      id: `srv-${Date.now()}`,
      name: `${service.name} (copie)`,
      displayOrder: services.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setServices((prev) => [...prev, newService])
    toast({ title: 'Service dupliqué' })
  }, [services.length])

  // Handle form submit (create/edit)
  const handleFormSubmit = useCallback(async (data: ServiceFormData) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (editingService) {
      // Update existing
      setServices((prev) =>
        prev.map((s) =>
          s.id === editingService.id
            ? {
                ...s,
                ...data,
                variants: data.variants.map((v, i) => ({
                  ...v,
                  id: `var-${editingService.id}-${i}`,
                })),
                updatedAt: new Date().toISOString(),
              }
            : s
        )
      )
    } else {
      // Create new
      const newService: Service = {
        id: `srv-${Date.now()}`,
        ...data,
        variants: data.variants.map((v, i) => ({
          ...v,
          id: `var-new-${i}`,
        })),
        isActive: true,
        displayOrder: services.length + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setServices((prev) => [...prev, newService])
    }

    return { success: true }
  }, [editingService, services.length])

  // Handle form success
  const handleFormSuccess = useCallback(() => {
    toast({
      title: editingService
        ? t('pages.services.edit.success')
        : t('pages.services.create.success'),
    })
    setEditingService(null)
  }, [editingService])

  return (
    <div className="space-y-6">
      {/* Header with action */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.services.page.title')}
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            {t('pages.services.page.subtitle')}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4" />
          {t('pages.services.page.action')}
        </Button>
      </div>

      {/* Disclaimer banner */}
      <ServiceDisclaimerBanner />

      {/* Filters row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter (segmented control) */}
        <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'active'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.services.page.filters.active')}
            <span className="text-[10px] text-foreground-muted">({activeCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'archived'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.services.page.filters.archived')}
            <span className="text-[10px] text-foreground-muted">({archivedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.services.page.filters.all')}
          </button>
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-foreground-muted" />
          <Select value={sortOption} onValueChange={(v) => setSortOption(v as ServiceSortOption)}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">{t('pages.services.page.sort.order')}</SelectItem>
              <SelectItem value="name">{t('pages.services.page.sort.name')}</SelectItem>
              <SelectItem value="duration">{t('pages.services.page.sort.duration')}</SelectItem>
              <SelectItem value="price">{t('pages.services.page.sort.price')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('pages.services.page.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {/* Content */}
      {!hasServices ? (
        // Empty state - no services defined at all
        <EmptyState
          title={t('pages.services.empty.title')}
          description={t('pages.services.empty.description')}
          action={
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              {t('pages.services.page.action')}
            </Button>
          }
        />
      ) : !hasResults ? (
        // No search/filter results
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-foreground-muted">
            {searchQuery.trim()
              ? t('pages.services.page.noResults')
              : statusFilter === 'archived'
                ? 'Aucun service archivé'
                : 'Aucun service actif'}
          </p>
          {searchQuery.trim() && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="mt-2 text-sage-600"
            >
              Effacer la recherche
            </Button>
          )}
        </div>
      ) : (
        // Table view
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-background-secondary/50">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.duration')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.price')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.mode')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.online')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.status')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedServices.map((service) => (
                <ServiceTableRow
                  key={service.id}
                  service={service}
                  onEdit={handleEdit}
                  onArchive={handleArchiveClick}
                  onRestore={handleRestore}
                  onDuplicate={handleDuplicate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Service count footer */}
      {hasResults && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-foreground-muted text-center">
            {sortedServices.length === statusFilteredServices.length
              ? `${statusFilteredServices.length} services ${statusFilter === 'archived' ? 'archivés' : statusFilter === 'active' ? 'actifs' : 'au total'}`
              : `${sortedServices.length} sur ${statusFilteredServices.length} services`}
          </p>
        </div>
      )}

      {/* Archive confirmation dialog */}
      {serviceToArchive && (
        <ArchiveServiceDialog
          open={archiveDialogOpen}
          onOpenChange={setArchiveDialogOpen}
          serviceName={serviceToArchive.name}
          onConfirm={handleArchiveConfirm}
          onSuccess={handleArchiveSuccess}
        />
      )}

      {/* Service editor drawer */}
      <ServiceEditorDrawer
        open={editorOpen}
        onOpenChange={setEditorOpen}
        service={editingService}
        onSubmit={handleFormSubmit}
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}
```

**Step 2: Update pages barrel export**

Add to `src/pages/index.ts`:

```typescript
export * from './services'
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/pages/services.tsx src/pages/index.ts
git commit -m "feat(services): add services page with table view

- Table-like list with all columns
- Search, status filter (segmented), sort dropdown
- Create/edit drawer integration
- Archive/restore/duplicate actions
- Mock data state management
- Empty states for no services and no results

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Wire Up Router & Navigation

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/shared/components/sidebar.tsx`

**Step 1: Add services route**

In `src/app/router.tsx`, add the import:

```typescript
import { ServicesPage } from '@/pages/services'
```

Add the route definition (after `motifsRoute`):

```typescript
// Services
const servicesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/services',
  component: ServicesPage,
})
```

Add to the route tree (after `motifsRoute`):

```typescript
const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  protectedLayoutRoute.addChildren([
    indexRoute,
    dashboardRoute,
    professionalsRoute,
    professionalDetailRoute,
    availabilityRoute,
    motifsRoute,
    servicesRoute,  // ADD THIS
    clientsRoute,
    clientDetailRoute,
    requestsRoute,
    requestDetailRoute,
    requestAnalysisRoute,
    reportsRoute,
    settingsRoute,
  ]),
])
```

**Step 2: Add sidebar navigation item**

In `src/shared/components/sidebar.tsx`, add the Briefcase icon import:

```typescript
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  UserCircle,
  Inbox,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Briefcase,  // ADD THIS
} from 'lucide-react'
```

Update the `navItems` array (add after motifs):

```typescript
const navItems = [
  { path: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/demandes', label: 'nav.requests', icon: Inbox },
  { path: '/clients', label: 'nav.clients', icon: UserCircle },
  { path: '/professionnels', label: 'nav.professionals', icon: Users },
  { path: '/disponibilites', label: 'nav.availability', icon: Calendar },
  { path: '/motifs', label: 'nav.reasons', icon: FileText },
  { path: '/services', label: 'nav.services', icon: Briefcase },  // ADD THIS
  { path: '/rapports', label: 'nav.reports', icon: BarChart3 },
  { path: '/parametres', label: 'nav.settings', icon: Settings },
] as const
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Test navigation works**

Run: `npm run dev`
Expected: Navigate to /services, see the services page

**Step 5: Commit**

```bash
git add src/app/router.tsx src/shared/components/sidebar.tsx
git commit -m "feat(services): wire up /services route and navigation

- Add servicesRoute to router
- Add Services nav item with Briefcase icon (after Motifs)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Final Verification & Cleanup

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 3: Test all functionality manually**

1. Navigate to /services
2. Verify table displays mock data
3. Test search (instant filter)
4. Test status filter (Actifs/Archivés/Tous with counts)
5. Test sort dropdown
6. Click "+ Créer un service" → drawer opens
7. Fill form, test validation
8. Add/remove variants
9. Submit → service appears in list
10. Click kebab menu → Modifier → edit drawer opens
11. Archive a service → confirm dialog → status changes
12. Restore an archived service (no confirm)
13. Duplicate a service

**Step 4: Verify i18n displays correctly**

Check all labels are in French-Canadian, no missing translation keys.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(services): complete Phase 1 Services offerts module

Summary of changes:
- New module: src/services-catalog/ with types, mock data, components
- New page: /services with table view, search, filters, sort
- Service editor drawer with tabs and variants support
- Archive/restore dialogs
- FR-CA translations
- Navigation: Services item after Motifs

Files created:
- src/services-catalog/types.ts
- src/services-catalog/constants/mock-services.ts
- src/services-catalog/constants/index.ts
- src/services-catalog/components/service-disclaimer-banner.tsx
- src/services-catalog/components/archive-service-dialog.tsx
- src/services-catalog/components/service-table-row.tsx
- src/services-catalog/components/service-editor-drawer.tsx
- src/services-catalog/components/index.ts
- src/services-catalog/index.ts
- src/pages/services.tsx

Files modified:
- src/pages/index.ts
- src/app/router.tsx
- src/shared/components/sidebar.tsx
- src/i18n/fr-CA.json

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

**Files created (11):**
- `src/services-catalog/types.ts`
- `src/services-catalog/constants/mock-services.ts`
- `src/services-catalog/constants/index.ts`
- `src/services-catalog/components/service-disclaimer-banner.tsx`
- `src/services-catalog/components/archive-service-dialog.tsx`
- `src/services-catalog/components/service-table-row.tsx`
- `src/services-catalog/components/service-editor-drawer.tsx`
- `src/services-catalog/components/index.ts`
- `src/services-catalog/index.ts`
- `src/pages/services.tsx`
- `docs/plans/2026-01-19-services-offerts.md`

**Files modified (4):**
- `src/pages/index.ts`
- `src/app/router.tsx`
- `src/shared/components/sidebar.tsx`
- `src/i18n/fr-CA.json`

**Key design decisions:**
1. Module named `services-catalog` to avoid conflict with potential `services/` folder for API services
2. Mock data isolated in constants for easy DB swap in Phase 2
3. Table view (not card grid) as specified
4. Right drawer for editing with 3 tabs
5. Variants support with collapsible section
6. Follows existing Motifs patterns for consistency

---

## Task 10: Create Services Database Schema Migration

**Files:**
- Create: `supabase/migrations/20260119000005_services_schema.sql`

**Step 1: Create the schema migration file**

```sql
-- Migration: services_schema
-- Module: services-catalog
-- Created: 2026-01-19
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)

-- =============================================================================
-- SERVICES TABLE (Core catalog)
-- =============================================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                          -- snake_case identifier
  name text not null,                                -- FR-CA display name
  description_internal text,                         -- Internal notes (staff only)
  default_duration_minutes int not null default 50,
  default_price_cents int not null default 0,        -- Store money in cents
  currency text not null default 'CAD',
  is_active boolean not null default true,           -- Soft delete
  is_bookable_online boolean not null default false, -- Available for online booking
  calendar_color text,                               -- Hex color for calendar view (e.g. '#7FAE9D')
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index services_is_active_idx on public.services(is_active);
create index services_sort_order_idx on public.services(sort_order);
create index services_is_bookable_online_idx on public.services(is_bookable_online);

-- Comments
comment on table public.services is 'Service catalog for the clinic (intake, billing, triage)';
comment on column public.services.key is 'Unique snake_case identifier for the service';
comment on column public.services.default_price_cents is 'Price in cents (e.g. 13000 = $130.00)';
comment on column public.services.calendar_color is 'Hex color for calendar display (e.g. #7FAE9D)';

-- =============================================================================
-- SERVICE_VARIANTS TABLE
-- Avoid duplicating services like "Ouverture de dossier – Couple / Médiation"
-- =============================================================================

create table if not exists public.service_variants (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  key text not null,                                  -- snake_case, unique per service
  label text not null,                               -- FR-CA display label
  duration_minutes_override int,                     -- NULL = use parent duration
  price_cents_override int,                          -- NULL = use parent price
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique key per service
  unique(service_id, key)
);

-- Indexes
create index service_variants_service_id_idx on public.service_variants(service_id);
create index service_variants_is_active_idx on public.service_variants(is_active);

-- Comments
comment on table public.service_variants is 'Variants of a service (e.g. Couple, Médiation for Ouverture de dossier)';
comment on column public.service_variants.duration_minutes_override is 'Override duration, NULL uses parent service duration';
comment on column public.service_variants.price_cents_override is 'Override price in cents, NULL uses parent service price';

-- =============================================================================
-- TAX_RATES TABLE
-- Support TPS/TVQ and future regions
-- =============================================================================

create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                          -- e.g. 'qc_gst', 'qc_qst'
  label text not null,                               -- e.g. 'TPS', 'TVQ'
  rate_bps int not null,                             -- Basis points: 500 = 5.00%, 9975 = 9.975%
  region text,                                       -- e.g. 'QC', 'ON', NULL for federal
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comments
comment on table public.tax_rates is 'Tax rates for invoicing (TPS, TVQ, etc.)';
comment on column public.tax_rates.rate_bps is 'Rate in basis points: 500 = 5.00%, 9975 = 9.975%';

-- =============================================================================
-- SERVICE_TAX_RULES TABLE
-- Define which taxes apply to which services
-- =============================================================================

create table if not exists public.service_tax_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  tax_rate_id uuid references public.tax_rates(id) on delete cascade,  -- NULL = tax exempt rule
  applies boolean not null default true,             -- false = explicitly exempt
  priority int not null default 0,                   -- Order of application
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Prevent duplicate rules
  unique(service_id, tax_rate_id)
);

-- Indexes
create index service_tax_rules_service_id_idx on public.service_tax_rules(service_id);

-- Comments
comment on table public.service_tax_rules is 'Maps services to applicable tax rates';
comment on column public.service_tax_rules.applies is 'false = service is explicitly exempt from this tax';

-- =============================================================================
-- SERVICE_CONSENT_REQUIREMENTS TABLE
-- Define which consent documents are required for each service
-- =============================================================================

create table if not exists public.service_consent_requirements (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  consent_document_key text not null,                -- String reference (consent system TBD)
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One requirement per document per service
  unique(service_id, consent_document_key)
);

-- Indexes
create index service_consent_requirements_service_id_idx on public.service_consent_requirements(service_id);

-- Comments
comment on table public.service_consent_requirements is 'Consent documents required per service';
comment on column public.service_consent_requirements.consent_document_key is 'Reference key for consent document (system TBD)';

-- =============================================================================
-- PROFESSIONAL_SERVICES TABLE
-- Assign which services (and variants) a professional can offer
-- =============================================================================

create table if not exists public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  variant_id uuid references public.service_variants(id) on delete cascade,  -- NULL = all variants
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  -- Prevent duplicates
  primary key (professional_id, service_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Indexes
create index professional_services_professional_id_idx on public.professional_services(professional_id);
create index professional_services_service_id_idx on public.professional_services(service_id);
create index professional_services_variant_id_idx on public.professional_services(variant_id) where variant_id is not null;

-- Comments
comment on table public.professional_services is 'Junction: which services each professional can offer';
comment on column public.professional_services.variant_id is 'NULL = professional can offer all variants of this service';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger services_set_updated_at
  before update on public.services
  for each row
  execute function public.set_updated_at();

create trigger service_variants_set_updated_at
  before update on public.service_variants
  for each row
  execute function public.set_updated_at();

create trigger tax_rates_set_updated_at
  before update on public.tax_rates
  for each row
  execute function public.set_updated_at();

create trigger service_tax_rules_set_updated_at
  before update on public.service_tax_rules
  for each row
  execute function public.set_updated_at();

create trigger service_consent_requirements_set_updated_at
  before update on public.service_consent_requirements
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
alter table public.services enable row level security;
alter table public.service_variants enable row level security;
alter table public.tax_rates enable row level security;
alter table public.service_tax_rules enable row level security;
alter table public.service_consent_requirements enable row level security;
alter table public.professional_services enable row level security;

-- SERVICES: Read for authenticated, write for service_role
create policy "services_select_authenticated"
  on public.services for select
  to authenticated
  using (true);

create policy "services_all_service_role"
  on public.services for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_VARIANTS: Read for authenticated, write for service_role
create policy "service_variants_select_authenticated"
  on public.service_variants for select
  to authenticated
  using (true);

create policy "service_variants_all_service_role"
  on public.service_variants for all
  to service_role
  using (true)
  with check (true);

-- TAX_RATES: Read for authenticated, write for service_role
create policy "tax_rates_select_authenticated"
  on public.tax_rates for select
  to authenticated
  using (true);

create policy "tax_rates_all_service_role"
  on public.tax_rates for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_TAX_RULES: Read for authenticated, write for service_role
create policy "service_tax_rules_select_authenticated"
  on public.service_tax_rules for select
  to authenticated
  using (true);

create policy "service_tax_rules_all_service_role"
  on public.service_tax_rules for all
  to service_role
  using (true)
  with check (true);

-- SERVICE_CONSENT_REQUIREMENTS: Read for authenticated, write for service_role
create policy "service_consent_requirements_select_authenticated"
  on public.service_consent_requirements for select
  to authenticated
  using (true);

create policy "service_consent_requirements_all_service_role"
  on public.service_consent_requirements for all
  to service_role
  using (true)
  with check (true);

-- PROFESSIONAL_SERVICES: Read for authenticated, write for service_role
create policy "professional_services_select_authenticated"
  on public.professional_services for select
  to authenticated
  using (true);

create policy "professional_services_all_service_role"
  on public.professional_services for all
  to service_role
  using (true)
  with check (true);
```

**Step 2: Apply migration to staging**

Run: `supabase db push`
Expected: Migration applied successfully

**Step 3: Verify tables exist**

Run: `supabase db diff` (should show no pending changes)

**Step 4: Commit**

```bash
git add supabase/migrations/20260119000005_services_schema.sql
git commit -m "feat(services): add database schema for service catalog

Tables created:
- services (core catalog)
- service_variants (avoid duplicates like Ouverture de dossier - Couple)
- tax_rates (TPS/TVQ support for future invoicing)
- service_tax_rules (service-to-tax mapping)
- service_consent_requirements (consent per service)
- professional_services (junction to professionals)

Features:
- Prices stored in cents for precision
- Tax rates in basis points (9975 = 9.975%)
- Calendar colors for future calendar view
- RLS: authenticated read, service_role write

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Create Services Seed Data Migration

**Files:**
- Create: `supabase/migrations/20260119000006_services_seed.sql`

**Step 1: Create the seed migration file**

```sql
-- Migration: services_seed
-- Module: services-catalog
-- Created: 2026-01-19
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)

-- =============================================================================
-- TAX RATES (Quebec)
-- =============================================================================

insert into public.tax_rates (key, label, rate_bps, region) values
  ('qc_gst', 'TPS', 500, 'QC'),    -- 5.00% federal GST
  ('qc_qst', 'TVQ', 9975, 'QC')    -- 9.975% Quebec QST
on conflict (key) do nothing;

-- =============================================================================
-- SAMPLE SERVICES
-- =============================================================================

-- Get tax rate IDs for later use
do $$
declare
  v_gst_id uuid;
  v_qst_id uuid;
  v_ouverture_id uuid;
  v_appel_decouverte_id uuid;
  v_consultation_id uuid;
begin
  -- Get tax rate IDs
  select id into v_gst_id from public.tax_rates where key = 'qc_gst';
  select id into v_qst_id from public.tax_rates where key = 'qc_qst';

  -- ============================================
  -- SERVICE: Ouverture de dossier
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'ouverture_dossier',
    'Ouverture de dossier',
    'Première rencontre pour ouvrir un dossier client. Inclut évaluation initiale.',
    60,
    4349,  -- $43.49
    true,
    '#7FAE9D',  -- Sage green
    1
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_ouverture_id;

  -- Variants for Ouverture de dossier
  insert into public.service_variants (service_id, key, label, sort_order) values
    (v_ouverture_id, 'individuel', 'Individuel', 1),
    (v_ouverture_id, 'couple', 'Couple', 2),
    (v_ouverture_id, 'mediation', 'Médiation', 3),
    (v_ouverture_id, 'service_consultation', 'Service de consultation', 4)
  on conflict (service_id, key) do nothing;

  -- Tax rules: Ouverture de dossier is taxable (TPS + TVQ)
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_ouverture_id, v_gst_id, true, 1),
    (v_ouverture_id, v_qst_id, true, 2)
  on conflict (service_id, tax_rate_id) do nothing;

  -- Consent: Ouverture de dossier requires intake consent
  insert into public.service_consent_requirements (service_id, consent_document_key, is_required) values
    (v_ouverture_id, 'intake_consent_v1', true)
  on conflict (service_id, consent_document_key) do nothing;

  -- ============================================
  -- SERVICE: Appel découverte (free, tax exempt)
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'appel_decouverte',
    'Appel découverte',
    'Appel gratuit de 15 minutes pour évaluer les besoins du client.',
    15,
    0,  -- Free
    true,
    '#B8D4E3',  -- Light blue
    2
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_appel_decouverte_id;

  -- Tax rules: Appel découverte is tax exempt (applies = false)
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_appel_decouverte_id, v_gst_id, false, 1),
    (v_appel_decouverte_id, v_qst_id, false, 2)
  on conflict (service_id, tax_rate_id) do nothing;

  -- ============================================
  -- SERVICE: Service de consultation (generic)
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'consultation',
    'Service de consultation',
    'Séance de consultation standard.',
    50,
    13000,  -- $130.00
    true,
    '#E8D5B7',  -- Warm beige
    3
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_consultation_id;

  -- Tax rules: Consultation is taxable
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_consultation_id, v_gst_id, true, 1),
    (v_consultation_id, v_qst_id, true, 2)
  on conflict (service_id, tax_rate_id) do nothing;

end $$;
```

**Step 2: Apply migration to staging**

Run: `supabase db push`
Expected: Seed data inserted successfully

**Step 3: Verify data**

Run: `supabase db query "select key, name, default_price_cents from public.services order by sort_order"`
Expected: 3 services listed (ouverture_dossier, appel_decouverte, consultation)

**Step 4: Commit**

```bash
git add supabase/migrations/20260119000006_services_seed.sql
git commit -m "feat(services): add seed data for service catalog

Data inserted:
- Tax rates: TPS (5.00%) and TVQ (9.975%) for Quebec
- Services:
  - Ouverture de dossier ($43.49, 60min, with 4 variants)
  - Appel découverte (free, 15min, tax exempt)
  - Service de consultation ($130.00, 50min)
- Tax rules mapping (taxable vs exempt)
- Consent requirement for Ouverture de dossier

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md with new tables**

Add to the "Key Tables" section in CLAUDE.md:

```markdown
- `services` - Service catalog (name, duration, price, online availability)
- `service_variants` - Variants to avoid duplicates (e.g., Couple, Médiation)
- `tax_rates` - Tax rates for invoicing (TPS 5%, TVQ 9.975%)
- `service_tax_rules` - Service-to-tax mapping
- `service_consent_requirements` - Consent documents per service
- `professional_services` - Junction: professionals ↔ services
```

Update the "Applied Migrations" count and add:

```markdown
9. `20260119000005_services_schema.sql` - services + variants + taxes + consent + professional junction
10. `20260119000006_services_seed.sql` - sample services + QC tax rates
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with services schema documentation

- Add services, service_variants, tax_rates tables to Key Tables
- Update Applied Migrations count (now 10)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Updated Summary

**Files created (13 total):**
- `src/services-catalog/types.ts`
- `src/services-catalog/constants/mock-services.ts`
- `src/services-catalog/constants/index.ts`
- `src/services-catalog/components/service-disclaimer-banner.tsx`
- `src/services-catalog/components/archive-service-dialog.tsx`
- `src/services-catalog/components/service-table-row.tsx`
- `src/services-catalog/components/service-editor-drawer.tsx`
- `src/services-catalog/components/index.ts`
- `src/services-catalog/index.ts`
- `src/pages/services.tsx`
- `supabase/migrations/20260119000005_services_schema.sql`
- `supabase/migrations/20260119000006_services_seed.sql`
- `docs/plans/2026-01-19-services-offerts.md`

**Files modified (5 total):**
- `src/pages/index.ts`
- `src/app/router.tsx`
- `src/shared/components/sidebar.tsx`
- `src/i18n/fr-CA.json`
- `CLAUDE.md`

**Database tables created:**
| Table | Purpose |
|-------|---------|
| `services` | Core service catalog |
| `service_variants` | Variants to avoid duplicates |
| `tax_rates` | TPS/TVQ for invoicing |
| `service_tax_rules` | Service-to-tax mapping |
| `service_consent_requirements` | Consent per service |
| `professional_services` | Which professionals offer which services |

**Future TODOs (out of scope):**
- [ ] Connect UI to database (replace mock data)
- [ ] Invoice/receipt generation logic
- [ ] Calendar integration with service colors
- [ ] Consent document management system
- [ ] Professional assignment UI
- [ ] Payment processing integration
