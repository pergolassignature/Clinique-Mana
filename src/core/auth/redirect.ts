export function safeRedirect(target: string | null): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target
  return '/accueil'
}
