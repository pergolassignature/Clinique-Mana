import { useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useSetVideoLink } from '../../hooks/use-video'
import { fixedLinkError } from '../../lib/video'

const F = 'modules.appointments.video.fixed'

/**
 * « Lien fixe »: a professional's own meeting address (Google Meet, Microsoft Teams, a personal Zoom
 * room…), used for her video appointments whenever her Zoom is not connected (R-55). Emptied and
 * saved, it is removed. Read-only without the right to change it.
 */
export function FixedLinkForm({
  professionalId,
  current,
  readOnly,
  layout = 'card',
  title = t(`${F}.title`),
  description = t(`${F}.description`),
}: {
  professionalId: string
  current: string | null
  readOnly: boolean
  layout?: 'card' | 'section'
  title?: string
  description?: string
}) {
  const [value, setValue] = useState(current ?? '')
  const [base, setBase] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  // A change saved elsewhere (another tab, the staff) replaces a clean form.
  if ((current ?? '') !== base && value === base) {
    setBase(current ?? '')
    setValue(current ?? '')
  }
  const save = useSetVideoLink({
    onErrorMessage: (message) => setError(message),
  })
  const dirty = !readOnly && value.trim() !== base.trim()
  useUnsavedChanges(dirty)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || save.isPending) return
    const invalid = fixedLinkError(value)
    setError(invalid)
    if (invalid) return
    save.mutate(
      { professionalId, url: value.trim() },
      {
        onSuccess: () => {
          setBase(value.trim())
          setValue(value.trim())
        },
      },
    )
  }

  return (
    <SettingsCard
      layout={layout}
      title={title}
      description={description}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={submit}
      footer={
        <FormActions
          dirty={dirty}
          pending={save.isPending}
          onCancel={() => {
            setValue(base)
            setError(null)
          }}
        />
      }
    >
      <FormField label={t(`${F}.label`)} help={t(`${F}.help`)} error={error ?? undefined}>
        {(field) => (
          <Input
            {...field}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={500}
            placeholder="https://meet.google.com/abc-defg-hij"
            value={value}
            readOnly={readOnly}
            onChange={(event) => {
              setValue(event.target.value)
              if (error) setError(null)
            }}
          />
        )}
      </FormField>
    </SettingsCard>
  )
}
