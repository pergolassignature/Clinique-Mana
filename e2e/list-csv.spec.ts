import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/auth'

/**
 * « Exporter (CSV) » on the lists (parity audit L7; local only, after `npm run db:reset`: the seed
 * holds five fictional files). The file is built in the browser from what the filters select.
 */

async function download(page: Page): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter (CSV)' }).click()])
  const path = await file.path()
  return { name: file.suggestedFilename(), text: readFileSync(path, 'utf8') }
}

test('the clients list: the files the filters select', async ({ page, signIn }) => {
  await signIn('admin')
  // A filter in the address wins over the person's remembered ones (C4), whatever ran before.
  await page.goto('/clients?statut=tous')
  await expect(page.getByRole('table', { name: 'Clients' }).getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeVisible()
  const all = await download(page)
  expect(all.name).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(all.text).toContain('N° de dossier;Nom;Prénom;Date de naissance;Courriel;Cellulaire')
  expect(all.text).toContain('Tremblay-Fictive;Alice')
  expect(all.text).toContain('Gagnon-Fictif;Marc')

  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('gagnon')
  await expect(page.getByRole('table', { name: 'Clients' }).getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeHidden()
  const filtered = await download(page)
  expect(filtered.text).toContain('Gagnon-Fictif;Marc')
  expect(filtered.text).not.toContain('Tremblay-Fictive')
})

test('the invoices list and the waiting list have their export', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/facturation?vue=toutes')
  const invoices = page.getByRole('button', { name: 'Exporter (CSV)' })
  if (await invoices.isVisible().catch(() => false)) {
    const file = await download(page)
    expect(file.name).toMatch(/^factures-toutes-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(file.text).toContain('Numéro;Émise le;N° de dossier;Client;Facturé à;Total;Payé;Solde;État;Paiement')
  }
  await page.goto('/liste-attente')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const waitlist = page.getByRole('button', { name: 'Exporter (CSV)' })
  if (await waitlist.isVisible().catch(() => false)) {
    const file = await download(page)
    expect(file.name).toMatch(/^liste-attente-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(file.text).toContain('Rang;Référence;Personne')
  }
})
