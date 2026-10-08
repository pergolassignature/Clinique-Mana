import type { ReactNode, Ref } from 'react'
import { Eye, EyeOff, Pencil } from 'lucide-react'
import { t } from '@/i18n'
import type { BankDetails } from '@/core/settings/bank/api'
import { useRevealedAccountNumber } from '@/core/settings/bank/hooks'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

interface BankDetailsCardProps {
  details: BankDetails
  /** Opens the edit form. */
  onEdit: () => void
  /** « Modifier », where the page returns focus once the form closes. */
  editRef?: Ref<HTMLButtonElement>
}

/** One key/value pair of the card: key 12 px secondary, value 13 px (design system key/value rows). */
function Item({ term, children, className }: { term: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className={cn('mt-0.5 text-sm text-foreground', className)}>{children}</dd>
    </div>
  )
}

/**
 * The stored bank details, account masked (`••••4567`). « Afficher » reveals the full number
 * through the audited RPC; it stays in this component's state only and is masked again by
 * « Masquer », after a minute, when the tab is hidden, and when the card unmounts. The page remounts the card (`key`) when
 * the details change, so a number revealed before a save never outlives it.
 */
export function BankDetailsCard({ details, onEdit, editRef }: BankDetailsCardProps) {
  const { accountNumber, pending, reveal, hide } = useRevealedAccountNumber()
  const revealed = accountNumber !== null
  const updatedAt = formatClinicDateTime(details.updated_at)

  return (
    <SettingsCard
      as="section"
      title={t('settings.bank.title')}
      footer={
        <Button ref={editRef} type="button" variant="outline" aria-label={t('settings.bank.display.editLabel')} onClick={onEdit}>
          <Pencil aria-hidden />
          {t('settings.bank.display.edit')}
        </Button>
      }
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <Item term={t('settings.bank.display.institution')} className="tabular">
          {details.institution_number}
        </Item>
        <Item term={t('settings.bank.display.transit')} className="tabular">
          {details.transit_number}
        </Item>
        <Item term={t('settings.bank.display.account')}>
          <span className="flex flex-wrap items-center gap-x-2">
            {/* Announced when it changes: the number once revealed, the masked words once hidden. */}
            <span aria-live="polite" translate="no" className="tabular">
              {revealed ? (
                accountNumber
              ) : (
                <>
                  <span className="sr-only">{t('settings.bank.display.masked', { last4: details.account_last4 })}</span>
                  <span aria-hidden="true">{`••••${details.account_last4}`}</span>
                </>
              )}
            </span>
            {/* One button that changes label, so keyboard focus stays on it after each press. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              aria-label={
                revealed
                  ? t('settings.bank.display.hideLabel')
                  : pending
                    ? t('settings.bank.display.revealingLabel')
                    : t('settings.bank.display.showLabel')
              }
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, revealed ? hide : () => void reveal())}
              className={cn(softDisabledClasses, 'aria-disabled:hover:no-underline')}
            >
              {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {revealed ? t('settings.bank.display.hide') : pending ? t('settings.bank.display.revealing') : t('settings.bank.display.show')}
            </Button>
          </span>
          {revealed && <span className="mt-0.5 block text-xs text-muted-foreground">{t('settings.bank.display.autoHide')}</span>}
        </Item>
        <Item term={t('settings.bank.display.email')} className="break-all">
          {details.etransfer_email ?? t('settings.bank.display.none')}
        </Item>
      </dl>
      <p className="text-xs text-muted-foreground">
        {details.updated_by_name
          ? t('settings.bank.display.updated', { date: updatedAt, name: details.updated_by_name })
          : t('settings.bank.display.updatedNoName', { date: updatedAt })}
      </p>
    </SettingsCard>
  )
}
