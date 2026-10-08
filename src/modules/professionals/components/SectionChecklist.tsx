import { useId, type Ref } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'
import { SUBMISSION_SECTIONS } from '../lib/constants'
import { sectionLabel } from '../lib/onboarding'
import type { useSectionChoice } from './use-section-choice'

/** The checklist of `useSectionChoice` (« Demander une mise à jour », « Mettre mon profil à jour »). */
interface SectionChecklistProps {
  choice: ReturnType<typeof useSectionChoice>
  legend: string
  /** Said under the list when nothing is ticked on confirm. */
  requiredMessage: string
  disabled: boolean
  /** The first box: focused when the dialog opens and when nothing is ticked. */
  firstRef: Ref<HTMLButtonElement>
}

export function SectionChecklist({ choice, legend, requiredMessage, disabled, firstRef }: SectionChecklistProps) {
  const errorId = useId()
  return (
    <fieldset disabled={disabled} aria-describedby={choice.missing ? errorId : undefined} className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <ul className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        {SUBMISSION_SECTIONS.map((section, index) => (
          <li key={section} className="flex items-center gap-2.5">
            <Checkbox
              ref={index === 0 ? firstRef : undefined}
              id={`${errorId}-${section}`}
              checked={choice.chosen.has(section)}
              onCheckedChange={(value) => choice.toggle(section, value === true)}
              aria-invalid={choice.missing || undefined}
            />
            <Label htmlFor={`${errorId}-${section}`} className="font-normal">
              {sectionLabel(section)}
            </Label>
          </li>
        ))}
      </ul>
      {choice.missing && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">
          {requiredMessage}
        </p>
      )}
    </fieldset>
  )
}
