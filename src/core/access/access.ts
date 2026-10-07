import { z } from 'zod'

/** Roles live in the `roles` table (admin, staff, provider, and any custom role). */
export type AppRole = string

// Ids are plain strings: seeded/test UUIDs are not RFC-versioned.
const accessSchema = z.object({
  user_id: z.string(),
  org_id: z.string(),
  org_name: z.string(),
  org_timezone: z.string(),
  display_name: z.string(),
  email: z.string(),
  // Must stay in sync with the profiles.status check constraint.
  status: z.enum(['active', 'disabled']),
  role: z.string().nullable(),
  permissions: z.array(z.string()),
  /** The org's enabled module keys (empty unless the profile is active). */
  modules: z.array(z.string()),
})

export type Access = z.infer<typeof accessSchema> & { role: AppRole }
export type AccessProblem = 'profile_not_found' | 'profile_disabled' | 'no_role'
export type AccessResult = { access: Access } | { problem: AccessProblem }

/** Interprets the get_my_access() RPC payload. Throws if the shape is unexpected. */
export function parseAccess(raw: unknown): AccessResult {
  if (raw === null || raw === undefined) return { problem: 'profile_not_found' }
  const parsed = accessSchema.parse(raw)
  if (parsed.status === 'disabled') return { problem: 'profile_disabled' }
  if (parsed.role === null) return { problem: 'no_role' }
  return { access: parsed as Access }
}

export function can(access: Access | null, permission: string): boolean {
  return access?.permissions.includes(permission) ?? false
}
