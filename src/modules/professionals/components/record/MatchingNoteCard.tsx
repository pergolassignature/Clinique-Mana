import { t } from '@/i18n'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { FormField } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalRecord } from '../../api/parse'
import { useSaveMatchingNote } from '../../hooks/use-card-saves'
import { matchingNoteSchema, toMatchingNoteFormValues } from '../../schemas/matching'
import { editingHelp } from './editing-help'
import { ProfessionalCard } from './ProfessionalCard'
import { useRecordData } from './record-context'

const N = 'modules.professionals.record.matching.matchingNote'

const noteValues = (record: ProfessionalRecord) => toMatchingNoteFormValues(record.matchingNote)

/** The RPC's refusal (« La note compte au plus 1000 caractères. ») goes under the field. */
const noteError = (error: unknown) => (rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'note' ? ('note' as const) : null)

/**
 * « Bon à savoir » (P4-384): what the team must know when matching, for staff only. Never shown to
 * the provider, on the fiche or in the public profile (a staff-only table, P4-384); the history
 * says that it changed, never the text (P4-385). Read with `professionals.view`, edited with
 * `professionals.matching` through `set_professional_matching_note`; an empty note clears it.
 */
export function MatchingNoteCard({ readOnly }: { readOnly: boolean }) {
  const { record } = useRecordData()
  return (
    <ProfessionalCard
      title={t(`${N}.title`)}
      description={t(`${N}.description`, { firstName: record.professional.firstName })}
      readOnly={readOnly}
      schema={matchingNoteSchema}
      toFormValues={noteValues}
      firstField="note"
      useSave={useSaveMatchingNote}
      errorField={noteError}
    >
      {(form) => (
        <FormField label={t(`${N}.label`)} help={editingHelp(readOnly, t(`${N}.help`))} error={form.formState.errors.note?.message}>
          {(control) => (
            <Textarea
              {...control}
              {...form.register('note')}
              placeholder={readOnly ? t(`${N}.empty`) : t(`${N}.placeholder`)}
              maxLength={1000}
              rows={4}
              className="min-h-20"
            />
          )}
        </FormField>
      )}
    </ProfessionalCard>
  )
}
