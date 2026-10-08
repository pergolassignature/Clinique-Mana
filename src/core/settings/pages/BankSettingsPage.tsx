import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useBankDetails } from '@/core/settings/bank/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { Button } from '@/shared/ui/button'
import { BankDetailsCard } from '../components/BankDetailsCard'
import { BankDetailsForm } from '../components/BankDetailsForm'

/**
 * Paramètres → Coordonnées bancaires (`settings.bank_manage`, which both sees and edits them).
 * The masked details with an audited « Afficher », or « Aucune coordonnée bancaire »; « Modifier »
 * or « Ajouter » swaps in the form, and closing it returns focus to that button. The section has no
 * edit permission today, but a read-only render (should one ever be added) cannot open the form.
 */
export function BankSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { data: details, isPending, isError, isFetching, refetch } = useBankDetails()
  const [editing, setEditing] = useState(false)
  // « Modifier » or « Ajouter »: focus goes back there once the form closes.
  const actionRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      actionRef.current?.focus()
    }
  }, [editing])

  const open = () => setEditing(true)
  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }

  let content
  if (isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  } else if (isError && details === undefined) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('settings.bank.loadError')}</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else if (editing && !readOnly) {
    content = <BankDetailsForm details={details ?? null} onClose={close} />
  } else if (details) {
    // Keyed by the save time: a change (here or by another admin) remounts the card, which masks the number again.
    content = <BankDetailsCard key={details.updated_at} details={details} onEdit={readOnly ? undefined : open} editRef={actionRef} />
  } else {
    content = (
      <EmptyState
        title={t('settings.bank.empty.title')}
        body={readOnly ? undefined : t('settings.bank.empty.body')}
        action={
          !readOnly && (
            <Button ref={actionRef} type="button" variant="outline" onClick={open}>
              <Plus aria-hidden />
              {t('settings.bank.empty.add')}
            </Button>
          )
        }
      />
    )
  }

  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={t('settings.sections.bank')} description={t('settings.bank.description')} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}
