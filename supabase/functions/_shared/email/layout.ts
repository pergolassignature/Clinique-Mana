/**
 * The branded email layout shared by app emails (`compose.ts`) and the
 * generated Supabase auth templates (Task 3.15).
 *
 * Email-client-safe HTML: nested presentation tables, inline styles only (no
 * `<style>`, no class, no web font, no script), 560 px wide with an Outlook
 * ghost table, `lang="fr-CA"`. Colours and type come from the design system
 * (`tokens.ts`). The only image is the static wordmark served by the app
 * (P3-10); there is no tracking pixel and no tracking parameter.
 *
 * Everything passed in is escaped here except `contentHtml`, which callers
 * build from escaped parts (`markup.ts` / `render.ts`). Placeholders of other
 * template engines (`{{ .SiteURL }}`) contain nothing to escape and pass through.
 */
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
  /** Inbox preview text, hidden in the message. */
  preheader: string
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

/** Displayed size of the wordmark; the PNG is 240 × 106 (2× for sharp screens). */
const WORDMARK = { width: 120, height: 53 }

/** « Confidentialité : name, email », or null when neither is known. */
function privacyLine(footer: ClinicFooter): string | null {
  const parts = [footer.privacyOfficer?.name, footer.privacyOfficer?.email]
    .filter(Boolean)
  return parts.length ? `Confidentialité : ${parts.join(', ')}` : null
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
<td style="border-radius:4px;background-color:${COLOR.primary}">
<a href="${url}" target="_blank" style="display:inline-block;padding:12px 20px;border-radius:4px;font-family:${FONT_STACK};font-size:16px;line-height:24px;font-weight:600;color:${COLOR.primaryText};text-decoration:none">${
    escapeHtml(label)
  }</a>
</td></tr></table>
<p style="margin:16px 0 0;${SMALL_TEXT}">Si le bouton ne fonctionne pas, copiez ce lien :<br><span style="word-break:break-all">${url}</span></p>
</td></tr>`
}

/** The full HTML document for one email. */
export function renderLayout(input: LayoutInput): { html: string } {
  const footer = footerLines(input.footer).map(escapeHtml).join('<br>')
  const html = `<!doctype html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};${BODY_TEXT}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${
    escapeHtml(input.preheader)
  }</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page}">
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
    escapeHtml(input.whyLine)
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
    sections.push(`${input.button.label} :\n${input.button.href}`)
  }
  sections.push(['--', ...footerLines(input.footer)].join('\n'), input.whyLine)
  return sections.join('\n\n')
}
