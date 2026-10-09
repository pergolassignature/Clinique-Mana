import { createContext } from 'react'

/**
 * « Enregistrer le brouillon » for the step shown: the page provides it (null on the steps saved only
 * on « Continuer » and on « Révision »), `StepActions` puts it next to « Continuer », after the
 * fields in the tab order (on a phone too).
 */
export const DraftActionContext = createContext<(() => void) | null>(null)
