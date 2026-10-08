import { t } from '@/i18n'
import type { PermissionGroup } from '../permissions'

/** A permission group's heading: « Général » for core (its database name « Noyau » is technical), else the module's name. */
export function permissionGroupName(group: Pick<PermissionGroup<unknown>, 'key' | 'name'>): string {
  return group.key === 'core' ? t('settings.users.sheet.permissions.coreGroup') : group.name
}
