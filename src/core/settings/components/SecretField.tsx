import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useSetOrgSecret } from '@/core/settings/secrets/hooks'
import { SaveButton } from '@/shared/components/SaveButton'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusDot } from '@/shared/ui/status-dot'

interface SecretFieldProps {
  /** The `org_secrets` key (`resend_api_key`, …). */
  secretKey: string
  label: string
  help?: string
  /** When the secret was last set (`list_org_secret_keys`), or null when it is not configured. */
  configuredAt: string | null
  /** Without `settings.integrations_manage`: the status only. */
  readOnly: boolean
}

/**
 * A write-only org secret (an API key, a webhook secret): « Configurée » or « Non configurée »,
 * never the value, which only Vault holds. « Remplacer » (or « Ajouter ») reveals an empty password
 * field; « Enregistrer » sends it once through `set_org_secret`, then the field is cleared and
 * closed. What is typed lives in this component's state only, never in the query cache.
 */
export function SecretField({ secretKey, label, help, configuredAt, readOnly }: SecretFieldProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const mutation = useSetOrgSecret()
  const id = useId()
  const errorId = `${id}-error`
  useUnsavedChanges(editing && value !== '')

  // Once the field closes (saved or cancelled), focus goes back to « Remplacer ».
  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    actionRef.current?.focus()
  }, [editing])

  const close = () => {
    setValue('')
    setError(null)
    returnFocus.current = true
    setEditing(false)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutation.isPending) return
    const trimmed = value.trim()
    if (trimmed === '') {
      setError(t('settings.secrets.required'))
      return
    }
    mutation.mutate(
      { key: secretKey, value: trimmed },
      // reset(): the mutation's variables (the value) are not kept once it has settled.
      { onSuccess: close, onSettled: () => mutation.reset() },
    )
  }

  const configured = configuredAt !== null
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
          {configured ? (
            <>
              <CircleCheck aria-hidden className="size-3.5 text-success" />
              {t('settings.secrets.configured')}
              <span className="text-xs text-muted-foreground">{t('settings.secrets.configuredAt', { date: formatClinicDateShort(configuredAt) })}</span>
            </>
          ) : (
            <>
              <StatusDot tone="neutral" />
              {t('settings.secrets.notConfigured')}
            </>
          )}
        </p>
        {!readOnly && !editing && (
          <Button
            ref={actionRef}
            type="button"
            variant="outline"
            size="sm"
            aria-label={t(configured ? 'settings.secrets.replace' : 'settings.secrets.add', { label })}
            onClick={() => setEditing(true)}
            className="max-sm:h-11"
          >
            {t(configured ? 'settings.secrets.replaceShort' : 'settings.secrets.addShort')}
          </Button>
        )}
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {editing && (
        <form onSubmit={submit} noValidate aria-busy={mutation.isPending || undefined} className="flex flex-wrap items-start gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Input
              // Opened by « Remplacer »: the field takes focus at once.
              autoFocus
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              aria-label={t('settings.secrets.newValue', { label })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
            />
            {error && (
              <p id={errorId} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="button" variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <SaveButton pending={mutation.isPending} />
        </form>
      )}
    </div>
  )
}
