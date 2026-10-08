import type { SettingsGroup, SettingsSection } from '@/core/modules/types'

/** Menu order of the settings groups. */
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['clinique', 'plateforme', 'modules', 'compte']

/** Whether the user holds the permission, or any one of the permissions (none: false). */
export function canAny(permission: string | readonly string[], can: (permission: string) => boolean): boolean {
  return typeof permission === 'string' ? can(permission) : permission.some((p) => can(p))
}

/** Whether the user may open the section: its permission, or any one of its permissions. */
export function canOpenSection(section: Pick<SettingsSection, 'permission'>, can: (permission: string) => boolean): boolean {
  return canAny(section.permission, can)
}

/**
 * The sections a user can open, in menu order (by group, then registration order). Used by the
 * menu and the routes (SettingsLayout: a section not listed has no route) and by the shell, which
 * shows « Paramètres » only when this is not empty (decision #19).
 */
export function visibleSettingsSections<S extends Pick<SettingsSection, 'group' | 'permission'>>(
  sections: readonly S[],
  can: (permission: string) => boolean,
): S[] {
  return SETTINGS_GROUP_ORDER.flatMap((group) => sections.filter((s) => s.group === group && canOpenSection(s, can)))
}
