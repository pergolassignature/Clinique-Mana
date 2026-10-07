import { createContext, useContext } from 'react'
import type { SettingsSection } from '@/core/modules/types'

export interface SettingsSectionState {
  section: SettingsSection
  /** The user can see the section but lacks its `editPermission`: show the notice once, render the fields read-only (never disabled). */
  readOnly: boolean
}

/** Provided by SettingsLayout around each section's page. */
export const SettingsSectionContext = createContext<SettingsSectionState | null>(null)

/** The open settings section and whether the user may only read it. Only inside SettingsLayout. */
export function useSettingsSection(): SettingsSectionState {
  const value = useContext(SettingsSectionContext)
  if (!value) throw new Error('useSettingsSection must be used inside a SettingsLayout section')
  return value
}

/** Seen but not editable: the section names an edit permission the user lacks. */
export function isSectionReadOnly(section: Pick<SettingsSection, 'editPermission'>, can: (permission: string) => boolean): boolean {
  return section.editPermission !== undefined && !can(section.editPermission)
}
