# Runbook — Clinique MANA's Documenso instance

**Status:** Steps 1–6 and 8 done on 2026-10-08 (`https://sign.cliniquemana.com` live, Documenso 2.20.0). Left: the logo upload and 2FA (step 5–6, Jonathan), then step 7. · **ADR:** [0005](../adr/0005-documenso-replaces-docuseal.md) · **Status doc:** [Mise en service, item 4](../plans/2026-10-07-status.md#mise-en-service-phase-3-jonathan) · **Files:** [`ops/documenso/`](../../ops/documenso/)

> **This droplet also runs Pergolas Signature's production Documenso.** Every step that changes the server (resize, Caddy, `docker compose`, cron) waits for Jonathan's go-ahead in chat. **Secrets never pass through chat or git.** `setup.sh` generates them on the server, and Jonathan types the Resend key at its silent prompt.

## Where it runs

| | Pergolas Signature (existing) | Clinique MANA (new) |
|---|---|---|
| Droplet | `documenso-sign`, 178.128.234.204, TOR1, Ubuntu 24.04 (shared) | same |
| Directory | `/opt/documenso` | `/opt/documenso-clinique` |
| Compose project | `documenso-production` | `documenso-clinique` |
| Port (loopback only) | 127.0.0.1:3000 | 127.0.0.1:3001 |
| Domain | `sign.pergolassignature.ca` | `sign.cliniquemana.com` |
| Email | Resend, `noreply@notifications.pergolassignature.ca` | Resend, `signature@gestion.cliniquemana.com` (domain already verified) |
| Image | `documenso/documenso:v2.14.0` (pinned in step 8; upgrade pending, see Operations) | `documenso/documenso:v2.20.0` |

**Why the same droplet but a separate stack** (decision 2026-10-08, Jonathan): one server to operate. ADR 0005's reason for not sharing PS Hub's *instance* still holds. A second organisation inside PS Hub's Documenso would send clinic emails as « Pergolas Signature », because the sender is set once per instance, and it would mix both companies' data in one database. The two stacks share only the host, Docker and Caddy: each has its own network, database, certificate, secrets and admin.

**Capacity.** PS Hub's stack uses about 650 MB. The droplet is resized from 2 GB to **4 GB** first (step 1). Without the resize, a second stack and the memory spike of sealing a PDF could kill PS Hub's production signing (there is no swap). A 4 GB droplet costs the same as two 2 GB droplets.

**Loi 25.** The data stays in Canada (Toronto). Hosting is DigitalOcean (a US company) and email is Resend (US). Both go into Christine's EFVP (Mise en service 15).

## Steps

### 1. Resize the droplet (Jonathan, DigitalOcean dashboard)
`documenso-sign` → Resize → **CPU and RAM only** (keeps the 50 GB disk, so it can be sized back down), 4 GB. The droplet powers off, so PS Hub signing is down for about 1–2 minutes. Also turn on **Backups** (weekly snapshots) if they are off.
Check: `ssh root@178.128.234.204 free -m` shows about 3900 MB in total. *Done 2026-10-08: 4 GB, 2 vCPU; the disk was resized too (80 GB), so the droplet can no longer be sized back down.*

### 2. DNS (Jonathan, Cloudflare)
`cliniquemana.com` zone → add `A  sign  178.128.234.204`, **DNS only** (grey cloud). Caddy needs to reach Let's Encrypt directly.
Check: `dig +short sign.cliniquemana.com` returns the droplet IP.

### 3. Files and secrets (agent copies, Jonathan runs `setup.sh`)
```bash
# agent, with go-ahead
ssh root@178.128.234.204 'mkdir -m 700 -p /opt/documenso-clinique'
scp ops/documenso/compose.yml ops/documenso/setup.sh root@178.128.234.204:/opt/documenso-clinique/
```
Jonathan, in his own terminal (it prompts for the Resend key, so it needs a terminal):
```bash
ssh -t root@178.128.234.204 'bash /opt/documenso-clinique/setup.sh'
```
The key is a **new** Resend key: « Sending access », restricted to `gestion.cliniquemana.com`, named `documenso-clinique`. Do not reuse the app's key (Mise en service 1); each can then be rotated on its own.

`setup.sh` writes `.env` (0600) and `cert.p12` (self-signed, 10 years, owned by the container's uid 1001 and mode 0400), and refuses to overwrite either one.

**Back up the two secrets that cannot be regenerated** (Jonathan): store `.env` and `cert.p12` in the password manager. `NEXT_PRIVATE_ENCRYPTION_KEY` decrypts stored data, and the droplet backup alone is not enough if the droplet is lost.

### 4. Start (agent, with go-ahead)
```bash
ssh root@178.128.234.204 'cd /opt/documenso-clinique && docker compose pull && docker compose up -d && docker compose ps'
scp ops/documenso/Caddyfile root@178.128.234.204:/etc/caddy/Caddyfile.new
ssh root@178.128.234.204 'cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S) && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```
Check: `curl -sI https://sign.cliniquemana.com` returns 200 or a redirect with a valid certificate; `curl -sI https://sign.pergolassignature.ca` still answers; `curl -m 5 http://178.128.234.204:3001` fails to connect.

### 5. Admin account (Jonathan, browser)
1. Open `https://sign.cliniquemana.com/signup` and create the admin with the clinic's address (not a personal Pergolas one). Confirm the email: this also proves Resend works.
2. Promote that account to instance admin (agent, with go-ahead): `update "User" set roles = array['ADMIN','USER']::"Role"[] where email = '<address>';` run through `docker compose exec database psql -U documenso -d documenso`.
3. Close sign-up: set `NEXT_PUBLIC_DISABLE_SIGNUP=true` in `.env`, then `docker compose up -d`. Check: `/signup` refuses new accounts.
4. Turn on two-factor authentication for the admin (Profile → Security).

### 6. Organisation settings (Jonathan in the UI; agent for the claim flags)
*Done 2026-10-08 (agent, in the browser with Jonathan's go-ahead).* The admin is `info@cliniquemana.com`. The clinic's work happens in the organisation **« Clinique MANA »** (`org_sduaarmnmsunmwvt`, type ORGANISATION) and its team **`clinique-mana`** (open to every org member), not in the account's personal organisation, which is limited to one member and one team. As set and checked in the database:
- **Admin → Organizations → Clinique MANA:** teams and members unlimited (0); flags `unlimitedDocuments`, `allowCustomBranding`, `hidePoweredBy`. « Allow Legacy Envelopes » stays off: it only shows the old upload button and does not gate the API. In 2.20 the admin panel does this, so no SQL is needed.
- **Preferences → General:** language `fr`, timezone `America/Toronto`, format `yyyy-MM-dd HH:mm`; signatures typed, drawn or uploaded.
- **Certificates:** signing certificate **and audit log** included in the downloaded PDF. « Ne pas désactiver : le PDF signé est la seule copie du certificat et du journal » ([envelope API plan](../plans/2026-10-08-documenso-envelope-api-plan.md), E-7): the app stores only that PDF.
- **Branding:** on; site `https://cliniquemana.com`; colours from the app's tokens (primary teal-600 `#1e837c` with white text, focus ring teal-400 `#46aca5`). Since 2.x the signing-page colours can be set; PS Hub's « green cannot be changed » finding no longer applies. **Logo still to upload** (Jonathan: Branding → « Choose File » → `docs/design-system/assets/logo.png`).
- **Email:** Reply-To `info@cliniquemana.com`; default notifications unchanged. Envelopes the app creates carry their own email settings (the owner is not emailed when a signing link expires; the others on, Documenso's defaults: envelope API plan E-13), so a change here does not reach them.

Original checklist:
- Organisation: name « Clinique MANA ». Document preferences: language **Français**, timezone `America/Toronto`, include the signing certificate **and the audit log**.
- Branding: logo, `https://cliniquemana.com`, company details. Custom branding and « hide Powered by » need claim flags. PS Hub set them in SQL (`OrganisationClaim.flags`: `allowCustomBranding`, `hidePoweredBy`). Use the admin panel if this version has one, otherwise run the same update with go-ahead after reading the row.
- The accent colour of emails and the signing page cannot be changed (PS Hub finding).

### 7. API token and webhook (Jonathan; values go straight into the app)
1. Documenso → **team `clinique-mana`** → API Tokens → create `clinique-mana-app`, with no expiry or with a renewal date set in the calendar. Paste it in the app: Paramètres → Signature électronique → « Clé d'API ». Never paste it in chat.
2. App, same section: « Adresse de l'instance » = `https://sign.cliniquemana.com`. Copy « Adresse du webhook » (it ends in `/functions/v1/signing-webhook?org=<org_id>`).
3. Generate a secret locally with `openssl rand -hex 32`. In Documenso → team `clinique-mana` → Webhooks → create: URL = the copied address; events `DOCUMENT_OPENED`, `DOCUMENT_SIGNED`, `DOCUMENT_RECIPIENT_COMPLETED`, `DOCUMENT_COMPLETED`, `DOCUMENT_REJECTED`, `DOCUMENT_CANCELLED`; secret = that value. Paste the same value in the app's « Secret ».
4. « Tester la connexion », then « Envoyer un document test », sign it, and check that the signed PDF appears (with the certificate and audit-log pages). Then run the live checks of the [envelope API plan, §4](../plans/2026-10-08-documenso-envelope-api-plan.md#4-live-verification-against-signcliniquemanacom): they replace the old `VERIFY` list.

### 8. Hardening of the shared droplet (agent, with go-ahead; decision 2026-10-08)
PS Hub's stack, found and fixed on 2026-10-08 (backup first: `/opt/documenso/backups/*-20261008-123939*`; about 20 s of downtime). Only the repo-doc secrets remain:

| Finding | Fix |
|---|---|
| Port 3000 published on `0.0.0.0`: `http://178.128.234.204:3000` answered from the internet over plain HTTP, bypassing Caddy (Docker's rules skip ufw) | `ports: - 127.0.0.1:${PORT:-3000}:${PORT:-3000}`, then `docker compose up -d` (a few seconds of downtime) |
| `.env`, its `.bak` copies, `backups/env-*.bak` and `cert.p12` readable by every user (0644) | `.env*` and `backups/*` 0600; `cert.p12` owner 1001, mode 0400 |
| Image `latest` (running 2.14.0) | pin `documenso/documenso:v2.14.0`; upgrade on purpose |
| `DOCUMENSO_DISABLE_TELEMETRY` is in `.env` but compose never passes it on | add it to `environment` |
| One manual dump (2026-07-09), no schedule | `backup.sh` nightly for both stacks |
| The PS Hub repo doc `docs/CONTRACT_SIGNATURE_MODULE.md` holds the API key, webhook secret and DB password in clear | rotate all three and remove them from the doc (PS Hub task, outside this repo) |

Backups:
```bash
scp ops/documenso/backup.sh root@178.128.234.204:/usr/local/bin/documenso-backup
ssh root@178.128.234.204 'chmod 0700 /usr/local/bin/documenso-backup && echo "30 7 * * * root /usr/local/bin/documenso-backup 2>&1 | logger -t documenso-backup" > /etc/cron.d/documenso-backup && /usr/local/bin/documenso-backup && ls -la /opt/documenso*/backups | tail'
```
(07:30 UTC = 03:30 Toronto. Output goes to syslog: `journalctl -t documenso-backup`.) The dumps sit on the droplet and are covered by the weekly droplet backups. An off-site copy (DigitalOcean Spaces, Toronto) is a follow-up.

## Operations
- **Upgrade:** read the release notes (the 2.17.0 « deprecate endpoints » change matters to PS Hub, which still calls the `/api/v2/document/*` routes), run `documenso-backup`, change the tag in `compose.yml` (here first, then the server), then `docker compose pull && docker compose up -d`. Then « Tester la connexion » and re-check the `VERIFY` endpoints.
- **Logs:** `cd /opt/documenso-clinique && docker compose logs --tail 200 documenso`.
- **Webhook history:** `docker compose exec database psql -U documenso -d documenso -c 'select status, "responseCode", "createdAt" from "WebhookCall" order by "createdAt" desc limit 10;'`.
- **Restore:** `docker compose exec -T database pg_restore -U documenso -d documenso --clean < backups/db-<stamp>.dump` (stack stopped except the database).
- **Certificate:** expires in 2036. Rotation means a new `.p12` and passphrase; documents signed before keep their old seal.
