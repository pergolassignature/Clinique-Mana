import { canAny } from '@/core/access/can-any'
import type { TranslationKey } from '@/i18n'
import type { SettingsArea, SettingsGroup, SettingsSection } from '@/core/modules/types'

/** Menu order of the settings groups. */
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['clinique', 'plateforme', 'modules', 'compte']


/** Whether the user may open the section: its permission, or any one of its permissions. */
export function canOpenSection(section: Pick<SettingsSection, 'permission'>, can: (permission: string) => boolean): boolean {
  return canAny(section.permission, can)
}

/** A `modules` section's heading order: its area's, then « Modules » (no area) last. */
const areaOrder = (s: { area?: SettingsArea }) => s.area?.order ?? Number.MAX_SAFE_INTEGER

/**
 * The sections a user can open, in menu order: by group; inside `modules`, by area (NAV-3), each
 * area's sections in registration order. Used by the menu and the routes (SettingsLayout: a
 * section not listed has no route) and by the shell, which shows « Paramètres » only when this is
 * not empty (decision #19).
 */
export function visibleSettingsSections<S extends Pick<SettingsSection, 'group' | 'permission' | 'area'>>(
  sections: readonly S[],
  can: (permission: string) => boolean,
): S[] {
  return SETTINGS_GROUP_ORDER.flatMap((group) => {
    const inGroup = sections.filter((s) => s.group === group && canOpenSection(s, can))
    // Array.prototype.sort is stable: equal areas keep their registration order.
    return group === 'modules' ? [...inGroup].sort((a, b) => areaOrder(a) - areaOrder(b)) : inGroup
  })
}

/** One heading of the settings menu and its sections. */
export interface SettingsMenuGroup<S> {
  /** `clinique`, `plateforme`, `compte`, `area:<key>` for a module area, or `modules` for sections without one. */
  key: string
  labelKey: TranslationKey
  sections: S[]
}

/**
 * The menu's headings, from sections already in menu order (`visibleSettingsSections`): Clinique,
 * Plateforme, then one heading per module area (« Professionnels », « Facturation »…), « Modules »
 * for a module section without an area, then « Mon compte ».
 */
export function settingsMenuGroups<S extends Pick<SettingsSection, 'group' | 'area'>>(ordered: readonly S[]): SettingsMenuGroup<S>[] {
  const groups: SettingsMenuGroup<S>[] = []
  for (const s of ordered) {
    const key = s.group === 'modules' && s.area ? `area:${s.area.key}` : s.group
    const labelKey: TranslationKey = s.group === 'modules' && s.area ? s.area.labelKey : `settings.groups.${s.group}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.sections.push(s)
    else groups.push({ key, labelKey, sections: [s] })
  }
  return groups
}
