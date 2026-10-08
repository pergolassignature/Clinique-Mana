// Generates the Supabase Auth email templates in supabase/templates/ from the
// shared email layout (P3-27, plan Task 3.15): recovery, magic_link,
// confirmation, email_change and reauthentication. invite.html is not
// generated (unused; invitations go through _shared/email).
//
// Also checks that each `[auth.email.template.<name>] subject` in
// supabase/config.toml equals the template's <title> (AUTH_SUBJECTS), so the
// subject has one wording. CI runs this and fails on any diff in
// supabase/templates.
//
// Staging/production: paste the same subject + HTML in the dashboard
// (config.toml is not pushed to remote projects).
//
// Run: npm run build:auth-templates

import {
  AUTH_SUBJECTS,
  AUTH_TEMPLATE_NAMES,
  authTemplates,
} from '../supabase/functions/_shared/email/auth-templates.ts'

const root = new URL('../', import.meta.url)
const config = await Deno.readTextFile(new URL('supabase/config.toml', root))

/** `subject = "…"` of each `[auth.email.template.<name>]` block. */
const subjects = new Map(
  [...config.matchAll(
    /^\[auth\.email\.template\.(\w+)\]\s*\nsubject\s*=\s*"([^"\\]*)"/gm,
  )].map((m) => [m[1], m[2]]),
)

const drift = AUTH_TEMPLATE_NAMES.filter((name) =>
  subjects.get(name) !== AUTH_SUBJECTS[name]
)
if (drift.length) {
  for (const name of drift) {
    console.error(
      `supabase/config.toml [auth.email.template.${name}] subject must be "${
        AUTH_SUBJECTS[name]
      }" (found ${JSON.stringify(subjects.get(name) ?? null)}).`,
    )
  }
  Deno.exit(1)
}

const templates = authTemplates()
for (const name of AUTH_TEMPLATE_NAMES) {
  await Deno.writeTextFile(
    new URL(`supabase/templates/${name}.html`, root),
    templates[name],
  )
}
console.log(
  `Wrote ${AUTH_TEMPLATE_NAMES.length} templates to supabase/templates/.`,
)
