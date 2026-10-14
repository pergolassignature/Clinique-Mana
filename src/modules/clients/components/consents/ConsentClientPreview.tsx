import { useState } from 'react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import type { TemplateVariable } from '@/core/signing/templates/api'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { Radio } from '@/shared/ui/radio'
import type { VersionClause } from '../../api/consents'

const V = 'modules.clients.consents.settings.editor.clientView'
const P = (lang: 'fr' | 'en') => (lang === 'en' ? 'modules.clients.consents.page.en' : 'modules.clients.consents.page.fr') as 'modules.clients.consents.page.fr'

/**
 * « Aperçu comme le client le verra » (CC-21): the public signing page's look (`ConsentPublicPage`)
 * in the text's language: the clinic's request, the « Oui / Non » questions as they are being
 * written (answering here changes nothing), the page's button, then the document as Documenso will
 * show it to sign (the shared editor's preview, sample values). The identity step comes first on
 * the real page; it asks nothing the clinic writes, so it is left out.
 */
export function ConsentClientPreview({
  html,
  consentName,
  language,
  clauses,
  variables,
}: {
  html: string
  consentName: string
  language: 'fr' | 'en'
  clauses: VersionClause[]
  variables: TemplateVariable[]
}) {
  const T = P(language)
  const clinic = variables.find((v) => v.path === 'clinic.name')?.sample || t('app.name')
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no'>>({})
  return (
    <SettingsCard as="section" title={t(`${V}.title`)} description={t(language === 'en' ? `${V}.descriptionEn` : `${V}.description`)}>
      <div lang={language === 'en' ? 'en-CA' : 'fr-CA'} className="rounded-lg border border-border bg-background p-3 sm:p-4">
        <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <img src={logoUrl} alt="" width={99} height={44} className="block h-9 w-auto" />
          <p className="text-base font-semibold text-foreground">{consentName}</p>
          <p className="text-sm text-muted-foreground">{t(`${T}.intro`, { clinic, consent: consentName })}</p>
          {clauses.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-foreground">{t(`${T}.clauses.title`)}</legend>
              <p className="text-xs text-muted-foreground">{t(`${T}.clauses.help`)}</p>
              {clauses.map((clause, index) => (
                <div key={clause.key} role="radiogroup" aria-labelledby={`preview-clause-${clause.key}`} className="space-y-1.5 rounded-md border border-border p-3">
                  <p id={`preview-clause-${clause.key}`} className="text-sm text-foreground">
                    {clause.text.trim() || t(`${V}.untitled`, { n: String(index + 1) })}
                    {clause.kind === 'agree' && <span className="ml-1.5 text-xs font-medium text-muted-foreground">({t(`${T}.clauses.required`)})</span>}
                  </p>
                  <div className="flex gap-4">
                    {(['yes', 'no'] as const).map((value) => (
                      <label key={value} className="inline-flex items-center gap-1.5 text-sm">
                        <Radio
                          name={`preview-clause-${clause.key}`}
                          value={value}
                          checked={answers[clause.key] === value}
                          onChange={() => setAnswers((a) => ({ ...a, [clause.key]: value }))}
                        />
                        {t(`${T}.clauses.${value}`)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          )}
          <p aria-hidden className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
            {t(`${T}.sign`)}
          </p>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t(language === 'en' ? `${V}.documentEn` : `${V}.document`)}</p>
            <iframe title={t(`${V}.frameTitle`)} sandbox="" srcDoc={html} className="h-[30rem] w-full rounded-md border border-border bg-card" />
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}
