import { useState } from 'react'
import { t } from '@/i18n'
import { SaveButton } from '@/shared/components/SaveButton'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Radio } from '@/shared/ui/radio'
import type { Population } from '../../api/consents'
import { usePublishConsentVersion } from '../../hooks/use-consents'

const S = 'modules.clients.consents.settings.texts'

/**
 * « Publier la version N » of a consent text (R-49, CC-21), said before it happens: the next
 * requests use this version, the signed consents keep theirs; who must sign it again (« nouveaux
 * clients seulement » by default, every time; a first publication has nobody to ask again); that
 * the clients already signed are asked through « Nouvelles signatures »; and that nothing reaches a
 * client while Clients is reserved for its testers (P3-40).
 */
export function PublishConsentDialog({
  versionId,
  version,
  name,
  language,
  first,
  onClose,
}: {
  versionId: string
  version: number
  name: string
  language: 'fr' | 'en'
  first: boolean
  onClose: () => void
}) {
  const [population, setPopulation] = useState<Population>('new_clients')
  const publish = usePublishConsentVersion()
  const chosen = first ? 'new_clients' : population
  const languageName = t(language === 'en' ? `${S}.english` : `${S}.french`).toLocaleLowerCase('fr-CA')
  return (
    <Dialog open onOpenChange={(open) => !open && !publish.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${S}.publishTitle`, { version: String(version), name, language: languageName })}</DialogTitle>
          <DialogDescription>{t(first ? `${S}.publishFirst` : `${S}.publishHelp`)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (publish.isPending) return
            publish.mutate({ versionId, population: chosen }, { onSuccess: onClose })
          }}
        >
          {!first && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">{t(`${S}.whoSigns`)}</legend>
              {(['new_clients', 'all_active'] as const).map((value) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <Radio name="population" value={value} checked={chosen === value} onChange={() => setPopulation(value)} className="mt-0.5" />
                  <span>
                    <span className="block font-medium text-foreground">{t(value === 'new_clients' ? `${S}.newClients` : `${S}.allActive`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(value === 'new_clients' ? `${S}.newClientsHelp` : `${S}.allActiveHelp`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {!first && chosen === 'all_active' && <li>{t(`${S}.campaignNote`)}</li>}
            <li>{t(`${S}.testersNote`)}</li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <SaveButton pending={publish.isPending} label={t(`${S}.confirm`, { version: String(version) })} pendingLabel={t(`${S}.publishing`)} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
