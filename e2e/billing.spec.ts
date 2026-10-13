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

  await page.getByRole('button', { name: 'Finaliser sans envoyer' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Facture \d{4}-\d+$/ })).toBeVisible()
  await expect(page.getByText('Émise', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Émettre une note de crédit' }).click()
  const dialog = page.getByRole('dialog', { name: 'Émettre une note de crédit ?' })
  await dialog.getByLabel(/^Raison/).fill('Essai de bout en bout')
  await dialog.getByRole('button', { name: 'Émettre la note de crédit' }).click()
  await expect(page.getByText('Note de crédit émise : la facture est créditée.')).toBeVisible()
  await expect(page.getByText(/^Créditée par la note NC-\d{4}-\d+/)).toBeVisible()
})

/**
 * Facturation F2 (local only, after `npm run db:reset`: the seed starts the morning queue on the
 * last weekday and builds Marc's draft for his session that day). The adjointe sends it from
 * « File du matin », records a payment on it (its receipt goes to Marc), and reads it paid.
 */
test('the adjointe sends the morning queue, then records a payment', async ({ page, signIn }) => {
  await signIn('adminAssistant')
  await page.goto('/facturation')
  await expect(page.getByRole('tab', { name: 'File du matin', selected: true })).toBeVisible()
  const queue = page.getByRole('list', { name: 'Brouillons de la file du matin' })
  await expect(queue.getByRole('link', { name: /Marc Gagnon-Fictif/ })).toBeVisible()
  await page.getByRole('button', { name: /^Tout envoyer \(\d+\)$/ }).click()
  await expect(page.getByText(/^Factures envoyées\s:\s\d+\.$/)).toBeVisible()
  await expect(page.getByText('Rien à envoyer : la file du matin est vide.')).toBeVisible()

  await page.getByRole('tab', { name: 'Émises' }).click()
  await page.getByRole('row', { name: /Marc Gagnon-Fictif/ }).first().getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: /^Facture \d{4}-\d+$/ })).toBeVisible()
  const payment = page.getByRole('form', { name: 'Enregistrer un paiement' })
  await payment.getByLabel(/^Référence/).fill('CAe2e')
  await payment.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(page.getByText('Paiement enregistré : le reçu part au payeur.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Paiements de la facture' }).getByText(/Reçu R-\d{4}-\d+/)).toBeVisible()
  await expect(page.getByText('Payée', { exact: true })).toBeVisible()
})
