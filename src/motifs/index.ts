// Types
export type { DbMotif, MotifDisplayGroup, Motif, MotifCategory } from './types'

// Constants and helpers
// NOTE: MOTIF_DISPLAY_GROUPS is deprecated - use useMotifCategories() hook instead
export {
  isOtherMotif,
  isMotifRestricted,
} from './constants'

// Hooks
export {
  useMotifs,
  useMotifMutations,
  generateKeyFromLabel,
  useMotifCategories,
  type DbMotifWithCategory,
} from './hooks'

// Components
export {
  MotifCard,
  MotifCategoryGroup,
  MotifDisclaimerBanner,
  MotifRestrictionNotice,
  ArchiveMotifDialog,
  CreateMotifDialog,
  ChangeCategoryDialog,
  CategoriesManagerDrawer,
} from './components'
