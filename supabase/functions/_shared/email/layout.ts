/**
 * The branded email layout shared by app emails (`compose.ts`) and the
 * generated Supabase auth templates (Task 3.15).
 *
 * Email-client-safe HTML: nested presentation tables, inline styles only (no
 * `<style>`, no class, no web font, no script), 560 px wide with an Outlook
 * ghost table, `lang="fr-CA" dir="ltr"` on the document and on the outer
 * wrapper (some clients drop `<html>`). Colours and type come from the design
 * system (`tokens.ts`). The only image is the static wordmark served by the app
 * (P3-10), opaque on white so it stays legible when a client darkens the
 * card; there is no tracking pixel and no tracking parameter.
 *
 * The ghost table is a conditional comment, so it reaches only the app emails.
 * GoTrue renders the auth templates with Go's `html/template`, which strips
 * every HTML comment (checked in Mailpit, Task 3.16): in classic Outlook for Windows
 * the auth emails' card is fluid (full width) instead of 560 px. A
 * comment-free fix (`width="560"` on the card table) would give phones a
 * fixed 560 px card, so it is not used.
 *
 * Everything passed in is escaped here except `contentHtml`, which callers
 * build from escaped parts (`markup.ts` / `render.ts`). Placeholders of other
 * template engines (`{{ .SiteURL }}`) contain nothing to escape and pass through.
 *
 * French spacing (`../french.ts`): the layout's own words hold a U+202F before
 * « : », and the « Pourquoi ce courriel » line (catalogue text, never a value)
 * goes through `frenchSpacing`. The content and the button label arrive
 * spaced (`render.ts`); clinic identity values are printed as stored.
 */
import { frenchSpacing, NNBSP } from '../french.ts'
import { escapeHtml } from './markup.ts'
import { BODY_TEXT, COLOR, FONT_STACK, SMALL_TEXT } from './tokens.ts'

/** The clinic identity printed in the footer, already formatted for display. */
export interface ClinicFooter {
  name: string
  /** Street, suite, then « Ville QC H2X 1Y4 »; empty when unknown. */
  addressLines: string[]
  phone: string | null
  website: string | null
  privacyOfficer: { name: string | null; email: string | null } | null
}

/** The call-to-action: its label is text, its href comes from code only. */
export interface LayoutButton {
  label: string
  href: string
}

/** What `renderLayout` wraps around the content. */
export interface LayoutInput {
  /** The document `<title>`: the email's subject. */
  title: string
  /** Inbox preview text, hidden in the message; none when absent or empty. */
  preheader?: string
  /** Trusted, already-escaped HTML of the body. */
  contentHtml: string
  button?: LayoutButton
  footer: ClinicFooter
  /** « Pourquoi ce courriel » line of the template. */
  whyLine: string
  wordmarkUrl: string
}

/** What `renderLayoutText` wraps around the content. */
export interface LayoutTextInput {
  contentText: string
  button?: LayoutButton
  footer: ClinicFooter
  whyLine: string
}

/**
 * Displayed size of the wordmark. The PNG (`public/email/wordmark.png`) is
 * 240 × 106 (2× for sharp screens) with an opaque white background baked in,
 * the card's colour, so dark-mode clients never put the wine ink on black.
 */
const WORDMARK = { width: 120, height: 53 }

/** « Confidentialité : name, email », or null when neither is known. */
function privacyLine(footer: ClinicFooter): string | null {
  const parts = [footer.privacyOfficer?.name, footer.privacyOfficer?.email]
    .filter(Boolean)
  return parts.length ? `Confidentialité${NNBSP}: ${parts.join(', ')}` : null
}

/** The footer's identity lines, in display order, without empty ones. */
function footerLines(footer: ClinicFooter): string[] {
  return [
    footer.name,
    ...footer.addressLines,
    footer.phone,
    footer.website,
    privacyLine(footer),
  ].filter((line): line is string => Boolean(line))
}

/** The bulletproof button (a padded link inside a coloured cell) and its fallback line. */
function buttonHtml({ label, href }: LayoutButton): string {
  const url = escapeHtml(href)
  return `<tr><td style="padding:8px 0 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:4px;background-color:${COLOR.primary};mso-padding-alt:12px 20px">
<a href="${url}" target="_blank" style="display:inline-block;padding:12px 20px;border-radius:4px;font-family:${FONT_STACK};font-size:16px;line-height:24px;font-weight:600;color:${COLOR.primaryText};text-decoration:none">${
    escapeHtml(label)
  }</a>
</td></tr></table>
<p style="margin:16px 0 0;${SMALL_TEXT}">Si le bouton ne fonctionne pas, copiez ce lien${NNBSP}:<br><span style="word-break:break-all">${url}</span></p>
</td></tr>`
}

/** The full HTML document for one email. */
export function renderLayout(input: LayoutInput): { html: string } {
  const footer = footerLines(input.footer).map(escapeHtml).join('<br>')
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${
      escapeHtml(frenchSpacing(input.preheader))
    }</div>\n`
    : ''
  const html = `<!doctype html>
<html lang="fr-CA" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};${BODY_TEXT}">
${preheader}<table role="presentation" lang="fr-CA" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page}">
<tr><td align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="background-color:${COLOR.card};border:1px solid ${COLOR.hairline};border-radius:6px;padding:32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 24px"><img src="${
    escapeHtml(input.wordmarkUrl)
  }" width="${WORDMARK.width}" height="${WORDMARK.height}" alt="Clinique MANA" style="display:block;border:0;outline:none;text-decoration:none;width:${WORDMARK.width}px;height:${WORDMARK.height}px;${BODY_TEXT}"></td></tr>
<tr><td>${input.contentHtml}</td></tr>
${input.button ? buttonHtml(input.button) : ''}
</table>
</td></tr>
<tr><td style="padding:24px 28px 0;${SMALL_TEXT}">
<p style="margin:0 0 12px;${SMALL_TEXT}">${footer}</p>
<p style="margin:0;padding:12px 0 0;border-top:1px solid ${COLOR.hairline};${SMALL_TEXT}">${
    escapeHtml(frenchSpacing(input.whyLine))
  }</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`
  return { html }
}

/** The plain-text part: content, « label : URL », then the footer after a `--` line. */
export function renderLayoutText(input: LayoutTextInput): string {
  const sections = [input.contentText]
  if (input.button) {
    sections.push(`${input.button.label}${NNBSP}:\n${input.button.href}`)
  }
  sections.push(
    ['--', ...footerLines(input.footer)].join('\n'),
    frenchSpacing(input.whyLine),
  )
  return sections.join('\n\n')
}
