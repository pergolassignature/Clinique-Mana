import { useWatch, type Control } from 'react-hook-form'
import type { z } from 'zod'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface } from '@/shared/components/SettingsCard'
import { regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalRecord } from '../../../api/parse'
import { useSavePublicProfile } from '../../../hooks/use-card-saves'
import { publicProfileSchema, toPublicProfileFormValues } from '../../../schemas/public-profile'
import { editingHelp } from '../editing-help'
import { ProfessionalCard } from '../ProfessionalCard'

const P = 'modules.professionals.record.publicProfile'
/** `professional_public_profiles_bio_check` / `_approach_check`. */
const TEXT_MAX = 4000

/** Both cards edit the one public profile row; each sends only its own fields. */
const toPortraitValues = (record: ProfessionalRecord) => {
  const { bio, approach } = toPublicProfileFormValues(record.publicProfile)
  return { bio, approach }
}
const toPublicContactValues = (record: ProfessionalRecord) => {
  const { publicEmail, publicPhone } = toPublicProfileFormValues(record.publicProfile)
  return { publicEmail, publicPhone }
}
const portraitSchema = publicProfileSchema.pick({ bio: true, approach: true })
type PortraitControl = Control<z.input<typeof portraitSchema>, unknown, z.output<typeof portraitSchema>>
const publicContactSchema = publicProfileSchema.pick({ publicEmail: true, publicPhone: true })

/** Characters as stored (trimmed, as the schema does), counted as the database does (code points, `char_length`). */
function CharacterCount({ control, name }: { control: PortraitControl; name: 'bio' | 'approach' }) {
  const value = useWatch({ control, name })
  return t(`${P}.portrait.counter`, { count: String([...value.trim()].length), max: String(TEXT_MAX) })
}

/**
 * « Profil public » (design §5.3, A2.11): what the client's fiche shows, two sections of one surface
 * (audit 2026-10-09 §2.4). Editable with `professionals.manage`, empty or not; read-only otherwise.
 * 4c adds the photo and the fiche preview.
 */
export function PublicProfileTab() {
  const readOnly = !useAccess().can('professionals.manage')
  return (
    <div className="space-y-5">
      {readOnly && <ReadOnlyNotice body={t('modules.professionals.record.identity.readOnly')} />}
      <SectionSurface>
      <ProfessionalCard
        layout="section"
        title={t(`${P}.portrait.title`)}
        description={t(`${P}.portrait.description`)}
        readOnly={readOnly}
        schema={portraitSchema}
        toFormValues={toPortraitValues}
        firstField="bio"
        useSave={useSavePublicProfile}
      >
        {({ register, control, formState: { errors } }) => (
          <>
            {(['bio', 'approach'] as const).map((name) => (
              <FormField
                key={name}
                label={t(`${P}.portrait.${name}`)}
                // The counter is the help: read with the field, like the limit it counts towards.
                help={editingHelp(readOnly, <CharacterCount control={control} name={name} />)}
                error={errors[name]?.message}
              >
                {(field) => <Textarea {...field} {...register(name)} rows={6} />}
              </FormField>
            ))}
          </>
        )}
      </ProfessionalCard>
      <ProfessionalCard
        layout="section"
        title={t(`${P}.contact.title`)}
        description={t(`${P}.contact.description`)}
        readOnly={readOnly}
        schema={publicContactSchema}
        toFormValues={toPublicContactValues}
        firstField="publicEmail"
        useSave={useSavePublicProfile}
      >
        {(form) => (
          <>
            <FormField label={t(`${P}.contact.email`)} error={form.formState.errors.publicEmail?.message}>
              {(field) => <Input {...field} {...form.register('publicEmail')} type="email" autoComplete="off" />}
            </FormField>
            <FormField label={t(`${P}.contact.phone`)} width="md" error={form.formState.errors.publicPhone?.message}>
              {(field) => <Input {...field} {...form.register('publicPhone', regroupOnBlur(form, 'publicPhone', regroupPhone))} type="tel" autoComplete="off" />}
            </FormField>
          </>
        )}
      </ProfessionalCard>
      </SectionSurface>
    </div>
  )
}
