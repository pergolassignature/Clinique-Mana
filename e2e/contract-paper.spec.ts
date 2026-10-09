import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './fixtures/auth'
import type { Page } from '@playwright/test'

/**
 * « Contrat signé hors application » (P4-520 – P4-526; local only, after `npm run db:reset`).
 * Needs the storage functions served (`storage-upload`, `storage-confirm`: `npx supabase functions
 * serve --env-file supabase/functions/.env`, the e2e origin in `ALLOWED_ORIGINS`), as the
 * onboarding spec.
 *
 * The admin creates a professional, uploads her paper contract on the Documents tab (the date
 * first, then the PDF) → « Signé hors application le … » is the contract in force → « Remplacer »
 * with a newer one → the first one is under « Contrats précédents » → Historique lists both
 * uploads. Each run uses a fresh professional.
 */

const RECORD_URL = /\/professionnels\/[0-9a-f-]{36}\/apercu$/
const PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'files', 'insurance.pdf')

async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click()
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

/** The paper contract's dialog: the date, then the PDF through the dropzone's hidden input. */
async function uploadPaper(page: Page, opener: RegExp | string, title: string, signedOn: string) {
  await page.getByRole('button', { name: opener }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(/^Date de signature/).fill(signedOn)
  await dialog.locator('input[type="file"]').setInputFiles(PDF)
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

test('the admin uploads a paper contract, then replaces it; the first stays under « Contrats précédents »', async ({ page, signIn }) => {
  test.setTimeout(90_000)
  const stamp = Date.now()
  const lastName = `Papier${stamp}`
  await signIn('admin')

  await page.getByRole('link', { name: 'Professionnels' }).first().click()
  await page.getByRole('button', { name: 'Ajouter' }).click()
  const create = page.getByRole('dialog', { name: 'Ajouter un professionnel' })
  await create.getByRole('textbox', { name: /^Prénom/ }).fill('Odile')
  await create.getByRole('textbox', { name: /^Nom/ }).fill(lastName)
  await create.getByRole('textbox', { name: /^Courriel/ }).fill(`odile.${stamp}@exemple.test`)
  await create.getByRole('checkbox', { name: "Envoyer l'invitation maintenant" }).click()
  await create.getByRole('button', { name: 'Créer', exact: true }).click()
  await expect(page).toHaveURL(RECORD_URL)

  await openTab(page, 'Documents')
  const card = page.getByRole('heading', { name: 'Contrat de service', exact: true })
  await expect(card).toBeVisible()
  await expect(page.getByText('Aucun contrat', { exact: true })).toBeVisible()

  // 1. The paper contract, signed on May 1, 2023: a calendar date, shown as written.
  await uploadPaper(page, 'Téléverser un contrat signé', 'Téléverser un contrat signé', '2023-05-01')
  await expect(page.getByRole('heading', { name: 'Contrat en vigueur' })).toBeVisible()
  await expect(page.getByText('Signé hors application le 1 mai 2023', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aperçu du contrat signé hors application le 1 mai 2023' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Préparer un nouveau contrat' })).toBeVisible()

  // 2. « Remplacer »: the newer one is in force, the first one kept under « Contrats précédents ».
  await uploadPaper(page, /^Remplacer le contrat signé hors application/, 'Remplacer le contrat signé hors application', '2025-01-15')
  await expect(page.getByText('Signé hors application le 15 janv. 2025', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Contrats précédents (1)' }).click()
  const previous = page.getByRole('list', { name: 'Contrats précédents' })
  await expect(previous.getByText('Signé hors application le 1 mai 2023', { exact: true })).toBeVisible()

  // 3. Historique: both uploads, with their signature dates.
  await openTab(page, 'Historique')
  await expect(page.getByText('a téléversé un contrat de service signé hors application (signé le 15 janv. 2025)')).toBeVisible()
  await expect(page.getByText('a téléversé un contrat de service signé hors application (signé le 1 mai 2023)')).toBeVisible()
})
