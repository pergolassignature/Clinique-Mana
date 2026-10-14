import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { t } from '@/i18n'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import type { ConsentRule, ConsentTemplate, ConsentType } from '../../api/consents'
import { useServiceNames } from '../../hooks/use-consents'
import { consentPurpose, textStatuses } from '../../lib/consents'
import { ConsentTextEditor } from './ConsentTextEditor'

const S = 'modules.clients.consents.settings'
const LANGUAGES = ['fr', 'en'] as const
type Language = (typeof LANGUAGES)[number]
const isLanguage = (value: string): value is Language => (LANGUAGES as readonly string[]).includes(value)

/** A language's state for its tab and the header: the chips' words, joined. */
export function TextChips({ template }: { template: ConsentTemplate | undefined }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {textStatuses(template).map((chip) => (
        <Badge key={chip.label} variant={chip.tone === 'neutral' ? 'secondary' : chip.tone}>
          {chip.label}
        </Badge>
      ))}
    </span>
  )
}

/**
 * One consent's texts (CC-21, Paramètres → Consentements, `?texte=<consent>`): its name and when it
 * is asked, « Français » and « Anglais » as page tabs (Radix: one tab stop, the arrows switch; a
 * switch asks first while a form is dirty), each with its state and the text's editor. « Tous les
 * consentements » goes back to the list (asking first too). The heading takes the focus on arrival.
 */
export function ConsentEditorPage({
  consent,
  templates,
  rules,
  readOnly,
  onBack,
}: {
  consent: ConsentType
  templates: ConsentTemplate[]
  rules: ConsentRule[]
  readOnly: boolean
  onBack: () => void
}) {
  const serviceNames = useServiceNames()
  const [language, setLanguage] = useState<Language>('fr')
  const { onValueChange, triggerProps } = useGuardedTabs(language, isLanguage, setLanguage)
  const heading = useRef<HTMLDivElement>(null)
  const textOf = (lang: Language) => templates.find((tpl) => tpl.consentKey === consent.key && tpl.language === lang)
  useEffect(() => {
    // PageHeader's heading is focusable (not tabbable): the keyboard lands on the consent's name.
    heading.current?.querySelector('h1')?.focus({ preventScroll: true })
    heading.current?.scrollIntoView?.({ block: 'start' })
  }, [consent.key])

  return (
    <div className="space-y-5">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {t(`${S}.editorPage.back`)}
      </Button>
      <div ref={heading} className="space-y-1">
        <PageHeader level={1} title={consent.name} description={consentPurpose(consent.key, rules, serviceNames.data)} />
      </div>
      {readOnly && <ReadOnlyNotice />}
      <Tabs value={language} onValueChange={onValueChange}>
        <TabsList aria-label={t(`${S}.editorPage.languages`)}>
          {LANGUAGES.map((lang) => (
            <TabsTrigger key={lang} value={lang} {...triggerProps(lang)}>
              {t(lang === 'en' ? `${S}.texts.english` : `${S}.texts.french`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {LANGUAGES.map((lang) => {
          const text = textOf(lang)
          return (
            <TabsContent key={lang} value={lang} className="mt-4 space-y-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>{t(lang === 'en' ? `${S}.editorPage.stateEn` : `${S}.editorPage.stateFr`)}</span>
                <TextChips template={text} />
              </p>
              {text ? <ConsentTextEditor consent={consent} text={text} readOnly={readOnly} /> : <p className="text-sm text-muted-foreground">{t(`${S}.editorPage.missing`)}</p>}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
