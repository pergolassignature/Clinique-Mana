/**
 * Composes a complete email (subject, HTML, text) from the effective template,
 * the clinic identity and the values: `render.ts`, then `layout.ts`.
 *
 * The button URL comes from code (`actionUrl`), never from template text, and
 * must be `https:` (or local `http:` when `APP_URL` is local). A template with
 * a button label fails closed without one (`missing_variable`, path
 * `action_url`), except in preview, where the button points at the app.
 *
 * Modes: `send` (default) needs every required value; `preview` fills missing
 * values with samples; `test` does the same and prefixes the subject with
 * « [Test] ».
 */
import { formatPhone } from './format.ts'
import { type ClinicFooter, renderLayout, renderLayoutText } from './layout.ts'
import { renderTemplate, safeUrl, type TemplateVariable } from './render.ts'

/** The effective template (override or default) and its catalogue fields. */
export interface EmailTemplate {
  subject: string
  body: string
  buttonLabel: string | null
  /** `email_template_defaults.why_line`. */
  whyLine: string
  variables: TemplateVariable[]
}

/** Clinic identity columns of `organizations` (Phase 2, Task 2.7), as stored. */
export interface ClinicIdentity {
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  /** E.164 (`+15145551234`). */
  phone: string | null
  website: string | null
  privacyOfficerName: string | null
  privacyOfficerEmail: string | null
}

/** What `get_email_context` provides for composing (Task 3.8 maps the RPC's JSON to it). */
export interface EmailContext {
  template: EmailTemplate
  clinic: ClinicIdentity
  /** `organizations.timezone`. */
  timezone: string
}

/** Per-send input from the calling code. */
export interface ComposeInput {
  values: Record<string, unknown>
  /** The button URL (secure link or app URL), from code only. */
  actionUrl: string | null
  /** `APP_URL`: serves the wordmark, and allows local URLs when it is local. */
  appUrl: string
  mode?: 'send' | 'preview' | 'test'
}

/** The email to send, or the first variable that prevented composing it. */
export type ComposeResult =
  | { ok: true; subject: string; html: string; text: string }
  | { ok: false; code: 'missing_variable' | 'unknown_variable'; path: string }

/** Label used when code passes a URL but the template has no button label. */
const DEFAULT_BUTTON_LABEL = 'Ouvrir le lien'
const PREHEADER_MAX = 140

/** The footer lines from the stored identity: formatted phone, Canada Post city line. */
export function clinicFooter(clinic: ClinicIdentity): ClinicFooter {
  const cityLine = [clinic.city, clinic.province, clinic.postalCode].filter(
    Boolean,
  ).join(' ')
  const hasOfficer = clinic.privacyOfficerName || clinic.privacyOfficerEmail
  return {
    name: clinic.name,
    addressLines: [clinic.addressLine1, clinic.addressLine2, cityLine].filter((
      l,
    ): l is string => Boolean(l)),
    phone: clinic.phone ? formatPhone(clinic.phone) : null,
    website: clinic.website,
    privacyOfficer: hasOfficer
      ? { name: clinic.privacyOfficerName, email: clinic.privacyOfficerEmail }
      : null,
  }
}

/** The first line of the text part, cut to fit an inbox preview. */
function preheader(text: string): string {
  const first = text.split('\n', 1)[0]
  return first.length > PREHEADER_MAX
    ? `${first.slice(0, PREHEADER_MAX - 1).trimEnd()}…`
    : first
}

/** Composes the email; see the module comment for the rules. */
export function composeEmail(
  context: EmailContext,
  input: ComposeInput,
): ComposeResult {
  const mode = input.mode ?? 'send'
  // `APP_URL` itself is a local `http:` address only in development.
  const allowLocalHttp = safeUrl(input.appUrl, true)?.startsWith('http:') ??
    false
  const { template } = context

  const rendered = renderTemplate({
    subject: template.subject,
    body: template.body,
    buttonLabel: template.buttonLabel,
    variables: template.variables,
    values: input.values,
    timezone: context.timezone,
    sample: mode !== 'send',
    allowLocalHttp,
  })
  if (!rendered.ok) return rendered

  const label = rendered.buttonLabel?.trim() || null
  let href: string | null = null
  if (input.actionUrl !== null) {
    href = safeUrl(input.actionUrl, allowLocalHttp)
    if (!href) {
      return { ok: false, code: 'missing_variable', path: 'action_url' }
    }
  } else if (label !== null) {
    if (mode === 'send') {
      return { ok: false, code: 'missing_variable', path: 'action_url' }
    }
    href = input.appUrl
  }
  const button = href
    ? { label: label ?? DEFAULT_BUTTON_LABEL, href }
    : undefined

  const footer = clinicFooter(context.clinic)
  const { html } = renderLayout({
    preheader: preheader(rendered.text),
    contentHtml: rendered.html,
    button,
    footer,
    whyLine: template.whyLine,
    wordmarkUrl: `${input.appUrl.replace(/\/+$/, '')}/email/wordmark.png`,
  })
  const text = renderLayoutText({
    contentText: rendered.text,
    button,
    footer,
    whyLine: template.whyLine,
  })

  return {
    ok: true,
    subject: mode === 'test' ? `[Test] ${rendered.subject}` : rendered.subject,
    html,
    text,
  }
}
