import { t } from '@/i18n'
import { useModules, useSetModuleEnabled } from '@/core/modules/hooks'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'

export function ModulesSettingsPage() {
  const { data: modules, isPending, isError, refetch, isFetching } = useModules()
  const setEnabled = useSetModuleEnabled()
  const nameByKey = new Map(modules?.map((m) => [m.key, m.name]))
  const saving = setEnabled.isPending ? setEnabled.variables : undefined

  return (
    <div className="max-w-form">
      <h2 className="text-lg font-semibold">{t('settings.modules.title')}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('settings.modules.description')}</p>
      {isPending ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError && !modules ? (
        <div role="alert" className="mt-4 flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('settings.modules.loadError')}</p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
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
                {/* Optimistic: the switch shows the requested state while saving. All switches wait
                    for a pending change: modules depend on each other, and the server checks
                    dependencies against the committed state. */}
                <Switch
                  checked={saving?.key === m.key ? saving.enabled : m.enabled}
                  disabled={setEnabled.isPending}
                  onCheckedChange={(checked) => setEnabled.mutate({ key: m.key, enabled: checked })}
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
