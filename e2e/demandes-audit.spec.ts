import { expect, test } from './fixtures/auth'
import { localSql } from './fixtures/db'

/** The inbox columns the newest writer stored (the preference is written after a short pause). */
const storedColumns = () =>
  localSql("select coalesce((select value->>'columns' from public.user_preferences where key = 'demandes.inbox_columns' order by updated_at desc limit 1), '')")

/**
 * Demandes, the after-cutover audit (local only, after `npm run db:reset`): a request with the
 * seed's Marc Gagnon-Fictif as a participant shows on his file's « Demandes » tab (L18, D-46);
 * the inbox's « Trier par » is in the address and « Colonnes » is remembered (L17, D-47).
 * Fictional names, one per run; the columns are put back as they were.
 */
test('the request shows on the participant\'s file; the inbox sorts and keeps her columns', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const name = `Lou Audit${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`

  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  // « Prénom » and « Nom » (D-56): the first word, then the rest.
  await dialog.getByRole('textbox', { name: /^Prénom/ }).fill(name.split(' ')[0]!)
  await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill(name.split(' ').slice(1).join(' '))
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  const id = /\/demandes\/([0-9a-f-]{36})\//.exec(page.url())?.[1]
  expect(id).toBeTruthy()

  // Marc's file as a participant.
  await page.getByRole('tab', { name: 'Participants' }).click()
  await page.getByRole('button', { name: 'Ajouter un dossier de la clinique' }).click()
  await page.getByRole('searchbox', { name: 'Client' }).fill('gagnon')
  await page.getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).last().click()
  await expect(page.getByText('Les participants sont enregistrés.')).toBeVisible()

  // His file's « Demandes » tab lists it, as a participant, and leads back to it.
  await page.goto('/clients')
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('gagnon')
  await page.getByRole('table', { name: 'Clients' }).getByRole('link', { name: 'Marc Gagnon-Fictif' }).click()
  await page.getByRole('tab', { name: 'Demandes' }).click()
  await expect(page).toHaveURL(/\/demandes$/)
  const link = page.locator(`a[href="/demandes/${id}/accueil"]`)
  await expect(link).toBeVisible()
  await expect(page.getByRole('row').filter({ has: link })).toContainText('Participante ou participant')
  await link.click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // The inbox: « Trier par » in the address; « Colonnes » remembered after a reload.
  await page.goto('/demandes')
  await page.getByRole('combobox', { name: 'Trier par' }).selectOption('received_asc')
  await expect(page).toHaveURL(/tri=anciennes/)
  const table = page.getByRole('table').first()
  await expect(table.getByRole('columnheader', { name: 'Motifs' })).toBeHidden()
  await page.getByRole('button', { name: 'Colonnes' }).click()
  // A click, then a retrying expectation: the cache tells the page a moment later (React Query's notify).
  await page.getByRole('checkbox', { name: 'Motifs' }).click()
  await expect(page.getByRole('checkbox', { name: 'Motifs' })).toBeChecked()
  await expect(table.getByRole('columnheader', { name: 'Motifs' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(storedColumns, { timeout: 10_000 }).toContain('motifs')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Trier par' })).toHaveValue('received_asc')
  await expect(page.getByRole('table').first().getByRole('columnheader', { name: 'Motifs' })).toBeVisible()
  await page.getByRole('button', { name: 'Colonnes' }).click()
  await page.getByRole('checkbox', { name: 'Motifs' }).click()
  await expect(page.getByRole('checkbox', { name: 'Motifs' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect.poll(storedColumns, { timeout: 10_000 }).not.toContain('motifs')
})
