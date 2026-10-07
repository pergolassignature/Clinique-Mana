import type { ModuleManifest } from './types'

/** Returns the manifests that are enabled and whose dependencies are all enabled too. */
export function resolveEnabledModules(manifests: ModuleManifest[], enabledKeys: ReadonlySet<string>): ModuleManifest[] {
  const byKey = new Map(manifests.map((m) => [m.key, m]))
  const memo = new Map<string, boolean>()

  const isActive = (key: string, visiting: Set<string>): boolean => {
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const manifest = byKey.get(key)
    if (!manifest || !enabledKeys.has(key) || visiting.has(key)) return false
    visiting.add(key)
    const active = manifest.dependsOn.every((dep) => isActive(dep, visiting))
    visiting.delete(key)
    memo.set(key, active)
    return active
  }

  return manifests.filter((m) => isActive(m.key, new Set()))
}
