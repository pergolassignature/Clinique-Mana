import { t } from '@/i18n'
import { useModules, useSetModuleEnabled } from '@/core/modules/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'

/**
 * Paramètres → Modules (`modules.manage`): one switch per module, with the modules it requires.
 * While a change saves, every switch is inactive (`aria-disabled`, so the one just pressed keeps
 * focus): modules depend on each other, and the server checks against the committed state.
 */
export function ModulesSettingsPage() {
  const { data: modules, isPending, isError, refetch, isFetching } = useModules()
  const setEnabled = useSetModuleEnabled()
  const nameByKey = new Map(modules?.map((m) => [m.key, m.name]))
  const pending = setEnabled.isPending
  const saving = pending ? setEnabled.variables : undefined

  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={t('settings.sections.modules')} description={t('settings.modules.description')} fullWidthDescription />
      {isPending ? (
        <Loading />
      ) : isError && !modules ? (
        <LoadError message={t('settings.modules.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {modules?.map((m) => {
            const switchId = `module-${m.key}-switch`
            const dependsOnId = `module-${m.key}-depends-on`
            const hasDependencies = m.depends_on.length > 0
            return (
              <li key={m.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div>
                  <Label htmlFor={switchId}>{m.name}</Label>
                  {hasDependencies && (
                    <p id={dependsOnId} className="text-xs text-muted-foreground">
                      {t('settings.modules.dependsOn')} {m.depends_on.map((key) => nameByKey.get(key) ?? key).join(', ')}
                    </p>
                  )}
                </div>
                {/* Optimistic: the switch shows the requested state while saving. */}
                <Switch
                  checked={saving?.key === m.key ? saving.enabled : m.enabled}
                  aria-disabled={pending || undefined}
                  className={cn(pending && 'cursor-progress')}
                  onCheckedChange={(checked) => {
                    if (!pending) setEnabled.mutate({ key: m.key, enabled: checked })
                  }}
                  id={switchId}
                  aria-describedby={hasDependencies ? dependsOnId : undefined}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
