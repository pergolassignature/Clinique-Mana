-- =============================================================================
-- Secure links: hashed single-use tokens with a pluggable purpose catalogue
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §3
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.17 (P3-7, P3-16)
-- Needs:   docs/plans/2026-10-08-professionals-module-plan.md, 4b.1 (`professional_invite`)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Only the token's SHA-256 is stored (`token_hash`, 32 bytes: supabase/functions/_shared/
--   links.ts hashes the 43-character token string's UTF-8 bytes and sends `\x` + 64 hex). A link
--   is found by that hash (unique index); no secret is compared in code. The raw token is never
--   in the database, so a link can be shown only when it is created (P3-7).
-- * Neither table has any client privilege, service_role included (no policy either): edge
--   functions reach links only through `peek_secure_link` and the purposes' handler RPCs, and
--   module RPCs (security definer) through the `private` functions below. There is no list
--   hole to reopen (legacy A3; PS Hub's `get-quote-by-token` selects a clear UUID token).
-- * Purposes are a global catalogue seeded by the owning module's migrations (like
--   `scheduled_jobs`: not audited, git is its history). Each names its handler RPCs (P3-16):
--   `resolve_rpc(p_link_id uuid) returns jsonb` (what the page displays; it owns its
--   minimisation) and, for a purpose that creates an account, `accept_rpc(p_token_hash bytea,
--   p_user_id uuid, p_payload jsonb) returns jsonb`, which consumes the link itself with
--   `private.consume_secure_link` and does the module's work in the same transaction. Both are
--   public, security definer, service role only; 020_core_secure_links checks every seeded
--   purpose against that contract, so core never imports module code (ADR 0003).
-- * One live link per (org, purpose, subject): `issue_secure_link` revokes the previous ones in
--   the same transaction, and a unique partial index makes it a constraint. « Live » is « not
--   revoked and uses left », whatever the expiry (now() cannot be in an index predicate), so
--   an expired link is revoked too when a new one is issued; a used link never is, and keeps
--   answering « used ».
-- * Consumption is one UPDATE (design §3.2): its row lock makes a concurrent second submit
--   wait, then find no use left. Nothing else counts attempts: the per-link limit (5 per hour)
--   is the accept function's `consume_rate_limit` bucket (design §3.2).
-- * No enumeration (design §3.3): `peek_secure_link` answers an unknown and a revoked hash with
--   the same `{"state": "invalid"}`; `expired` and `used` add only the purpose (only the token
--   holder reaches them). `used` wins over `expired`.
-- * Audited with `token_hash` redacted. Retention: `core.secure_links_purge` deletes a link 12
--   months after its last event (use, revocation or expiry).
-- * Deviations from the plan's index list: the live-link index is unique and its predicate is
--   `use_count < max_uses` rather than `used_at is null` (the same for single-use purposes,
--   right for multi-use ones); the purge index is on the purge expression itself rather than on
--   `created_at`. The job runs at 08:25 UTC instead of 08:20, a minute already taken by
--   `core.scheduled_job_runs_purge`. `resolve_rpc` is required (resolve-link calls it for every
--   valid link).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_secure_links', true);

-- -----------------------------------------------------------------------------
-- Purpose catalogue
-- -----------------------------------------------------------------------------
create table public.secure_link_purposes (
  key text primary key check (key ~ '^[a-z_]{1,50}$'),
  module_key text not null references public.modules(key),
  default_ttl interval not null check (default_ttl > interval '0'),
  max_ttl interval not null,
  max_uses int not null default 1 check (max_uses between 1 and 10),
  -- The link opens a flow for a signed-in user (the module's own function checks the session).
  requires_session boolean not null default false,
  -- accept-invite creates the auth user, then calls accept_rpc.
  creates_account boolean not null default false,
  -- Names of public functions (no schema): resolve-link and accept-invite call them by name.
  resolve_rpc text not null check (resolve_rpc ~ '^[a-z][a-z0-9_]{2,62}$'),
  accept_rpc text check (accept_rpc ~ '^[a-z][a-z0-9_]{2,62}$'),
  -- For module read helpers over the purpose's links; a permission of the purpose's module.
  view_permission text not null references public.permissions(key),
  created_at timestamptz not null default now(),
  check (default_ttl <= max_ttl and max_ttl <= interval '30 days'),
  check (not (requires_session and creates_account)),
  check (not creates_account or accept_rpc is not null)
);
create index secure_link_purposes_module_key_idx on public.secure_link_purposes (module_key);
create index secure_link_purposes_view_permission_idx on public.secure_link_purposes (view_permission);

alter table public.secure_link_purposes enable row level security;
revoke all on public.secure_link_purposes from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Links
-- -----------------------------------------------------------------------------
create table public.secure_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null references public.secure_link_purposes(key),
  -- The record the link is for (`staff_invitation`, `professional`, …).
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_id uuid not null,
  token_hash bytea not null unique check (pg_catalog.length(token_hash) = 32),
  -- Purpose data, validated by the purpose's function.
  scope jsonb not null default '{}'
    check (pg_catalog.jsonb_typeof(scope) = 'object' and pg_catalog.pg_column_size(scope) <= 4096),
  max_uses int not null check (max_uses between 1 and 10),
  use_count int not null default 0 check (use_count >= 0 and use_count <= max_uses),
  expires_at timestamptz not null,
  -- The last use.
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(user_id) on delete set null,
  last_opened_at timestamptz,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((use_count = 0) = (used_at is null)),
  check (revoked_at is not null or revoked_by is null)
);
-- One live link per (org, purpose, subject); serves issue_secure_link and revoke_secure_links.
create unique index secure_links_live_key on public.secure_links (org_id, purpose, subject_type, subject_id)
  where revoked_at is null and use_count < max_uses;
-- Serves core.secure_links_purge.
create index secure_links_purge_idx on public.secure_links ((greatest(used_at, revoked_at, expires_at)));
create index secure_links_org_id_idx on public.secure_links (org_id);
create index secure_links_purpose_idx on public.secure_links (purpose);
create index secure_links_revoked_by_idx on public.secure_links (revoked_by) where revoked_by is not null;
create index secure_links_created_by_idx on public.secure_links (created_by) where created_by is not null;

-- RLS on, no policy, no privilege for any API role: see the header.
alter table public.secure_links enable row level security;
revoke all on public.secure_links from anon, authenticated, service_role;

create trigger secure_links_set_updated_at
  before update on public.secure_links
  for each row execute function private.set_updated_at();
create trigger secure_links_audit
  after insert or update or delete on public.secure_links
  for each row execute function private.audit_trigger('token_hash');

-- -----------------------------------------------------------------------------
-- Private functions (called by security definer RPCs: staff invitations, module purposes)
-- -----------------------------------------------------------------------------
-- Revokes the live links (not revoked, uses left) of one subject for one purpose; returns how
-- many. `p_by` (null for a system action) must be a member of the org (22023).
create function private.revoke_secure_links(
  p_org_id uuid,
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_by uuid
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_by is not null
     and not exists (select 1 from public.profiles p where p.user_id = p_by and p.org_id = p_org_id) then
    raise exception 'L''auteur de la révocation doit appartenir à l''organisation' using errcode = '22023';
  end if;

  update public.secure_links l
     set revoked_at = pg_catalog.now(), revoked_by = p_by
   where l.org_id = p_org_id and l.purpose = p_purpose
     and l.subject_type = p_subject_type and l.subject_id = p_subject_id
     and l.revoked_at is null and l.use_count < l.max_uses;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Issues a link for a subject, revoking its previous live links for the purpose, and returns
-- its id. The TTL defaults to the purpose's and may not exceed its max_ttl; max_uses comes from
-- the purpose. 22023: unknown purpose, TTL out of bounds, creator outside the org. The hash and
-- scope are checked by the table (23514; a reused hash: 23505).
create function private.issue_secure_link(
  p_org_id uuid,
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_token_hash bytea,
  p_created_by uuid,
  p_ttl interval default null,
  p_scope jsonb default '{}'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_purpose public.secure_link_purposes%rowtype;
  v_ttl interval;
  v_id uuid;
begin
  select * into v_purpose from public.secure_link_purposes p where p.key = p_purpose;
  if not found then
    raise exception 'Usage de lien inconnu' using errcode = '22023';
  end if;
  v_ttl := coalesce(p_ttl, v_purpose.default_ttl);
  if v_ttl <= interval '0' or v_ttl > v_purpose.max_ttl then
    raise exception 'Durée de validité hors limites pour cet usage de lien' using errcode = '22023';
  end if;
  if p_created_by is not null
     and not exists (select 1 from public.profiles p where p.user_id = p_created_by and p.org_id = p_org_id) then
    raise exception 'L''auteur du lien doit appartenir à l''organisation' using errcode = '22023';
  end if;

  perform private.revoke_secure_links(p_org_id, p_purpose, p_subject_type, p_subject_id, p_created_by);

  insert into public.secure_links
    (org_id, purpose, subject_type, subject_id, token_hash, scope, max_uses, expires_at, created_by)
  values
    (p_org_id, p_purpose, p_subject_type, p_subject_id, p_token_hash, coalesce(p_scope, '{}'),
     v_purpose.max_uses, pg_catalog.now() + v_ttl, p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- Consumes one use of a live, unexpired link of that purpose, atomically (design §3.2), and
-- returns the row; null when nothing matches (unknown, revoked, expired, used up, another
-- purpose). A purpose's accept_rpc calls it first, in its own transaction.
create function private.consume_secure_link(p_token_hash bytea, p_purpose text)
returns public.secure_links
language sql
set search_path = ''
as $$
  update public.secure_links l
     set use_count = l.use_count + 1, used_at = pg_catalog.now()
   where l.token_hash = p_token_hash and l.purpose = p_purpose
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
  returning l.*
$$;

revoke all on function
  private.revoke_secure_links(uuid, text, text, uuid, uuid),
  private.issue_secure_link(uuid, text, text, uuid, bytea, uuid, interval, jsonb),
  private.consume_secure_link(bytea, text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Service-role RPC (resolve-link, accept-invite: supabase/functions/_shared/links.ts hashes)
-- -----------------------------------------------------------------------------
-- What a token's hash opens, without consuming it. Exactly one of:
--   {"state": "invalid"}                          unknown or revoked (identical on purpose)
--   {"state": "expired" | "used", "purpose": …}   `used` when no use is left, even if expired
--   {"state": "valid", "link_id", "org_id", "purpose", "module_key", "subject_type",
--    "subject_id", "scope", "expires_at", "requires_session", "creates_account",
--    "resolve_rpc", "accept_rpc"}               accept_rpc may be null
-- With p_mark_opened, a valid link gets last_opened_at = now() (legacy A3 « opened »). The
-- caller then checks the module (requireModuleForOrg on org_id, module_key).
create function public.peek_secure_link(p_token_hash bytea, p_mark_opened boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.secure_links%rowtype;
  v_purpose public.secure_link_purposes%rowtype;
begin
  select * into v_link from public.secure_links l where l.token_hash = p_token_hash;
  if not found or v_link.revoked_at is not null then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if v_link.use_count >= v_link.max_uses then
    return pg_catalog.jsonb_build_object('state', 'used', 'purpose', v_link.purpose);
  end if;
  if v_link.expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('state', 'expired', 'purpose', v_link.purpose);
  end if;

  select * into v_purpose from public.secure_link_purposes p where p.key = v_link.purpose;
  if coalesce(p_mark_opened, false) then
    update public.secure_links l set last_opened_at = pg_catalog.now() where l.id = v_link.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'valid',
    'link_id', v_link.id,
    'org_id', v_link.org_id,
    'purpose', v_link.purpose,
    'module_key', v_purpose.module_key,
    'subject_type', v_link.subject_type,
    'subject_id', v_link.subject_id,
    'scope', v_link.scope,
    'expires_at', v_link.expires_at,
    'requires_session', v_purpose.requires_session,
    'creates_account', v_purpose.creates_account,
    'resolve_rpc', v_purpose.resolve_rpc,
    'accept_rpc', v_purpose.accept_rpc
  );
end;
$$;

revoke all on function public.peek_secure_link(bytea, boolean) from public, anon, authenticated;
grant execute on function public.peek_secure_link(bytea, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- Retention (private.run_sql_job, Task 3.3)
-- -----------------------------------------------------------------------------
-- Deletes links whose last event (use, revocation or expiry) is more than 12 months old. A
-- handful of rows a day at one clinic: one statement, through secure_links_purge_idx. The
-- deletions are audited (token_hash redacted).
create function private.job_secure_links_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.secure_links l
   where greatest(l.used_at, l.revoked_at, l.expires_at) < pg_catalog.now() - interval '12 months';
  get diagnostics v_deleted = row_count;
  return 'deleted=' || v_deleted;
end;
$$;

revoke all on function private.job_secure_links_purge() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.secure_links_purge', 'core', 'Purge des liens sécurisés',
   'Supprime les liens d''invitation 12 mois après leur utilisation, leur révocation ou leur expiration.',
   'sql', 'private.job_secure_links_purge', 'core.secure_links_purge', true)
on conflict do nothing;

select cron.schedule('core.secure_links_purge', '25 8 * * *',
  $$select private.run_sql_job('core.secure_links_purge')$$);
