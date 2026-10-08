/**
 * A field's help on a record tab: it explains how to fill the field in (format, uniqueness, who
 * changes it, the counter), so it is not shown read-only, where nothing can be filled in. One rule
 * for every field of « Profil public » and « Identité et permis ».
 */
export function editingHelp<T>(readOnly: boolean, help: T): T | undefined {
  return readOnly ? undefined : help
}
