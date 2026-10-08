import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { baseUrlSchema, expirySchema } from './schemas'

const baseUrl = (value: string) => baseUrlSchema.safeParse({ base_url: value })
const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message

describe('baseUrlSchema (mirrors signing_settings_base_url_check and set_signing_settings)', () => {
  it.each([
    ['https://sign.cliniquemana.com', 'https://sign.cliniquemana.com'],
    ['https://sign.cliniquemana.com:8443/documenso', 'https://sign.cliniquemana.com:8443/documenso'],
    // The local fake (P3-30).
    ['http://host.docker.internal:55390', 'http://host.docker.internal:55390'],
    // Trimmed, without trailing slashes, as the RPC stores it.
    ['  https://sign.cliniquemana.com//  ', 'https://sign.cliniquemana.com'],
    // The scheme and host are lowercased (SQL compares them case-sensitively); the path is kept.
    ['HTTPS://Sign.CliniqueMana.com/Api', 'https://sign.cliniquemana.com/Api'],
    // Typed without a scheme, it gets https://.
    ['sign.cliniquemana.com', 'https://sign.cliniquemana.com'],
  ])('accepts %j as %j', (value, stored) => {
    expect(baseUrl(value)).toMatchObject({ success: true, data: { base_url: stored } })
  })

  it('clears the address when empty', () => {
    expect(baseUrl('   ')).toMatchObject({ success: true, data: { base_url: null } })
  })

  it.each(['http://sign.cliniquemana.com', 'ftp://sign.cliniquemana.com', 'http://localhost:55390'])('refuses %j: https only', (value) => {
    expect(firstError(baseUrl(value))).toBe(t('settings.validation.https'))
  })

  it.each(['https://sign clinique.com', 'https://sign.cliniquemana.com/?x=1', 'https://sign.cliniquemana.com/#top', 'https://exa_mple.com'])(
    'refuses %j: not an address the database stores',
    (value) => {
      expect(firstError(baseUrl(value))).toBe(t('settings.validation.url'))
    },
  )

  it('refuses an address longer than 2 048 characters', () => {
    expect(firstError(baseUrl(`https://sign.cliniquemana.com/${'a'.repeat(2048)}`))).toBe(t('settings.validation.url'))
  })

  it('refuses control characters', () => {
    expect(firstError(baseUrl('https://sign.cliniquemana.com/\u001c'))).toBe(t('settings.validation.controlChar'))
  })
})

describe('expirySchema (1 to 60 days)', () => {
  it.each([
    ['1', 1],
    [' 7 ', 7],
    ['60', 60],
  ])('accepts %j', (value, days) => {
    expect(expirySchema.safeParse({ expiry_days: value })).toMatchObject({ success: true, data: { expiry_days: days } })
  })

  it.each(['', '0', '61', '7.5', 'sept', '-3'])('refuses %j', (value) => {
    expect(firstError(expirySchema.safeParse({ expiry_days: value }))).toBe(t('settings.signing.send.expiryRange'))
  })
})
