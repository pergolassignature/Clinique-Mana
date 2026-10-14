import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { Button } from '@/shared/ui/button'
import { useProfessionalDocuments } from '../../hooks/use-documents'
import { preloadFicheRenderer } from '../../hooks/use-fiche'
import { imageConsentSource } from '../../lib/documents'
import { ficheTitles } from '../../lib/fiche'
import { ProfessionalPhoto } from '../ProfessionalPhoto'
import { FichePreviewDialog } from './FichePreviewDialog'
import { useRecordData } from './record-context'
import { TabLink } from './TabLink'

const P = 'modules.professionals.record.publicProfile.photo'

/**
 * Profil public's first section (gap audit V1 and H3): the photo the fiche prints (the newest
 * verified one, `record.photoFileId`, the `card` copy at 128 px), where it is managed (Documents),
 * whether the fiche may show it (an image consent in force, P4-512, not withdrawn, P4-549, or the service contract's, P4-558: from the documents' read, the
 * one the fiche uses), and « Aperçu de la fiche ». The same for every reader of the tab.
 */
export function PublicPhotoSection() {
  const { record, catalog } = useRecordData()
  const id = record.professional.id
  const documents = useProfessionalDocuments(id)
  const [previewing, setPreviewing] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const name = `${record.professional.firstName} ${record.professional.lastName}`
  // A separate consent, or the service contract's article on image rights (P4-558); undefined while not read.
  const consent = documents.data ? imageConsentSource(documents.data) : undefined
  const hasPhoto = record.photoFileId !== null

  return (
    <SettingsCard as="section" layout="section" title={t(`${P}.title`)} description={t(`${P}.description`)}>
      <div className="flex flex-wrap items-start gap-4">
        <ProfessionalPhoto fileId={record.photoFileId} alt={t(`${P}.alt`, { name })} size={128} />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-foreground">
            {t(hasPhoto ? `${P}.verified` : `${P}.none`)}{' '}
            <TabLink id={id} tab="documents">
              {t(`${P}.manage`)}
            </TabLink>
          </p>
          {hasPhoto && consent !== undefined && (
            <p className="text-muted-foreground">
              {t(consent === 'document' ? `${P}.consentOnFile` : consent === 'contract' ? `${P}.consentByContract` : `${P}.noConsent`)}
            </p>
          )}
          <Button
            ref={button}
            type="button"
            variant="outline"
            onPointerEnter={preloadFicheRenderer}
            onFocus={preloadFicheRenderer}
            onClick={() => setPreviewing(true)}
          >
            <Eye aria-hidden />
            {t(`${P}.preview`)}
          </Button>
        </div>
      </div>
      <FichePreviewDialog
        open={previewing}
        onClose={() => setPreviewing(false)}
        titles={ficheTitles(record, catalog)}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          button.current?.focus()
        }}
      />
    </SettingsCard>
  )
}
