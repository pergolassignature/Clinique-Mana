import type { SettingsGroup, SettingsSection } from '@/core/modules/types'

/** Menu order of the settings groups. */
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['clinique', 'plateforme', 'modules', 'compte']

/**
 * The sections a user can open, in menu order (by group, then registration order). Used by the
 * menu and the routes (SettingsLayout) and by the shell, which shows « Paramètres » only when this
 * is not empty (decision #19).
 */
export function visibleSettingsSections<S extends Pick<SettingsSection, 'group' | 'permission'>>(
  sections: readonly S[],
  can: (permission: string) => boolean,
): S[] {
  return SETTINGS_GROUP_ORDER.flatMap((group) => sections.filter((s) => s.group === group && can(s.permission)))
}
