import { expect, test } from './fixtures/auth'

/**
 * Facturation F1 (local only, after `npm run db:reset`: the seed enables the module and books
 * Alice with Félix next Monday). The adjointe opens Alice's « Visites et paiements », creates the
 * invoice of that appointment (the session and the file-opening fee), finalises it (`AAAA-N`), then
 * credits it, so a second run finds the appointment to invoice again.
 */
test('the adjointe invoices Alice’s appointment, finalises the invoice, then credits it', async ({ page, signIn }) => {
  await signIn('adminAssistant')
  await page.goto('/clients')
  await page.getByRole('link', { name: /Alice Tremblay-Fictive/ }).first().click()
  await page.getByRole('tab', { name: 'Visites et paiements' }).click()
  const left = page.getByRole('list', { name: 'Rendez-vous à facturer' })
  await left.getByRole('button', { name: 'Créer la facture' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Brouillon de facture' })).toBeVisible()
  const lines = page.getByRole('table', { name: 'Lignes de la facture' })
  await expect(lines.getByText('Ouverture de dossier – individuel')).toBeVisible()

  await page.getByRole('button', { name: 'Finaliser la facture' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Facture \d{4}-\d+$/ })).toBeVisible()
  await expect(page.getByText('Émise', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Émettre une note de crédit' }).click()
  const dialog = page.getByRole('dialog', { name: 'Émettre une note de crédit ?' })
  await dialog.getByLabel(/^Raison/).fill('Essai de bout en bout')
  await dialog.getByRole('button', { name: 'Émettre la note de crédit' }).click()
  await expect(page.getByText('Note de crédit émise : la facture est créditée.')).toBeVisible()
  await expect(page.getByText(/^Créditée par la note NC-\d{4}-\d+/)).toBeVisible()
})
