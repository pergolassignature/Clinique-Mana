# Data Contract — auth-foundation

Module: auth-foundation
Version: 1.0
Last Updated: 2026-01-18
Status: APPROVED

---

## 1. Goal

Establish the minimal identity and role foundation that all subsequent Clinique MANA modules depend on. This contract defines:
- How users are identified in the application layer
- How roles (admin, staff, provider) are assigned and enforced
- The access control foundation for RLS policies

This module does NOT define business entities (clients, intake, assignments, billing). Those belong to their respective module contracts.

---

## 2. Scope

### IN SCOPE
- App-level profile linked to Supabase `auth.users`
- Role assignment (admin, staff, provider)
- Profile status (active, disabled)
- Audit trail for identity/role changes
- Foundation for RLS policies

### OUT OF SCOPE
- Client records (→ clients module)
- Intake/consent (→ intake module)
- Professional availability (→ availability module)
- Client-to-provider assignments (→ matching module)
- Billing/compensation (→ billing module)
- Multi-factor authentication configuration
- Password policies (handled by Supabase Auth)
- Session management (handled by Supabase Auth)

---

## 3. Actors & Roles

Per `docs/standards/security.model.md`, the platform has three roles:

| Role | Description | Typical User |
|------|-------------|--------------|
| `admin` | Full platform access. Manages users, views all data, configures system. | Clinic administrator, owner |
| `staff` | Triage and operations. Handles intake, assigns clients, views platform data. Cannot access clinical notes. | Intake coordinator, receptionist |
| `provider` | Mental health professional. Sees only assigned clients. Owns clinical relationship. | Psychologist, therapist, counselor |

**Role hierarchy (for reference only):**
- admin > staff > provider (in terms of platform data access)
- Provider has exclusive access to clinical content (not stored by platform)

---

## 4. Entities

### 4.1 `profiles`

Application-layer identity linked to Supabase `auth.users`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | Profile identifier |
| `user_id` | `uuid` | UNIQUE, NOT NULL, FK → auth.users(id) ON DELETE CASCADE | Link to Supabase auth |
| `role` | `text` | NOT NULL, CHECK (role IN ('admin', 'staff', 'provider')) | Single role assignment |
| `display_name` | `text` | NOT NULL | Full name for UI display |
| `email` | `text` | NOT NULL | Denormalized from auth.users for convenience |
| `status` | `text` | NOT NULL, DEFAULT 'active', CHECK (status IN ('active', 'disabled')) | Account status |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | Record creation |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | Last modification |

**Indexes:**
- `profiles_user_id_idx` on `user_id` (for auth lookups)
- `profiles_role_idx` on `role` (for role-based queries)
- `profiles_status_idx` on `status` (for active user queries)

**Design Decision: Single Role Column**

Rationale for using a single `role` column vs. a join table:
1. The security model defines exactly 3 mutually exclusive roles
2. A user is either admin OR staff OR provider — not combinations
3. Simpler RLS policies: `(SELECT role FROM profiles WHERE user_id = auth.uid())`
4. No join required for role checks in every query
5. If multi-role is needed later, migration to join table is straightforward

If the answer to "Can a user have multiple roles?" in Open Questions is YES, this design must change to a `profile_roles` join table.

### 4.2 `profile_audit_log`

Immutable log of identity and role changes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | Log entry identifier |
| `profile_id` | `uuid` | NOT NULL, FK → profiles(id) ON DELETE CASCADE | Target profile |
| `actor_id` | `uuid` | NULL, FK → profiles(id) | Who made the change (NULL for system) |
| `action` | `text` | NOT NULL | Action type: 'created', 'role_changed', 'status_changed', 'updated' |
| `old_value` | `jsonb` | NULL | Previous state (relevant fields only) |
| `new_value` | `jsonb` | NULL | New state (relevant fields only) |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | When the change occurred |

**Constraints:**
- Table is append-only (no UPDATE, no DELETE via RLS)
- No clinical content stored (per platform rules)

---

## 5. Security & Access Rules

All rules follow the principle: **default deny, explicit allow**.

### 5.1 Profile Read Access

| Actor | Can Read | Condition |
|-------|----------|-----------|
| admin | All profiles | Always |
| staff | All profiles | Always (needed for intake/matching operations) |
| provider | Own profile only | `profiles.user_id = auth.uid()` |
| unauthenticated | None | Denied |

### 5.2 Profile Write Access

| Actor | Can Create | Can Update | Condition |
|-------|------------|------------|-----------|
| admin | Yes (any) | Yes (any) | No restrictions |
| staff | No | Own profile only (display_name) | Cannot change role or status |
| provider | No | Own profile only (display_name) | Cannot change role or status |
| unauthenticated | No | No | Denied |

**Profile creation flow:**
1. User signs up via Supabase Auth (creates `auth.users` record)
2. Admin creates corresponding `profiles` record with assigned role
3. Alternatively: trigger creates profile with default role (see Open Questions)

### 5.3 Role Change Access

| Actor | Can Change Roles | Condition |
|-------|------------------|-----------|
| admin | Yes | Can set any role on any profile |
| staff | No | Denied |
| provider | No | Denied |

**Privilege escalation prevention:**
- Only admin can modify the `role` column
- RLS policy: `UPDATE profiles SET role = ... WHERE (SELECT role FROM profiles WHERE user_id = auth.uid()) = 'admin'`
- Admins cannot demote themselves if they are the last admin (application-level check, not DB constraint)

### 5.4 Status Change Access

| Actor | Can Change Status | Condition |
|-------|-------------------|-----------|
| admin | Yes | Can activate/disable any profile |
| staff | No | Denied |
| provider | No | Denied |

### 5.5 Audit Log Access

| Actor | Can Read | Can Write |
|-------|----------|-----------|
| admin | Yes | Yes (via triggers only) |
| staff | No | No |
| provider | No | No |

Audit writes happen via database triggers, not direct INSERT.

---

## 6. Audit Requirements

Per `docs/standards/security.model.md`: "Writes always audited."

### 6.1 Events to Audit

| Event | Trigger | Data Captured |
|-------|---------|---------------|
| Profile created | INSERT on profiles | actor_id, new profile data |
| Role changed | UPDATE on profiles.role | actor_id, old role, new role |
| Status changed | UPDATE on profiles.status | actor_id, old status, new status |
| Display name changed | UPDATE on profiles.display_name | actor_id, old name, new name |
| Profile deleted | DELETE on profiles | actor_id, deleted profile data |

### 6.2 Audit Data Format

```json
{
  "old_value": { "role": "staff" },
  "new_value": { "role": "admin" }
}
```

### 6.3 Retention

Audit logs are retained indefinitely (no automatic purge). Manual purge requires explicit admin action and separate audit trail.

---

## 7. Lifecycle (Statuses)

### 7.1 Profile Status

| Status | Description | Can Login | Visible in Lists |
|--------|-------------|-----------|------------------|
| `active` | Normal operating state | Yes | Yes |
| `disabled` | Account suspended | No (enforced at app layer) | Yes (with indicator) |

**Status transitions:**
```
[created] → active → disabled → active (re-enabled)
                   ↘ [deleted] (hard delete, rare)
```

### 7.2 Disabling vs. Deleting

- **Disable:** Preferred method. Preserves audit trail, historical references.
- **Delete:** Only for test accounts or GDPR-style requests. Cascades to audit log. Breaks historical references.

---

## 8. Example Records

### 8.1 Admin User

```sql
-- auth.users (managed by Supabase)
-- id: '11111111-1111-1111-1111-111111111111'
-- email: 'admin@cliniquemana.ca'

-- profiles
INSERT INTO profiles (id, user_id, role, display_name, email, status)
VALUES (
  'aaaa1111-aaaa-1111-aaaa-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'admin',
  'Marie-Claire Tremblay',
  'admin@cliniquemana.ca',
  'active'
);
```

### 8.2 Staff User

```sql
-- auth.users
-- id: '22222222-2222-2222-2222-222222222222'
-- email: 'intake@cliniquemana.ca'

-- profiles
INSERT INTO profiles (id, user_id, role, display_name, email, status)
VALUES (
  'bbbb2222-bbbb-2222-bbbb-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'staff',
  'Sophie Gagnon',
  'intake@cliniquemana.ca',
  'active'
);
```

### 8.3 Provider User

```sql
-- auth.users
-- id: '33333333-3333-3333-3333-333333333333'
-- email: 'dr.lavoie@cliniquemana.ca'

-- profiles
INSERT INTO profiles (id, user_id, role, display_name, email, status)
VALUES (
  'cccc3333-cccc-3333-cccc-333333333333',
  '33333333-3333-3333-3333-333333333333',
  'provider',
  'Dr. François Lavoie',
  'dr.lavoie@cliniquemana.ca',
  'active'
);
```

### 8.4 Disabled Provider

```sql
-- profiles
INSERT INTO profiles (id, user_id, role, display_name, email, status)
VALUES (
  'dddd4444-dddd-4444-dddd-444444444444',
  '44444444-4444-4444-4444-444444444444',
  'provider',
  'Dr. Anne Bergeron',
  'dr.bergeron@cliniquemana.ca',
  'disabled'
);
```

---

## 9. Open Questions

The following questions require product/business decisions before finalizing this contract:

### 9.1 Multi-Organization

> **Do we need multi-org or single-org?**

Current assumption: Single organization (Clinique MANA is one entity). If multi-org is required, we need:
- `organizations` table
- `organization_id` FK on profiles
- Scoped RLS policies

### 9.2 Provider Supervisors

> **Do we need provider supervisors?**

Some mental health settings require supervision relationships (e.g., interns supervised by licensed professionals). If needed:
- `supervisor_id` FK on profiles (self-referential)
- Or separate `supervision_assignments` table

### 9.3 Multiple Roles

> **Can a user have multiple roles?**

Current assumption: No. A user is exactly one of admin/staff/provider. If yes:
- Replace `role` column with `profile_roles` join table
- Update all RLS policies to check role membership

### 9.4 Account Deactivation Flow

> **How do we deactivate accounts?**

Options to clarify:
- Who initiates? (admin only, or self-service?)
- Is there a grace period?
- Do we notify the user?
- What happens to in-progress work? (e.g., provider with assigned clients)

### 9.5 Default Role on Signup

> **Should new signups get a default role, or require admin assignment?**

Options:
- A) No auto-profile: Admin must manually create profile after auth signup
- B) Auto-profile with 'pending' status: User exists but cannot do anything until admin approves
- C) Auto-profile with default role: Risky without invitation flow

### 9.6 Invitation Flow

> **Do we need an invitation system?**

If users should only join via invitation (not open signup):
- `invitations` table with email, intended_role, expiry
- Signup validates against pending invitation

### Decisions (2026-01-18)

| Question | Decision |
|----------|----------|
| 9.1 Multi-org? | **Single-org.** No organizations table. |
| 9.2 Supervisors? | **No.** Out of scope for foundation. |
| 9.3 Multiple roles? | **No.** Single role per user (admin/staff/provider). |
| 9.4 Deactivation flow? | **Admin-only.** Admin can disable/enable accounts. |
| 9.5 Default role on signup? | **No auto-profile.** Admin manually creates profiles record. |
| 9.6 Invitation system? | **Deferred.** Out of scope for this module. |

---

## 10. Acceptance Criteria

This contract is APPROVED when:

- [x] All Open Questions have been answered or explicitly deferred
- [x] Security model alignment confirmed (admin, staff, provider roles)
- [x] Single-role vs. multi-role decision finalized
- [x] Account deactivation flow documented
- [x] Audit requirements confirmed as sufficient
- [x] Product owner sign-off received

**Contract approved: 2026-01-18**

**Next steps:**
- Gate 2: Create schema migration
- Gate 3: Create RLS policies
- Do not deviate from this contract without updating it first

---

## References

- docs/standards/security.model.md
- docs/standards/platform.model.md
- docs/standards/do-not-do.md
