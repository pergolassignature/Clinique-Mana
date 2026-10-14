import { execFileSync } from 'node:child_process'

/**
 * The local stack's database (`supabase start`: the container `supabase_db_clinique-mana`, from
 * `project_id` in supabase/config.toml), for the one thing a browser cannot do: let time pass (an
 * appointment held next week moved to a finished day, as if it had happened). Local only, the
 * superuser of the local container; never a remote database. Returns psql's unaligned output.
 */
export function localSql(query: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_clinique-mana', 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: query,
    encoding: 'utf8',
  }).trim()
}

/** The seed's clinic. */
export const SEED_ORG = '00000000-0000-0000-0000-000000000001'

/**
 * Communications' specs start from the seed's state (no mailbox): a mailbox an earlier spec
 * connected then disconnected is removed (its mirror goes with it), so each spec sets up and
 * tears down its own mailboxes whatever ran before (the fake Google's spec, then the settings').
 */
export function forgetDisconnectedMailboxes(): void {
  localSql(`delete from public.mail_connections where org_id = '${SEED_ORG}' and status = 'disconnected';`)
}
