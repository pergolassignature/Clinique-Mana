/** Apple keyboards use ⌘ for app shortcuts; the others use Ctrl. Read on demand (tests can stub it). */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

/** The palette shortcut as this keyboard writes it. */
export function paletteShortcutLabel(): string {
  return isApplePlatform() ? '⌘K' : 'Ctrl K'
}

/** ⌘K on Apple keyboards, Ctrl+K elsewhere (by key position, so it works on any layout). */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (event.code !== 'KeyK' || event.altKey || event.shiftKey) return false
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}
