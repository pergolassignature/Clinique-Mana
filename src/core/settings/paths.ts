import type { SettingsSection } from '@/core/modules/types'

/** Where the settings shell is mounted (`parametres/*` in AuthenticatedApp). */
export const SETTINGS_BASE_PATH = '/parametres'

/**
 * Absolute path of a settings section, by its French `path` (decision #24): the menu links
 * (SettingsLayout) and the topbar's breadcrumb (AuthenticatedApp) both use it.
 */
/**
 * Whether `pathname` is `path` or below it, case-insensitively like React Router's matching
 * (/parametres/Identite opens the same section).
 */
export function isUnder(pathname: string, path: string): boolean {
  const location = pathname.toLowerCase()
  const target = path.toLowerCase()
  return location === target || location.startsWith(`${target}/`)
}

export function settingsSectionPath(section: Pick<SettingsSection, 'path'>, basePath: string = SETTINGS_BASE_PATH): string {
  return `${basePath}/${section.path}`
}
