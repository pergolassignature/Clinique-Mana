import { t } from '@/i18n'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalRecord } from '../../api/parse'
import { useSaveMatchingPriority } from '../../hooks/use-card-saves'
import { matchingPrioritySchema, toMatchingPriorityFormValues } from '../../schemas/matching'
import { editingHelp } from './editing-help'
import { ProfessionalCard } from './ProfessionalCard'

const P = 'modules.professionals.record.matching.priority'

const priorityValues = (record: ProfessionalRecord) => toMatchingPriorityFormValues(record.matchingPriority)

/** The RPC's refusal (« La raison compte 200 caractères au plus… ») goes under the field. */
const priorityError = (error: unknown) => (rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'reason' ? ('reason' as const) : null)

/**
 * « Priorité de jumelage » (P4-552): the workbook's name colours, written down. A reason makes
 * the file « À prioriser » in Demandes' matching panel (a badge with the reason; the order of the
 * suggestions does not change); an empty reason removes it. Staff only (never shown to the
 * provider); edited with `professionals.matching` through `set_professional_matching_priority`.
 */
export function MatchingPriorityCard({ readOnly }: { readOnly: boolean }) {
  return (
    <ProfessionalCard
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      readOnly={readOnly}
      schema={matchingPrioritySchema}
      toFormValues={priorityValues}
      firstField="reason"
      useSave={useSaveMatchingPriority}
      errorField={priorityError}
    >
      {(form) => (
        <FormField label={t(`${P}.label`)} help={editingHelp(readOnly, t(`${P}.help`))} error={form.formState.errors.reason?.message}>
          {(control) => (
            <Input {...control} {...form.register('reason')} placeholder={readOnly ? t(`${P}.empty`) : t(`${P}.placeholder`)} maxLength={200} />
          )}
        </FormField>
      )}
    </ProfessionalCard>
  )
}
