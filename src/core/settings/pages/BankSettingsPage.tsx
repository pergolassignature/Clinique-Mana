import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useBankDetails } from '@/core/settings/bank/hooks'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/ui/button'
import { BankDetailsCard } from '../components/BankDetailsCard'
import { BankDetailsForm } from '../components/BankDetailsForm'

/**
 * Paramètres → Coordonnées bancaires (`settings.bank_manage`, which both sees and edits them, so
 * there is no read-only mode). The masked details with an audited « Afficher », or « Aucune
 * coordonnée bancaire »; « Modifier » or « Ajouter » swaps in the form, and closing it returns
 * focus to that button (to « Réessayer » if the details could not be reloaded).
 */
export function BankSettingsPage() {
  const { data: details, isPending, isError, isFetching, refetch } = useBankDetails()
  const [editing, setEditing] = useState(false)
  // « Modifier », « Ajouter » or « Réessayer »: focus goes back there once the form closes.
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
    content = <Loading />
  } else if (isError && !details && !editing) {
    // Nothing to show and the last load failed: never the empty state, which would claim nothing is
    // stored (e.g. a first save succeeded but reloading the details did not). Stale details stay shown.
    // Intended: a failed background refetch with nothing stored also shows this banner, since we can
    // no longer vouch that nothing is stored.
    content = (
      <LoadError message={t('settings.bank.loadError')} retrying={isFetching} onRetry={() => void refetch()} retryRef={actionRef} />
    )
  } else if (editing) {
    content = <BankDetailsForm details={details ?? null} onClose={close} />
  } else if (details) {
    // Keyed by the save time: a change (here or by another admin) remounts the card, which masks the number again.
    content = <BankDetailsCard key={details.updated_at} details={details} onEdit={open} editRef={actionRef} />
  } else {
    content = (
      <EmptyState
        title={t('settings.bank.empty.title')}
        body={t('settings.bank.empty.body')}
        action={
          <Button ref={actionRef} type="button" variant="outline" onClick={open}>
            <Plus aria-hidden />
            {t('settings.bank.empty.add')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="max-w-form space-y-5">
      <PageHeader level={1} title={t('settings.sections.bank')} description={t('settings.bank.description')} fullWidthDescription />
      {content}
    </div>
  )
}
