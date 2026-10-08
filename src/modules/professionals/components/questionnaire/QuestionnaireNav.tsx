import { useId, useState } from 'react'
import { ChevronDown, Circle, CircleAlert, CircleCheck, CircleDot } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import type { QuestionnaireStep, SubmissionSection } from '../../lib/questionnaire'

const Q = 'modules.professionals.questionnaire'

interface QuestionnaireNavProps {
  steps: readonly QuestionnaireStep[]
  current: QuestionnaireStep
  /** The requested sections not complete yet (« Révision » is never « complete »). */
  incomplete: readonly SubmissionSection[]
  /** The sections whose last change was refused (not saved): marked until a save lands. */
  refused?: readonly SubmissionSection[]
  onSelect: (step: QuestionnaireStep) => void
}

type StepState = 'complete' | 'current' | 'todo'

const ICONS = {
  complete: { Icon: CircleCheck, className: 'text-success' },
  current: { Icon: CircleDot, className: 'text-primary' },
  todo: { Icon: Circle, className: 'text-subtle' },
} as const
const REFUSED = { Icon: CircleAlert, className: 'text-destructive' } as const

/**
 * Where the provider is: « Étape 3 sur 12 » with a progress bar, and the list of steps with their
 * state (done ✓, current, to do). The list is section navigation inside a form: its buttons are out
 * of the tab order (CLAUDE.md §10); keyboard users move with « Retour » / « Continuer ». On a phone
 * the list folds under « Voir toutes les étapes »; from `md` it stands on the left. A step whose last
 * change was refused carries an alert mark (and says so to a screen reader). On a phone the toggle
 * and the rows are 44 px tall (touch targets).
 */
export function QuestionnaireNav({ steps, current, incomplete, refused = [], onSelect }: QuestionnaireNavProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const index = steps.indexOf(current)
  const done = steps.filter((step) => step !== 'review' && !incomplete.includes(step)).length
  const sections = steps.length - 1
  const stateOf = (step: QuestionnaireStep): StepState =>
    step === current ? 'current' : step !== 'review' && !incomplete.includes(step) ? 'complete' : 'todo'

  return (
    <nav aria-label={t(`${Q}.stepsLabel`)} className="min-w-0">
      <div className="space-y-2 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t(`${Q}.stepOf`, { current: String(index + 1), total: String(steps.length) })}
            <span aria-hidden> · </span>
            {t(`${Q}.doneCount`, { done: String(done), total: String(sections) })}
          </p>
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="-mr-1.5 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-link hover:bg-muted md:min-h-0"
          >
            {t(open ? `${Q}.hideSteps` : `${Q}.showSteps`)}
            <ChevronDown aria-hidden className={cn('size-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
          </button>
        </div>
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${(done / Math.max(sections, 1)) * 100}%` }} />
        </div>
      </div>
      <ol id={listId} className={cn('mt-2 space-y-0.5 md:mt-0 md:block', open ? 'block' : 'hidden')}>
        {steps.map((step, i) => {
          const state = stateOf(step)
          const isRefused = step !== 'review' && refused.includes(step)
          const { Icon, className } = isRefused ? REFUSED : ICONS[state]
          return (
            <li key={step}>
              <button
                type="button"
                tabIndex={-1}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => {
                  setOpen(false)
                  onSelect(step)
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors md:min-h-0',
                  state === 'current' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="sr-only">{t(`${Q}.stepNumber`, { n: String(i + 1) })} </span>
                  {t(`${Q}.steps.${step}.title`)}
                </span>
                <span className="sr-only">
                  {t(`${Q}.stepState.${state}`)}
                  {isRefused && ` ${t(`${Q}.stepState.refused`)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
