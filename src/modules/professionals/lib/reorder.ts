/**
 * « Monter » / « Descendre » in a settings list. The order is global to the list (archived rows
 * included, `reorderReference` takes every id), but the user moves a row among the rows shown
 * (a filter or a search may hide some): the row goes just before the shown row above it, or just
 * after the shown row below it. Hidden rows keep their places relative to each other.
 *
 * Returns the full list's new order, or null when there is no shown row to pass (first or last
 * shown row, or a row that is not shown).
 */
export function moveRow(ids: readonly string[], shown: readonly string[], id: string, direction: 'up' | 'down'): string[] | null {
  const position = shown.indexOf(id)
  if (position === -1) return null
  const neighbour = shown[direction === 'up' ? position - 1 : position + 1]
  if (neighbour === undefined) return null
  const rest = ids.filter((other) => other !== id)
  const at = rest.indexOf(neighbour)
  if (at === -1) return null
  rest.splice(direction === 'up' ? at : at + 1, 0, id)
  return rest
}
