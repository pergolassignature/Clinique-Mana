import { createContext, useContext } from 'react'
import type { DraftContent } from '../api/composer'

/** What opens the composer: a saved draft, or a new message (new, a reply, a forward). */
export type ComposeRequest =
  | { kind: 'draft'; draftId: string; personKnown: boolean; fileLabel?: string | null }
  | { kind: 'content'; content: DraftContent; personKnown: boolean; fileLabel?: string | null }

export interface ComposerLauncher {
  /** Opens the composer (one at a time: the one open is saved and replaced). */
  open: (request: ComposeRequest) => void
  /** Whether a composer is open. */
  isOpen: boolean
}

export const ComposerContext = createContext<ComposerLauncher | null>(null)

/** The composer of the page (`ComposerHost`); null outside one. */
export function useComposerLauncher(): ComposerLauncher | null {
  return useContext(ComposerContext)
}
