import { useId, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort, formatDateOnly } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { typeStateLabel, typeStateTone, type DocumentPermissions, type DocumentViewer, type TypeDocuments } from '../../lib/documents'
import { DocumentRow, type DocumentRowProps } from './DocumentRow'

const D = 'modules.professionals.documents'

interface RequiredDocumentCardProps {
  /** The type and its documents on the clinic's `today` (`typeDocuments`). */
  entry: TypeDocuments
  today: string
  viewer: DocumentViewer
  firstName: string
  can: DocumentPermissions
  onAction: DocumentRowProps['onAction']
  /** « Téléverser » / « Remplacer » for this type (the upload dialog, its type fixed). */
  onUpload: (opener: HTMLButtonElement) => void
  /** Below the state: the image consent's Documenso signing on the record (P4-484). */
  extra?: ReactNode
}

/**
 * One required type (Documents tab, « Mes documents »): its name, its state in words (« Valide
 * jusqu'au 31 mars 2027 », « Expire le … » within the type's reminder window, « Expiré : … »,
 * « À vérifier », « Refusé », « Manquant »), then the documents that make it: a renewal waiting
 * for review (« Nouveau document »), the one that counts, the latest refusal with its reason. For
 * the image consent, the e-consent in force (« Signé électroniquement le … par … »). Older
 * documents fold under « Voir les documents précédents (n) ». « Téléverser » (« Remplacer » once a
 * document counts) for whoever may upload.
 */
export function RequiredDocumentCard({ entry, today, viewer, firstName, can, onAction, onUpload, extra }: RequiredDocumentCardProps) {
  const titleId = useId()
  const [showOlder, setShowOlder] = useState(false)
  const { type, kind, current, pending, rejected, consent, older } = entry
  const replace = current !== null || consent !== null
  const rowProps = { type, today, viewer, firstName, can, onAction }
  const empty = !current && !pending && !rejected && !consent

  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <h4 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
            {type.name}
          </h4>
          <p data-type-state className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <StatusDot tone={typeStateTone(kind)} />
            {typeStateLabel(entry, viewer === 'self')}
          </p>
        </div>
        {can.upload && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            aria-label={t(replace ? `${D}.actions.replaceLabel` : `${D}.actions.uploadLabel`, { type: type.name })}
            onClick={(event) => onUpload(event.currentTarget)}
          >
            <Upload aria-hidden />
            {t(replace ? `${D}.actions.replace` : `${D}.actions.upload`)}
          </Button>
        )}
      </div>
      {consent && (
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <p>
            {consent.signerName
              ? t(`${D}.lines.consent`, { date: formatClinicDateShort(consent.signedAt), name: consent.signerName, version: String(consent.version) })
              : t(`${D}.lines.consentNoName`, { date: formatClinicDateShort(consent.signedAt), version: String(consent.version) })}
          </p>
          {consent.withdrawalEffectiveOn && <p>{t(`${D}.lines.consentWithdrawn`, { date: formatDateOnly(consent.withdrawalEffectiveOn) })}</p>}
        </div>
      )}
      {extra}
      {viewer === 'self' && kind === 'rejected' && <p className="mt-2 text-sm text-foreground">{t('modules.professionals.myDocuments.rejectedNote')}</p>}
      {empty ? (
        <p className="mt-2 text-sm text-muted-foreground">{t(`${D}.lines.none`)}</p>
      ) : (
        (pending || current || rejected) && (
          <ul aria-label={type.name} className="mt-2 divide-y divide-border-light border-t border-border-light">
            {pending && <DocumentRow document={pending} label={current ? t(`${D}.lines.newPending`) : undefined} {...rowProps} />}
            {current && <DocumentRow document={current} {...rowProps} />}
            {rejected && <DocumentRow document={rejected} {...rowProps} />}
            {showOlder && older.map((document) => <DocumentRow key={document.id} document={document} {...rowProps} />)}
          </ul>
        )
      )}
      {older.length > 0 && (
        <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
          {showOlder ? t(`${D}.older.hide`) : t(`${D}.older.show`, { count: String(older.length) })}
        </Button>
      )}
    </section>
  )
}
