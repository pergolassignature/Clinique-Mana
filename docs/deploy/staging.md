# Supabase Staging Deployment — Clinique MANA

This guide deploys migrations to the staging Supabase project.

---

## Staging Project

| Property | Value |
|----------|-------|
| URL | https://vnmbjbdsjxmpijyjmmkh.supabase.co |
| Anon Key | sb_publishable_6J5OXiU8l9p0sGkTQtLldw_tK3bB1vp |

---

## Prerequisites

- Supabase CLI installed (`supabase --version`)
- Access to the Supabase dashboard for this project
- Database password (from dashboard)

---

## Step 1: Get Project Reference

The **Project Ref** is the subdomain of your Supabase URL.

From `https://vnmbjbdsjxmpijyjmmkh.supabase.co`:
- **Project Ref:** `vnmbjbdsjxmpijyjmmkh`

You can also find it in the Supabase Dashboard:
1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **General**
4. Copy the **Reference ID**

---

## Step 2: Login to Supabase CLI

```bash
supabase login
```

This opens a browser to authenticate. Follow the prompts.

---

## Step 3: Link Project

From the project root:

```bash
cd /path/to/Clinique-Mana

supabase link --project-ref vnmbjbdsjxmpijyjmmkh
```

You'll be prompted for the **database password**. Find it in:
- Dashboard → Settings → Database → Connection string → Password

---

## Step 4: Push Migrations

Preview what will be applied:

```bash
supabase db diff
```

Apply migrations to staging:

```bash
supabase db push
```

This applies all migrations in `supabase/migrations/` that haven't been applied yet.

### Current Migrations

| File | Description |
|------|-------------|
| `20260118000001_auth_foundation_schema.sql` | profiles + audit tables |
| `20260118000002_auth_foundation_rls.sql` | RLS policies |

---

## Step 5: Run RLS Tests on Staging

### Get Connection String

1. Dashboard → Settings → Database
2. Copy the **Connection string** (URI format)
3. It looks like: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### Run Tests

```bash
# Replace with your actual connection string from dashboard
psql "postgresql://postgres.vnmbjbdsjxmpijyjmmkh:[YOUR_PASSWORD]@aws-0-ca-central-1.pooler.supabase.com:6543/postgres" \
  -f tests/rls/auth-foundation.sql
```

**DO NOT hardcode the password in scripts or commit it.**

### Expected Output

All tests should output `PASSED`:
- `TEST N1 PASSED` through `TEST N13 PASSED` (negative tests)
- `TEST P1 PASSED` through `TEST P11 PASSED` (positive tests)

Any `FAILED` message requires investigation before proceeding.

---

## Step 6: Manual Smoke Test in Studio

Open Supabase Studio:
- URL: https://supabase.com/dashboard/project/vnmbjbdsjxmpijyjmmkh

### Checklist

- [ ] **Tables exist:** Navigate to Table Editor
  - [ ] `profiles` table exists
  - [ ] `profile_audit_log` table exists

- [ ] **Columns correct:** Check `profiles` schema
  - [ ] `id` (uuid, PK)
  - [ ] `user_id` (uuid, unique, FK to auth.users)
  - [ ] `role` (text, check constraint)
  - [ ] `display_name` (text)
  - [ ] `email` (text)
  - [ ] `status` (text, default 'active')
  - [ ] `created_at` (timestamptz)
  - [ ] `updated_at` (timestamptz)

- [ ] **RLS enabled:** Check both tables
  - [ ] `profiles` → RLS enabled (green shield icon)
  - [ ] `profile_audit_log` → RLS enabled

- [ ] **Policies exist:** Authentication → Policies
  - [ ] `profiles_select_admin`
  - [ ] `profiles_select_staff`
  - [ ] `profiles_select_provider_own`
  - [ ] `profiles_insert_admin_only`
  - [ ] `profiles_update_admin`
  - [ ] `profiles_update_staff_own`
  - [ ] `profiles_update_provider_own`
  - [ ] `profiles_delete_admin_only`
  - [ ] `audit_log_select_admin_only`

- [ ] **Functions exist:** Database → Functions
  - [ ] `set_updated_at()`
  - [ ] `audit_profile_changes()`
  - [ ] `get_my_role()`

- [ ] **Triggers exist:** Check `profiles` table triggers
  - [ ] `profiles_set_updated_at`
  - [ ] `profiles_audit_trigger`

---

## Step 7: Create Test Users (Optional)

If you want to test auth flows on staging, create users via Dashboard:

1. Authentication → Users → Add user
2. Create test users with roles:
   - Admin: `staging-admin@cliniquemana.ca`
   - Staff: `staging-staff@cliniquemana.ca`
   - Provider: `staging-provider@cliniquemana.ca`

Then create corresponding profiles via SQL Editor:

```sql
-- After creating auth users, get their IDs and create profiles
INSERT INTO public.profiles (user_id, role, display_name, email, status)
VALUES
  ('<admin-user-id>', 'admin', 'Staging Admin', 'staging-admin@cliniquemana.ca', 'active'),
  ('<staff-user-id>', 'staff', 'Staging Staff', 'staging-staff@cliniquemana.ca', 'active'),
  ('<provider-user-id>', 'provider', 'Staging Provider', 'staging-provider@cliniquemana.ca', 'active');
```

---

## Rollback (if needed)

If migrations cause issues:

1. **Do NOT edit applied migrations**
2. Create a new corrective migration:
   ```bash
   supabase migration new fix_issue_name
   ```
3. Write SQL to fix the issue
4. Push the fix:
   ```bash
   supabase db push
   ```

---

## Production Promotion

After staging validation passes:

1. Create production Supabase project
2. Link: `supabase link --project-ref <PROD_REF>`
3. Push: `supabase db push`
4. Run smoke tests
5. Update frontend environment variables

---

## Troubleshooting

### "Migration already applied"
This is normal. Only unapplied migrations are pushed.

### "Permission denied"
Check that you're logged in: `supabase login`

### "Connection refused"
Verify project ref is correct and project is active.

### RLS test failures
- Check that policies were created correctly
- Verify `get_my_role()` function exists
- Test with different user contexts in Studio

---

## References

- [Supabase CLI - Database Commands](https://supabase.com/docs/reference/cli/supabase-db)
- [Managing Migrations](https://supabase.com/docs/guides/cli/managing-migrations)
- [Deploying with CLI](https://supabase.com/docs/guides/cli/deploying-with-cli)
