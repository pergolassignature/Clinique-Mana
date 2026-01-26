// Current components
export { ProfessionalProfileTab } from './profile-tab'
export { ProfessionalDocumentsTab } from './documents-tab'
export { ProfessionalHistoryTab } from './history-tab'
export { ProfessionalServicesTab } from './services-tab'
export { ProfessionEditor } from './profession-editor'

// New components (Phase 2 restructure)
export { ProfessionalApercuTab } from './apercu-tab'
export { ProfessionalProfilPublicTab } from './profil-public-tab'
export { StatusIndicator, type StatusIndicatorStatus } from './status-indicator'
export { FichePreview } from './fiche-preview'
export { FichePdfDocument, type FichePdfData } from './fiche-pdf-document'
export {
  MotifAccordionSelector,
  type MotifAccordionSelectorProps,
  type MotifSelection,
} from './motif-accordion-selector'

// @deprecated - Use ProfessionalProfilPublicTab instead
export { ProfessionalPortraitTab } from './portrait-tab'
// @deprecated - Content moved to ProfessionalApercuTab
export { ProfessionalOnboardingTab } from './onboarding-tab'
// @deprecated - Content moved to ProfessionalProfilPublicTab
export { ProfessionalFicheTab } from './fiche-tab'
