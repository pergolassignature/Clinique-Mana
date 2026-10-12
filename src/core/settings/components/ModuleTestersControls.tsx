import { useId } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { t } from '@/i18n'
import type { ModuleTesters } from '@/core/modules/testers-api'
import {
  useAddModuleTester,
  useRemoveModuleTester,
  useSetModuleTestersOnly,
} from '@/core/modules/testers-hooks'
import type { OrgUser } from '@/core/users/api'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'

const T = 'settings.modules.testers'

interface ModuleTestersControlsProps {
  moduleKey: string
  moduleName: string
  /** The module's flag and testers; undefined while they load or for a module never toggled. */
  testers: ModuleTesters | undefined
  /** The clinic's users (names and status); undefined when they cannot be read (no users.view). */
  users: readonly OrgUser[] | undefined
}

/**
 * « Réservé aux testeurs » (R-72), under a module's switch: on, only the listed testers see the
 * module (the administration too only when listed); the list names each tester with « Retirer »,
 * and « Ajouter un testeur » offers the clinic's active users not listed yet. While a change saves,
 * the controls are inactive (`aria-disabled`, focus kept).
 */
export function ModuleTestersControls({
  moduleKey,
  moduleName,
  testers,
  users,
}: ModuleTestersControlsProps) {
  const switchId = useId()
  const helpId = useId()
  const pickerId = useId()
  const setTestersOnly = useSetModuleTestersOnly()
  const add = useAddModuleTester()
  const remove = useRemoveModuleTester()
  const pending = setTestersOnly.isPending || add.isPending || remove.isPending

  const testersOnly = setTestersOnly.isPending
    ? setTestersOnly.variables.testersOnly
    : (testers?.testersOnly ?? false)
  const testerIds = testers?.testerIds ?? []
  const nameOf = (userId: string) =>
    users?.find((u) => u.user_id === userId)?.display_name ??
    t(`${T}.unknownUser`)
  const candidates = (users ?? []).filter(
    (u) => u.status === 'active' && !testerIds.includes(u.user_id)
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={switchId} className="text-xs font-normal">
            {t(`${T}.label`)}
          </Label>
          {/* The explanation only where it applies: a page of modules stays readable. */}
          {testersOnly && (
            <p id={helpId} className="text-xs text-muted-foreground">
              {t(`${T}.help`)}
            </p>
          )}
        </div>
        <Switch
          id={switchId}
          checked={testersOnly}
          aria-describedby={testersOnly ? helpId : undefined}
          aria-label={t(`${T}.switchLabel`, { module: moduleName })}
          aria-disabled={pending || undefined}
          className={cn(pending && 'cursor-progress')}
          onCheckedChange={(checked) => {
            if (!pending)
              setTestersOnly.mutate({ key: moduleKey, testersOnly: checked })
          }}
        />
      </div>
      {testersOnly && (
        <div className="space-y-2">
          {testerIds.length === 0 ? (
            <Alert variant="warning" role="status">
              <TriangleAlert aria-hidden />
              <AlertDescription className="text-foreground">
                {t(`${T}.none`)}
              </AlertDescription>
            </Alert>
          ) : (
            <ul
              aria-label={t(`${T}.listLabel`, { module: moduleName })}
              className="flex flex-wrap gap-1.5"
            >
              {testerIds.map((userId) => (
                <li key={userId}>
                  <Badge variant="secondary" className="gap-1 pr-0.5">
                    {nameOf(userId)}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-5"
                      aria-label={t(`${T}.remove`, { name: nameOf(userId) })}
                      aria-disabled={pending || undefined}
                      onClick={() =>
                        !pending && remove.mutate({ key: moduleKey, userId })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {users === undefined ? (
            <p className="text-xs text-muted-foreground">{t(`${T}.noUsers`)}</p>
          ) : (
            candidates.length > 0 && (
              <div className="max-w-xs">
                <label htmlFor={pickerId} className="sr-only">
                  {t(`${T}.add`)}
                </label>
                <Select
                  id={pickerId}
                  value=""
                  placeholder={t(`${T}.add`)}
                  aria-disabled={pending || undefined}
                  onChange={(event) => {
                    const userId = event.target.value
                    if (userId && !pending)
                      add.mutate({ key: moduleKey, userId })
                  }}
                >
                  {candidates.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.role_name
                        ? t(`${T}.option`, {
                            name: u.display_name,
                            role: u.role_name,
                          })
                        : u.display_name}
                    </option>
                  ))}
                </Select>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
