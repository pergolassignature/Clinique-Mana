import { useState } from 'react'
import { SUBMISSION_SECTIONS, type SubmissionSection } from '../lib/constants'

/**
 * The questionnaire's sections to choose, at least one, in its order: staff's « Demander une mise
 * à jour » (4b.3) and the professional's « Mettre mon profil à jour » (4b.5). Ticking a box changes
 * the choice only (decision #36). `initial`: the professional's dialog starts with every section
 * (Jonathan, 2026-10-09: « at worst they update only what they want »); staff's starts empty.
 */
export function useSectionChoice(initial: readonly SubmissionSection[] = []) {
  const [chosen, setChosen] = useState<ReadonlySet<SubmissionSection>>(() => new Set(initial))
  const [missing, setMissing] = useState(false)
  return {
    chosen,
    missing,
    toggle: (section: SubmissionSection, checked: boolean) => {
      const next = new Set(chosen)
      if (checked) next.add(section)
      else next.delete(section)
      setChosen(next)
      if (next.size > 0) setMissing(false)
    },
    /** « Tout cocher » / « Tout décocher ». */
    setAll: (checked: boolean) => {
      setChosen(new Set(checked ? SUBMISSION_SECTIONS : []))
      if (checked) setMissing(false)
    },
    /** The sections in the questionnaire's order, whatever the order of the clicks; null (and the error shown) when none. */
    sections: (): SubmissionSection[] | null => {
      if (chosen.size === 0) {
        setMissing(true)
        return null
      }
      return SUBMISSION_SECTIONS.filter((section) => chosen.has(section))
    },
  }
}
