import { useId, useState } from 'react'
import { t, type TranslationKey } from '@/i18n'
import { LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'
import type { ProfessionalsSettings } from '../../api/parse'
import { useProfessionalsSettings, useSaveProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { RefusalAlert } from '../compensation/DatedRowParts'

const N = 'modules.professionals.settings.fiche'

type FicheOption = 'ficheShowProContact' | 'ficheShowClinicFooter' | 'ficheShowClosing'

/** The three render options of the v2 design (P4-353), in the fiche's reading order. */
const OPTIONS = [
  { key: 'ficheShowProContact', label: `${N}.showProContact`, help: `${N}.showProContactHelp` },
  { key: 'ficheShowClinicFooter', label: `${N}.showClinicFooter`, help: `${N}.showClinicFooterHelp` },
  { key: 'ficheShowClosing', label: `${N}.showClosing`, help: `${N}.showClosingHelp` },
] as const satisfies readonly { key: FicheOption; label: TranslationKey; help: TranslationKey }[]

/**
 * « Ce que la fiche affiche » (Paramètres → Fiche PDF, P4-353): three switches, each saved at
 * once (`professionals.settings`); read-only for whoever only reads the section. The next fiche
 * made, downloaded or emailed, follows them. A failed read shows « Réessayer », never switches
 * that would read « on » without knowing.
 */
export function FicheOptionsCard({ readOnly }: { readOnly: boolean }) {
  const settings = useProfessionalsSettings()
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveProfessionalsSettings({ onErrorMessage: (message) => setRefusal(message) })
  const id = useId()
  const pending = save.isPending
  const inactive = readOnly || pending || !settings.data

  const shown = (key: FicheOption): boolean => {
    const sent = pending ? (save.variables as Partial<ProfessionalsSettings> | undefined)?.[key] : undefined
    return sent ?? settings.data?.[key] ?? true
  }

  return (
    <SettingsCard as="section" title={t(`${N}.cardTitle`)} description={t(`${N}.cardDescription`)}>
      {settings.isError && !settings.data ? (
        <LoadError message={t(`${N}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="space-y-4">
          {OPTIONS.map((option) => (
            <div key={option.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor={`${id}-${option.key}`}>{t(option.label)}</Label>
                <p id={`${id}-${option.key}-help`} className="text-xs text-muted-foreground">
                  {t(option.help)}
                </p>
              </div>
              <Switch
                id={`${id}-${option.key}`}
                checked={shown(option.key)}
                aria-describedby={`${id}-${option.key}-help`}
                aria-disabled={inactive || undefined}
                className={cn('mt-0.5', pending && 'cursor-progress', readOnly && 'cursor-default')}
                onCheckedChange={(checked) => {
                  if (inactive) return
                  setRefusal(null)
                  save.mutate({ [option.key]: checked })
                }}
              />
            </div>
          ))}
        </div>
      )}
      {refusal && <RefusalAlert message={refusal} />}
    </SettingsCard>
  )
}
