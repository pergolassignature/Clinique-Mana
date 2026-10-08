/**
 * Every character `stored_files.original_name` refuses (20261008071750_core_storage.sql; the
 * storage-upload function refuses the same set, `supabase/functions/_shared/file-name.ts`): `/`,
 * `\`, C0, DEL, C1, the line and paragraph separators and the bidirectional formatting
 * characters. `file-name-parity.test.ts` holds the three to one list. Global: for `replace`.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
export const FORBIDDEN_NAME_CHAR = /[/\\\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
