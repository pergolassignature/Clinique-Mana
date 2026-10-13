import { createContext, useContext } from 'react'
import type { ModuleSlotItem, ModuleSlotName } from './types'

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
