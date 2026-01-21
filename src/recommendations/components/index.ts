// src/recommendations/components/index.ts
// Barrel exports for recommendation UI components

// Main panel
export { RecommendationsPanel } from './recommendations-panel'
export type { RecommendationsPanelProps } from './recommendations-panel'

// Individual card
export { RecommendationCard } from './recommendation-card'
export type { RecommendationCardProps } from './recommendation-card'

// Score visualization
export { ScoreBreakdown, ScoreBadge } from './score-breakdown'

// Exclusions summary
export { ExclusionsSummary } from './exclusions-summary'

// Near-eligible list
export { NearEligibleList } from './near-eligible-list'

// Analysis input summary
export { AnalysisInputSummary } from './analysis-input-summary'

// Professional profile dialog
export { ProfessionalProfileDialog } from './professional-profile-dialog'

// Slot selection drawer
export { SlotSelectionDrawer } from './slot-selection-drawer'
export type { AvailableSlot } from './slot-selection-drawer'

// Loading states
export { LoadingSkeleton, RecommendationCardSkeleton } from './loading-skeleton'
