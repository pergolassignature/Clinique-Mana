import type { SettingsSection } from '@/core/modules/types'

/** Where the settings shell is mounted (`parametres/*` in AuthenticatedApp). */
export const SETTINGS_BASE_PATH = '/parametres'

/**
 * Absolute path of a settings section, by its French `path` (decision #24): the menu links
 * (SettingsLayout) and the topbar's breadcrumb (AuthenticatedApp) both use it.
 */
export function settingsSectionPath(section: Pick<SettingsSection, 'path'>, basePath: string = SETTINGS_BASE_PATH): string {
  return `${basePath}/${section.path}`
}
