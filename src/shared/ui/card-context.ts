import { createContext, useContext } from 'react'

/**
 * Whether the content around is inside a card (`Card`, `SettingsCard`, `SectionSurface`), so
 * what sits in it adds no padding of its own: `EmptyState` drops its 24 px above and below
 * (audit 2026-10-09 finding 8). Dialogs and sheets reset it: React context crosses their portal.
 */
export const InCardContext = createContext(false)

/** `inCard` as given, else whether a card is around. */
export function useInCard(inCard: boolean | undefined): boolean {
  const inherited = useContext(InCardContext)
  return inCard ?? inherited
}
