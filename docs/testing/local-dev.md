# Local Development Setup — Clinique MANA

This guide sets up a local Supabase instance for development and testing.

---

## Prerequisites

- Docker Desktop (running)
- Node.js 18+
- macOS, Linux, or WSL2

---

## 1. Install Supabase CLI

### macOS (Homebrew)
```bash
brew install supabase/tap/supabase
```

### npm (cross-platform)
```bash
npm install -g supabase
```

### Verify installation
```bash
supabase --version
```

---

## 2. Initialize Supabase (if not done)

From the project root:

```bash
cd /path/to/Clinique-Mana

# Only if supabase folder doesn't exist
supabase init
```

The project already has:
- `supabase/config.toml` — local configuration
- `supabase/migrations/` — schema and RLS migrations
- `supabase/seed.sql` — test data

---

## 3. Start Local Supabase

```bash
supabase start
```

This starts Docker containers for:
- PostgreSQL (port 54322)
- Supabase API (port 54321)
- Supabase Studio (port 54323)
- Inbucket email (port 54324)

**First run takes a few minutes** to pull Docker images.

### Output

After startup, you'll see:

```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
        anon key: eyJ...
service_role key: eyJ...
```

**Save these values** for frontend configuration.

---

## 4. Apply Migrations

Migrations run automatically on `supabase start`, but you can re-apply:

```bash
supabase db reset
```

This will:
1. Drop and recreate the database
2. Apply all migrations in order
3. Run the seed file

### Current Migrations

| File | Description |
|------|-------------|
| `20260118000001_auth_foundation_schema.sql` | profiles + audit tables |
| `20260118000002_auth_foundation_rls.sql` | RLS policies |

---

## 5. Seed Data

The seed file (`supabase/seed.sql`) creates test users:

| Role | Email | Password |
|------|-------|----------|
| admin | admin@test.cliniquemana.local | testpassword123 |
| staff | staff@test.cliniquemana.local | testpassword123 |
| provider | provider1@test.cliniquemana.local | testpassword123 |
| provider | provider2@test.cliniquemana.local | testpassword123 |

To re-seed without full reset:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed.sql
```

---

## 6. Run RLS Tests

The RLS tests verify access control policies work correctly.

### Run tests manually

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f tests/rls/auth-foundation.sql
```

### Expected output

Tests output `NOTICE` messages:
- `TEST N* PASSED` — negative test (forbidden access denied)
- `TEST P* PASSED` — positive test (allowed access granted)

Any `FAILED` message indicates an RLS policy issue.

---

## 7. Access Supabase Studio

Open [http://127.0.0.1:54323](http://127.0.0.1:54323) to:
- Browse tables
- View data
- Test queries
- Check RLS policies

---

## 8. Connect Frontend

Update your frontend environment (or create `.env.local`):

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase start output>
```

---

## 9. Stop Local Supabase

```bash
supabase stop
```

To stop and remove all data:
```bash
supabase stop --no-backup
```

---

## Common Commands

| Command | Description |
|---------|-------------|
| `supabase start` | Start local instance |
| `supabase stop` | Stop local instance |
| `supabase db reset` | Reset DB + apply migrations + seed |
| `supabase db diff` | Show pending schema changes |
| `supabase migration new <name>` | Create new migration |
| `supabase status` | Show running services |
| `supabase db lint` | Check for schema issues |

---

## Troubleshooting

### Docker not running
```
Error: Cannot connect to Docker daemon
```
→ Start Docker Desktop

### Port already in use
```
Error: port 54321 is already in use
```
→ Run `supabase stop` or kill the process using the port

### Migrations failed
```
Error: migration failed
```
→ Check the SQL syntax in the failing migration file
→ Run `supabase db reset` to start fresh

### Auth issues
If login doesn't work:
1. Check that seed ran: `SELECT * FROM auth.users;`
2. Check profiles exist: `SELECT * FROM public.profiles;`
3. Verify email confirmation is disabled in `config.toml`

---

## Test User Logins

For frontend testing, use these credentials:

**Admin:**
- Email: `admin@test.cliniquemana.local`
- Password: `testpassword123`

**Staff:**
- Email: `staff@test.cliniquemana.local`
- Password: `testpassword123`

**Provider:**
- Email: `provider1@test.cliniquemana.local`
- Password: `testpassword123`

---

## Next Steps

After local validation passes:
1. Commit migrations
2. Apply to staging via CI/CD or `supabase db push`
3. Run smoke tests on staging
4. Promote to production

---

## References

- [Supabase CLI Docs](https://supabase.com/docs/guides/cli)
- [Local Development Guide](https://supabase.com/docs/guides/cli/local-development)
- [Migration Guide](https://supabase.com/docs/guides/cli/managing-migrations)
