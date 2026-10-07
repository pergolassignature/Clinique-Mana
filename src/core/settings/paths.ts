import type { SettingsSection } from '@/core/modules/types'

/** Where the settings shell is mounted (`parametres/*` in AuthenticatedApp). */
export const SETTINGS_BASE_PATH = '/parametres'

/**
 * Absolute path of a settings section: the menu links (SettingsLayout) and the topbar's breadcrumb
 * (AuthenticatedApp) both use it. Task 2.5 switches it to the section's French `path`.
 */
export function settingsSectionPath(section: Pick<SettingsSection, 'id'>, basePath: string = SETTINGS_BASE_PATH): string {
  return `${basePath}/${section.id}`
}
