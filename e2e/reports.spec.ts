import type { Page } from '@playwright/test'
import { ACCOUNTS, SEED_PASSWORD } from './fixtures/accounts'
import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * Rapports RP1 (local only, after `npm run db:reset`). The seed leaves Rapports off, as every
 * clinic starts (an open Rapports would stop Facturation from being reserved for testers,
 * `module-testers.spec.ts`): each test switches it on in Paramètres → Modules and off again in
 * `finally`.
 *
 * 1. The admin opens « Revenus » from the menu: three views, this month; « Par paiement » adds the
 *    mode filter; a period longer than a year is said.
 * 2. « Annulations »: per reason, then « Clients à relancer » (the tab in the address).
 * 3. The adjointe has « Revenus » but not « Annulations ».
 * 4. « Consentements » (Clients C5b): today's states per consent, per month.
 * 5. « Indicateurs des demandes » (Demandes D6; the seed enables Demandes): this year's totals, then
 *    « Provenance » and « Liste d'attente et places » (the tabs in the address).
 */

async function setReports(page: Page, on: boolean) {
  await page.goto('/parametres/modules')
  const reports = page.getByRole('switch', { name: 'Rapports', exact: true })
  if ((await reports.getAttribute('aria-checked')) === String(on)) return
  await reports.click()
  await expect(page.getByText('Modules mis à jour.')).toBeVisible()
  await expect(reports).toHaveAttribute('aria-checked', String(on))
}

async function withReports(page: Page, signIn: (account: 'admin') => Promise<void>, run: () => Promise<void>) {
  await signIn('admin')
  await setReports(page, true)
  try {
    await run()
  } finally {
    await setReports(page, false)
  }
}

test('the admin reads « Revenus » by invoice, service and payment', async ({ page, signIn }) => {
  await withReports(page, signIn, async () => {
    await page.goto('/accueil')
    await page.getByRole('link', { name: 'Revenus' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Revenus' })).toBeVisible()
    const views = page.getByRole('tablist', { name: 'Vues des revenus' })
    await expect(views.getByRole('tab', { name: 'Par facture' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Totaux de la période')).toBeVisible()
    await views.getByRole('tab', { name: 'Par paiement' }).click()
    await expect(page).toHaveURL(/vue=payment/)
    await expect(page.getByLabel('Mode de paiement')).toBeVisible()
    await views.getByRole('tab', { name: 'Par service' }).click()
    await expect(page.getByLabel('Mode de paiement')).toHaveCount(0)
    await page.getByLabel('Du', { exact: true }).fill('2024-01-01')
    await expect(page.getByText(/La période va jusqu’à un an\s*:\s*choisissez-en une plus courte\./)).toBeVisible()
    await page.getByRole('button', { name: 'Ce mois-ci' }).click()
    await expect(page.getByLabel('Totaux de la période')).toBeVisible()
  })
})

test('the admin reads « Annulations et absences », then « Clients à relancer »', async ({ page, signIn }) => {
  await withReports(page, signIn, async () => {
    await page.goto('/accueil')
    await page.getByRole('link', { name: 'Annulations' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Annulations et absences' })).toBeVisible()
    await page.getByRole('button', { name: 'Cette année' }).click()
    await expect(page.getByLabel('Totaux de la période')).toBeVisible()
    await page.getByRole('tab', { name: 'Clients à relancer' }).click()
    await expect(page).toHaveURL(/onglet=relancer/)
    await expect(page.getByText(/Clients à relancer\s*:\s*\d+\./)).toBeVisible()
  })
})

test('the admin reads « Consentements »: today per consent (the seed’s imported one counted), per month (CC-19)', async ({ page, signIn }) => {
  await withReports(page, signIn, async () => {
    await page.goto('/accueil')
    await page.getByRole('link', { name: 'Rapport des consentements' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Consentements' })).toBeVisible()
    const gaps = page.getByRole('table', { name: 'Aujourd’hui, par consentement' })
    await expect(gaps.getByRole('row').filter({ hasText: 'Consentement général' })).toBeVisible()
    await page.getByRole('button', { name: 'Cette année' }).click()
    await expect(page.getByRole('table', { name: 'Signatures et retraits par mois' })).toBeVisible()
    await expect(page.getByLabel('Totaux')).toBeVisible()
  })
})

test('the adjointe has « Revenus », not « Annulations »', async ({ page, signIn, browser }) => {
  await withReports(page, signIn, async () => {
    const other = await browser.newContext({ baseURL: E2E_ORIGIN, locale: 'fr-CA' })
    try {
      const adjointe = await other.newPage()
      await adjointe.goto('/connexion')
      await adjointe.getByLabel('Courriel').fill(ACCOUNTS.adminAssistant.email)
      await adjointe.getByLabel('Mot de passe').fill(SEED_PASSWORD)
      await adjointe.getByRole('button', { name: 'Se connecter' }).click()
      await expect(adjointe).toHaveURL(/\/accueil$/)
      const nav = adjointe.getByRole('navigation', { name: 'Menu principal' })
      await expect(nav.getByRole('link', { name: 'Revenus' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Annulations' })).toHaveCount(0)
    } finally {
      await other.close()
    }
  })
})

test('the admin reads « Indicateurs des demandes »: activity, sources, waiting list and places', async ({ page, signIn }) => {
  await withReports(page, signIn, async () => {
    await page.goto('/accueil')
    await page.getByRole('link', { name: 'Indicateurs des demandes' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Indicateurs des demandes' })).toBeVisible()
    await page.getByRole('button', { name: 'Cette année' }).click()
    const tabs = page.getByRole('tablist', { name: 'Vues des indicateurs' })
    await expect(tabs.getByRole('tab', { name: 'Activité' })).toHaveAttribute('aria-selected', 'true')
    // Alone on a fresh seed, no request this year: the tab says so.
    await expect(page.getByLabel('Totaux de la période').or(page.getByText('Aucune demande reçue ni jumelée dans cette période.')).first()).toBeVisible()
    await tabs.getByRole('tab', { name: 'Provenance' }).click()
    await expect(page).toHaveURL(/onglet=provenance/)
    // The seed may hold no request this year (the spec runs on its own): the tab then says so.
    await expect(
      page.getByRole('heading', { name: 'Comment avez-vous entendu parler de MANA ?' }).or(page.getByText('Aucune demande reçue dans cette période.')),
    ).toBeVisible()
    await tabs.getByRole('tab', { name: 'Liste d\'attente et places' }).click()
    await expect(page).toHaveURL(/onglet=liste-attente/)
    await expect(page.getByRole('heading', { name: 'Places des professionnels' })).toBeVisible()
  })
})
