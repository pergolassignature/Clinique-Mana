import { useEffect } from 'react'

/**
 * A client's public page in her language (the link's: the consent, the proposal, the payment…):
 * French by default, English when the clinic knows her as English.
 */
export type PublicLanguage = 'fr' | 'en'

/** Anything but `en` is French. */
export const asPublicLanguage = (value: unknown): PublicLanguage => (value === 'en' ? 'en' : 'fr')

/** While the page shows, `<html lang>` says its language (screen readers, translation tools). */
export function usePageLanguage(language: PublicLanguage): void {
  useEffect(() => {
    const root = document.documentElement
    const before = root.lang
    root.lang = language === 'en' ? 'en-CA' : 'fr-CA'
    return () => {
      root.lang = before
    }
  }, [language])
}

const money = {
  fr: new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }),
  en: new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }),
}
const dateOnly = {
  fr: new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
}

/** `20000` → « 200,00 $ » or « $200.00 ». */
export const formatMoneyIn = (language: PublicLanguage, cents: number): string => money[language].format(cents / 100)

/** A calendar date (`yyyy-MM-dd`, no time zone): « 2 novembre 2026 » or « November 2, 2026 ». */
export function formatDateOnlyIn(language: PublicLanguage, date: string): string {
  const day = date.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return day ? dateOnly[language].format(new Date(`${day}T00:00:00Z`)) : ''
}
