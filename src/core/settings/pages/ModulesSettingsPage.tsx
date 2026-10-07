import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useModules, useSetModuleEnabled } from '@/core/modules/hooks'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { toast } from '@/shared/ui/sonner'

export function ModulesSettingsPage() {
  const { data: modules, isPending, isError, refetch, isFetching } = useModules()
  const setEnabled = useSetModuleEnabled()

  const handleToggle = (key: string, enabled: boolean) => {
    setEnabled.mutate(
      { key, enabled },
      {
        onSuccess: () => toast.success(t('settings.modules.saved')),
        onError: (error) => toast.error(moduleErrorMessage(error, t('settings.modules.error'))),
      },
    )
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold">{t('settings.modules.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.modules.description')}</p>
      {isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError && !modules ? (
        <div role="alert" className="mt-6 flex items-center gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.modules.loadError')}</p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {modules?.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{m.name}</p>
                {m.depends_on.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('settings.modules.dependsOn')} {m.depends_on.join(', ')}</p>
                )}
              </div>
              {/* All switches wait for a pending change: modules depend on each other, and the
                  server checks dependencies against the committed state. */}
              <Switch
                checked={m.enabled}
                disabled={setEnabled.isPending}
                onCheckedChange={(checked) => handleToggle(m.key, checked)}
                aria-label={m.name}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
