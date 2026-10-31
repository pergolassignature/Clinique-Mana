import { useId, useState } from 'react'
import { t } from '@/i18n'
import { LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'
import type { ProfessionalsSettings } from '../../api/parse'
import { useProfessionalsSettings, useSaveProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { RefusalAlert } from '../compensation/DatedRowParts'

const S = 'modules.professionals.settings.invitations.contractFirst'

/**
 * « L'entente d'abord » (Paramètres → Invitations, P4-565): when on, an invitation's questionnaire
 * asks only what the service contract needs (« Renseignements personnels » and « Profil
 * professionnel »); the rest is asked once the entente is in force (« Demander le reste du profil »
 * on the record). Saved at once (`professionals.settings`); an invitation already sent keeps its
 * questionnaire. Off by default.
 */
export function ContractFirstCard({ readOnly }: { readOnly: boolean }) {
  const settings = useProfessionalsSettings()
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveProfessionalsSettings({ onErrorMessage: (message) => setRefusal(message) })
  const id = useId()
  const pending = save.isPending
  const inactive = readOnly || pending || !settings.data
  const sent = pending ? (save.variables as Partial<ProfessionalsSettings> | undefined)?.invitationContractFirst : undefined
  const on = sent ?? settings.data?.invitationContractFirst ?? false

  return (
    <SettingsCard as="section" title={t(`${S}.title`)} description={t(`${S}.description`)}>
      {settings.isError && !settings.data ? (
        <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={id}>{t(`${S}.label`)}</Label>
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              {t(`${S}.help`)}
            </p>
          </div>
          <Switch
            id={id}
            checked={on}
            aria-describedby={`${id}-help`}
            aria-disabled={inactive || undefined}
            className={cn('mt-0.5', pending && 'cursor-progress', readOnly && 'cursor-default')}
            onCheckedChange={(checked) => {
              if (inactive) return
              setRefusal(null)
              save.mutate({ invitationContractFirst: checked })
            }}
          />
        </div>
      )}
      {refusal && <RefusalAlert message={refusal} />}
    </SettingsCard>
  )
}
