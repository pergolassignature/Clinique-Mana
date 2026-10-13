import { z } from 'zod'
import { t } from '@/i18n'
import type { AiSettings, AiSettingsInput } from '../api/ai'

const S = 'modules.communications.ai.settings'

/** Dollars typed « 50 » or « 12,50 » → cents; null when unreadable. */
export function dollarsToCents(text: string): number | null {
  const normalized = text.replace(/\s|\u00A0|\$/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

/** Cents → « 50 » / « 12,50 » for the field. */
export const centsToDollars = (cents: number) =>
  (cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2, useGrouping: false })

export interface AiFormValues {
  [key: string]: string | boolean
  enabled: boolean
  model: string
  cap: string
  inputPrice: string
  outputPrice: string
}

export const toAiValues = (s: AiSettings): AiFormValues => ({
  enabled: s.enabled,
  model: s.model,
  cap: centsToDollars(s.monthly_cap_cents),
  inputPrice: centsToDollars(s.input_cents_per_mtok),
  outputPrice: centsToDollars(s.output_cents_per_mtok),
})

const money = (key: 'capInvalid' | 'priceInvalid') =>
  z.string().refine((value) => dollarsToCents(value) !== null, { message: t(`${S}.${key}`) }).transform((value) => dollarsToCents(value)!)

export const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    model: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9.:_-]{1,63}$/, { message: t(`${S}.modelInvalid`) }),
    cap: money('capInvalid'),
    inputPrice: money('priceInvalid'),
    outputPrice: money('priceInvalid'),
  })
  .transform(
    (v): AiSettingsInput => ({
      enabled: v.enabled,
      model: v.model,
      monthlyCapCents: v.cap,
      inputCentsPerMtok: v.inputPrice,
      outputCentsPerMtok: v.outputPrice,
    }),
  )
