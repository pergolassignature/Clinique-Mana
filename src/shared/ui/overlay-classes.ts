/** Classes shared by the overlay primitives (Dialog, AlertDialog, Sheet). */
import { focusRing } from './field-classes'

/** Ink at 32 %, no blur, fades in. */
export const overlayClasses = 'fixed inset-0 z-50 bg-overlay animate-fade-in motion-reduce:animate-none'

/** Centred dialog panel: max 512, radius 8, padding 20, gap 14, large shadow; fade + zoom from 95 %. */
export const overlayContentClasses =
  'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[512px] -translate-x-1/2 -translate-y-1/2 gap-3.5 overflow-y-auto rounded-2xl bg-card p-5 text-foreground shadow-large animate-dialog-in motion-reduce:animate-none'

/**
 * A dialog anchored near the top instead of centred (`DialogContent position="top"`): its top edge
 * stays put while its height changes, e.g. the ⌘K palette as results arrive. 15vh from the top,
 * fade + zoom without moving vertically.
 */
export const overlayTopClasses = 'top-[15vh] max-h-[calc(85dvh-1rem)] translate-y-0 animate-dialog-in-top'

/** The default X (kept out of the tab order by the components). */
export const closeButtonClasses = `absolute right-4 top-4 rounded-lg p-1 text-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 ${focusRing} disabled:pointer-events-none`
