/**
 * The Supabase Auth email templates, built with the shared layout (P3-27,
 * Task 3.15). `npm run build:auth-templates` writes them to
 * `supabase/templates/<name>.html`; CI fails when the committed files differ.
 * `invite.html` is not generated: invitations go through `_shared/email`.
 *
 * The output is a Go template that GoTrue renders with `html/template`
 * (contextual auto-escaping), so the user's values (`{{ .Email }}`,
 * `{{ .NewEmail }}`, `{{ .RedirectTo }}`) are escaped by GoTrue at send time.
 * They are placed only in text content or in a link's query string, never in
 * a tag name, a style or an unquoted attribute. `{{ .RedirectTo | urlquery }}`
 * is URL-encoded in the href and in the copy-this-link text alike (and under
 * `text/template` too), so a `?` or `&` in it cannot split the query; it is
 * the last parameter. `/connexion/confirmer` reads it with URLSearchParams.
 *
 * Auth emails cannot read Settings: the footer is static. Subjects live in
 * `supabase/config.toml`; the build script checks they equal `AUTH_SUBJECTS`.
 */
import { frenchSpacing } from '../french.ts'
import { type ClinicFooter, renderLayout } from './layout.ts'
import { escapeHtml, toHtml } from './markup.ts'
import { COLOR, FONT_STACK } from './tokens.ts'

/** The generated templates, in `supabase/templates/` and `config.toml` order. */
export const AUTH_TEMPLATE_NAMES = [
  'recovery',
  'magic_link',
  'confirmation',
  'email_change',
  'reauthentication',
] as const

export type AuthTemplateName = typeof AUTH_TEMPLATE_NAMES[number]

/** `[auth.email.template.<name>] subject` in `config.toml`, also the `<title>`. */
export const AUTH_SUBJECTS: Record<AuthTemplateName, string> = {
  recovery: 'Choisissez un nouveau mot de passe · Clinique MANA',
  magic_link: 'Votre lien de connexion · Clinique MANA',
  confirmation: 'Confirmez votre adresse courriel · Clinique MANA',
  email_change: "Confirmez le changement d'adresse courriel · Clinique MANA",
  reauthentication: 'Votre code de vérification · Clinique MANA',
}

const FOOTER: ClinicFooter = {
  name: 'Clinique MANA',
  addressLines: [],
  phone: null,
  website: null,
  privacyOfficer: null,
}

const WHY_LINE =
  "Ce courriel vous est envoyé parce qu'une action a été demandée pour votre compte. Si ce n'est pas vous, vous pouvez l'ignorer."

/** Served by the app (P3-10); `{{ .SiteURL }}` is the app's URL. */
const WORDMARK_URL = '{{ .SiteURL }}/email/wordmark.png'

/** The confirm page link for `type`; a raw `&`, which the layout escapes. */
const confirmUrl = (type: string, extra = '') =>
  `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=${type}${extra}`

const H1_STYLE =
  `margin:0 0 16px;font-family:${FONT_STACK};font-size:20px;line-height:28px;font-weight:600;color:${COLOR.text}`

const CODE_STYLE =
  `margin:8px 0 16px;padding:16px 20px;background-color:${COLOR.page};border:1px solid ${COLOR.hairline};border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:28px;line-height:36px;font-weight:700;letter-spacing:0.2em;text-align:center;color:${COLOR.text}`

interface AuthEmail {
  heading: string
  preheader: string
  /** Body text in the `markup.ts` language (escaped by `toHtml`). */
  body: string
  /** Text after the code block (reauthentication only). */
  after?: string
  button?: { label: string; href: string }
  /** Shows `{{ .Token }}` in a large monospace block. */
  code?: boolean
}

const VALID_ONCE =
  "Ce lien est valide pendant une heure et ne peut être utilisé qu'une seule fois."

const EMAILS: Record<AuthTemplateName, AuthEmail> = {
  recovery: {
    heading: 'Choisissez un nouveau mot de passe',
    preheader: 'Le lien pour choisir un nouveau mot de passe.',
    body:
      `Bonjour,\n\nVous avez demandé à réinitialiser le mot de passe de votre compte Clinique MANA ({{ .Email }}). Cliquez sur le bouton ci-dessous pour en choisir un nouveau.\n\n${VALID_ONCE}`,
    button: {
      label: 'Choisir un nouveau mot de passe',
      href: confirmUrl('recovery'),
    },
  },
  magic_link: {
    heading: 'Votre lien de connexion',
    preheader: 'Votre lien pour vous connecter, sans mot de passe.',
    body:
      `Bonjour,\n\nVoici le lien pour vous connecter à votre espace Clinique MANA ({{ .Email }}), sans mot de passe.\n\n${VALID_ONCE}`,
    button: {
      label: 'Me connecter',
      // `next` last: it is the only value that may hold a `?` or `&`.
      href: confirmUrl('email', '&next={{ .RedirectTo | urlquery }}'),
    },
  },
  confirmation: {
    heading: 'Confirmez votre adresse courriel',
    preheader: 'Une dernière étape pour confirmer votre adresse.',
    body:
      "Bonjour,\n\nMerci de confirmer l'adresse {{ .Email }} pour votre compte Clinique MANA.\n\nCe lien est valide pendant une heure.",
    button: { label: 'Confirmer mon adresse', href: confirmUrl('email') },
  },
  email_change: {
    heading: "Confirmez le changement d'adresse courriel",
    preheader: 'Confirmez le changement de votre adresse courriel.',
    body:
      "Bonjour,\n\nUne demande a été faite pour remplacer l'adresse {{ .Email }} par {{ .NewEmail }} sur votre compte Clinique MANA. Cliquez sur le bouton ci-dessous pour confirmer.\n\nSi vous n'avez pas fait cette demande, ne cliquez pas : votre adresse actuelle reste inchangée.",
    button: {
      label: 'Confirmer le changement',
      href: confirmUrl('email_change'),
    },
  },
  reauthentication: {
    heading: 'Votre code de vérification',
    preheader: 'Le code pour confirmer cette action.',
    body:
      'Bonjour,\n\nPour confirmer cette action sur votre compte Clinique MANA, entrez le code suivant :',
    code: true,
    after:
      'Ce code est valide pendant quelques minutes. Ne le communiquez à personne.',
  },
}

/**
 * The body: heading, text, then the code block and its note when there is
 * one. The texts get French spacing (`../french.ts`) like the app emails' templates.
 */
function contentHtml(email: AuthEmail): string {
  return [
    `<h1 style="${H1_STYLE}">${escapeHtml(frenchSpacing(email.heading))}</h1>`,
    toHtml(frenchSpacing(email.body)),
    email.code ? `<p style="${CODE_STYLE}">{{ .Token }}</p>` : '',
    email.after ? toHtml(frenchSpacing(email.after)) : '',
  ].join('')
}

/** The five generated templates, by name: full HTML documents with Go placeholders. */
export function authTemplates(): Record<AuthTemplateName, string> {
  return Object.fromEntries(
    AUTH_TEMPLATE_NAMES.map((name) => {
      const email = EMAILS[name]
      const { html } = renderLayout({
        title: AUTH_SUBJECTS[name],
        preheader: email.preheader,
        contentHtml: contentHtml(email),
        button: email.button &&
          { ...email.button, label: frenchSpacing(email.button.label) },
        footer: FOOTER,
        whyLine: WHY_LINE,
        wordmarkUrl: WORDMARK_URL,
      })
      return [name, html]
    }),
  ) as Record<AuthTemplateName, string>
}
