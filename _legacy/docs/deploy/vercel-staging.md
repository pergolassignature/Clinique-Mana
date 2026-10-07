# Vercel Staging Deployment — Clinique MANA

This guide configures Vercel to deploy the frontend with Supabase staging credentials.

---

## Environment Variables

### Required for Staging

| Variable | Value | Scope |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://vnmbjbdsjxmpijyjmmkh.supabase.co` | Preview |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_6J5OXiU8l9p0sGkTQtLldw_tK3bB1vp` | Preview |

### Variable Naming

Vite requires the `VITE_` prefix for environment variables to be exposed to the client.

```typescript
// Access in code
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
```

---

## Vercel Environment Configuration

### Step 1: Access Project Settings

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**

### Step 2: Add Staging Variables

For each variable:

1. Click **Add New**
2. Enter the variable name (e.g., `VITE_SUPABASE_URL`)
3. Enter the value
4. **Important:** Select only **Preview** environment
5. Click **Save**

### Environment Scope Explained

| Scope | When Used | Purpose |
|-------|-----------|---------|
| **Development** | `vercel dev` locally | Local development |
| **Preview** | PR deployments, branch deploys | **Staging** |
| **Production** | Main branch deployment | **Production** (different credentials later) |

For staging, use **Preview** scope only.

---

## Preview vs Production Separation

### Staging (Preview Deployments)

- Triggered by: Pull requests, feature branches
- URL pattern: `https://clinique-mana-*-username.vercel.app`
- Supabase: Staging project (`vnmbjbdsjxmpijyjmmkh`)

### Production (Production Deployment)

- Triggered by: Merge to `main` (or configured branch)
- URL: Your production domain
- Supabase: Production project (TBD)

### Configuration Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel Environment Variables              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Preview (Staging):                                         │
│    VITE_SUPABASE_URL = https://vnmbjbdsjxmpijyjmmkh...     │
│    VITE_SUPABASE_ANON_KEY = sb_publishable_6J5OXiU8...     │
│                                                             │
│  Production (Later):                                        │
│    VITE_SUPABASE_URL = https://<prod-ref>.supabase.co      │
│    VITE_SUPABASE_ANON_KEY = <prod-anon-key>                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Warning

> **NEVER use the `service_role` key in the frontend.**

The `service_role` key bypasses RLS and has full database access. It must only be used in:
- Server-side code (API routes, serverless functions)
- Backend services
- CI/CD pipelines (with proper secrets management)

### Key Types

| Key | Safe in Frontend? | Use Case |
|-----|-------------------|----------|
| `anon` / publishable | ✅ Yes | Client-side Supabase calls |
| `service_role` | ❌ **NEVER** | Server-side only |

If you need server-side operations:
- Use Vercel Edge Functions or API Routes
- Store `service_role` key as a **server-only** environment variable
- Never prefix with `VITE_` (would expose to client)

---

## Local Development with Staging

To test against staging locally:

### Option 1: .env.local file

Create `.env.local` (gitignored):

```env
VITE_SUPABASE_URL=https://vnmbjbdsjxmpijyjmmkh.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_6J5OXiU8l9p0sGkTQtLldw_tK3bB1vp
```

### Option 2: Vercel CLI

```bash
# Pull env vars from Vercel
vercel env pull .env.local

# Run with Vercel's env
vercel dev
```

---

## Deployment Checklist

### Before First Deploy

- [ ] Vercel project created and linked to repo
- [ ] Environment variables added (Preview scope)
- [ ] Build command configured: `npm run build`
- [ ] Output directory: `dist`
- [ ] Node.js version: 18.x or 20.x

### After Deploy

- [ ] Preview URL loads without errors
- [ ] Console shows no missing env var errors
- [ ] Supabase connection works (check network tab)
- [ ] Auth flows work (if implemented)

---

## Vercel Project Settings

### Recommended Configuration

| Setting | Value |
|---------|-------|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

### vercel.json (optional)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

The rewrite rule enables client-side routing (TanStack Router).

---

## Branch Protection

For staging workflow:

1. **Feature branches** → Preview deployments (staging Supabase)
2. **Pull requests** → Preview deployments with PR comments
3. **Main branch** → Production deployment (production Supabase, later)

Configure in Vercel:
- Settings → Git → Production Branch: `main`

---

## Troubleshooting

### "VITE_SUPABASE_URL is undefined"

- Check variable is added in Vercel dashboard
- Ensure `VITE_` prefix is present
- Redeploy after adding variables

### "Failed to fetch" / CORS errors

- Verify Supabase URL is correct
- Check Supabase project is active
- Verify site URL in Supabase Auth settings includes Vercel preview URLs

### Preview deploy doesn't use staging vars

- Confirm variables are scoped to **Preview** (not just Production)
- Check for typos in variable names

---

## Next Steps

1. Deploy frontend to Vercel (Preview)
2. Test auth flows against staging Supabase
3. Verify RLS works from frontend
4. Create production Supabase project
5. Add production environment variables
6. Deploy to production

---

## References

- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- [Supabase Auth - Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
