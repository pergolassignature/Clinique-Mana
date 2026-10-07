// src/professionals/components/motif-selector-drawer.tsx
// Drawer for selecting motifs in professional profile

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/shared/ui/sheet'
import { MotifDisclaimerBanner } from '@/motifs'
import { MotifAccordionSelector, type MotifSelection } from './motif-accordion-selector'

interface MotifSelectorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedMotifIds: string[]
  specializedMotifIds: string[]
  onMotifAdd: (motif: MotifSelection) => void
  onMotifRemove: (motif: MotifSelection) => void
  onSpecializationChange: (motifId: string, isSpecialized: boolean) => void
  disabled?: boolean
}

export function MotifSelectorDrawer({
  open,
  onOpenChange,
  selectedMotifIds,
  specializedMotifIds,
  onMotifAdd,
  onMotifRemove,
  onSpecializationChange,
  disabled = false,
}: MotifSelectorDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Motifs de consultation</SheetTitle>
          <SheetDescription>
            Sélectionnez les motifs de consultation pour ce professionnel. Utilisez l'étoile pour marquer les spécialisations.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <MotifDisclaimerBanner />

          <MotifAccordionSelector
            selectedMotifIds={selectedMotifIds}
            specializedMotifIds={specializedMotifIds}
            onMotifAdd={onMotifAdd}
            onMotifRemove={onMotifRemove}
            onSpecializationChange={onSpecializationChange}
            disabled={disabled}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
