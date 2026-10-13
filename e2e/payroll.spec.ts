import type { Page } from '@playwright/test'
import type { AccountKey } from './fixtures/accounts'
import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * « Paie des professionnels » (Facturation FPay; local only, after `npm run db:reset`: the seed
 * enables Facturation and holds last month's two completed sessions of Félix Gauthier,
 * provider@mana.test, at 30 % retention).
 *
 * The administration calculates last month in « Paie », opens Félix's draft and sends it; Félix
 * finds it in « Ma paie », checks it and validates it; with the functions served, he generates his
 * invoice; the administration then sees it validated (and its invoice).
 */

const API = 'http://127.0.0.1:55321'

test('calculate, send, validate, (generate the invoice)', async ({ page, signIn, request }) => {
  const functions = await request
    .fetch(`${API}/functions/v1/billing-payout-invoice`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
    .then((r) => r.ok())
    .catch(() => false)

  await signIn('admin')
  await payroll(page, signIn, functions)
})

async function payroll(page: Page, signIn: (who: AccountKey) => Promise<void>, functions: boolean) {
  await page.goto('/accueil')
  await page.getByRole('link', { name: 'Paie', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Paie des professionnels' })).toBeVisible()
  const build = page.getByRole('button', { name: /^(Calculer|Recalculer) le mois$/ })
  await build.click()
  await expect(page.getByText(/^Mois calculé/)).toBeVisible()
  const table = page.getByRole('table', { name: 'Sommaires du mois' })
  const felix = table.getByRole('row').filter({ hasText: 'Félix Gauthier' })
  await expect(felix).toBeVisible()
  await felix.getByRole('button', { name: 'Félix Gauthier' }).click()

  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('table', { name: 'Lignes du sommaire' })).toBeVisible()
  await expect(sheet.getByRole('table', { name: 'Lignes du sommaire' }).getByText('Alice Tremblay-Fictive').first()).toBeVisible()
  await expect(sheet.getByText(/30\s%/).first()).toBeVisible()
  const send = sheet.getByRole('button', { name: /^(Envoyer|Renvoyer) au professionnel$/ })
  if (await send.isVisible()) {
    await send.click()
    await expect(page.getByText('Sommaire envoyé à Félix Gauthier.')).toBeVisible()
  }
  await page.keyboard.press('Escape')

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await signIn('provider')
  await page.getByRole('link', { name: 'Ma paie' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ma paie' })).toBeVisible()
  await page.getByRole('table', { name: 'Mes sommaires de paie' }).getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: /^Paie de / })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Lignes du sommaire' }).getByText('Alice Tremblay-Fictive').first()).toBeVisible()
  const validate = page.getByRole('button', { name: 'Valider le sommaire' })
  if (await validate.isVisible()) {
    await validate.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Valider' }).click()
    await expect(page.getByText('Sommaire validé.')).toBeVisible()
  }
  await expect(page.getByText('Validée', { exact: true })).toBeVisible()

  if (functions) {
    await page.getByRole('button', { name: /^(Générer la facture|Générer à nouveau)$/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: /^Numéro de facture/ }).fill('E2E-1')
    await dialog.getByRole('button', { name: 'Générer la facture' }).click()
    await expect(page.getByText('Facture générée et ajoutée.')).toBeVisible()
    await expect(page.getByText(/^Facture E2E-1 du /)).toBeVisible()
  }

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await signIn('admin')
  await page.goto('/facturation/paie')
  const row = page.getByRole('table', { name: 'Sommaires du mois' }).getByRole('row').filter({ hasText: 'Félix Gauthier' })
  await expect(row.getByText('Validée', { exact: true })).toBeVisible()
  if (functions) await expect(row.getByText('E2E-1')).toBeVisible()

  // Neither « Paie » for the professional nor anything for the conseillère.
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await signIn('provider')
  await expect(page.getByRole('link', { name: 'Ma paie' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Paie', exact: true })).toHaveCount(0)
}
