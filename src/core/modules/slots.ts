import { createContext, useContext } from 'react'
import type { ModuleSlotItem, ModuleSlotName } from './types'

/**
 * What a host gives its slot's panels when the route does not say it (a sheet over a page): the
 * appointment the sheet shows (`appointment.sheet`, L10). The host wraps its panels in
 * `ModuleSlotTargetContext.Provider`; a panel reads it with `useSlotTarget`.
 */
export interface ModuleSlotTargets {
  'appointment.sheet': { appointmentId: string }
}

export const ModuleSlotTargetContext = createContext<Partial<ModuleSlotTargets>>({})

/** The target the host gave this slot's panels; null outside its host. */
export function useSlotTarget<K extends keyof ModuleSlotTargets>(name: K): ModuleSlotTargets[K] | null {
  return useContext(ModuleSlotTargetContext)[name] ?? null
}

/**
 * The panels the enabled modules add to another module's screen, by slot, already filtered to
 * what the signed-in user may see (AuthenticatedApp provides them; core never imports a module,
 * and a module never imports one it does not depend on). Empty outside the shell, as in a test
 * that does not provide it.
 */
export const ModuleSlotsContext = createContext<Partial<Record<ModuleSlotName, readonly ModuleSlotItem[]>>>({})

/** The panels of a slot, in the modules' order. */
export function useModuleSlot(name: ModuleSlotName): readonly ModuleSlotItem[] {
  return useContext(ModuleSlotsContext)[name] ?? []
}
