import { expect, test } from './fixtures/auth'

/**
 * Services et tarifs (plan S3.4; local only, after `npm run db:reset`: the seed enables the module
 * and holds the retention grids, so a psychologist's 50 min is 175 $). The admin adds a grid
 * service offered by psychologists, gives it a student rate, reads both prices in « Prix », then
 * archives it, so a second run on the same database passes too. A professional never sees the
 * section (S-8).
 */

const SECTION_URL = '/parametres/services-et-tarifs'

/** Today in the clinic (America/Toronto), as a date input takes it. */
function clinicToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

test('the admin adds a service with a student rate and reads its prices', async ({ page, signIn }) => {
  const stamp = Date.now()
  const code = 60300 + (stamp % 600)
  const name = `Atelier essai ${stamp}`
  await signIn('admin')
  await page.goto(SECTION_URL)
  await expect(page.getByRole('heading', { level: 1, name: 'Services et tarifs' })).toBeVisible()
  const catalogue = page.getByRole('table', { name: 'Catalogue des services' })
  await expect(catalogue.getByText('10150', { exact: true })).toBeVisible()

  // « Ajouter un service »: family 60, a five-digit code in its range, priced by the 50 min column.
  await page.getByRole('button', { name: 'Ajouter un service' }).click()
  const sheet = page.getByRole('dialog', { name: 'Ajouter un service' })
  await sheet.getByLabel('Famille').selectOption({ label: '60 · Ateliers' })
  await sheet.getByRole('textbox', { name: /^Code/ }).fill(String(code))
  await sheet.getByRole('textbox', { name: /^Clé/ }).fill(`e2e_${stamp}`)
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill(name)
  await expect(sheet.getByLabel('Source du prix')).toHaveValue('grid')
  await sheet.getByRole('checkbox', { name: 'Psychologue', exact: true }).click()
  await sheet.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText('Service ajouté.')).toBeVisible()
  await expect(catalogue.getByRole('rowheader', { name })).toBeVisible()

  // « Nouveau tarif »: student, psychologists, 25 $ off from today.
  await page.getByRole('button', { name: 'Nouveau tarif' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouveau tarif' })
  await dialog.getByLabel('Service').selectOption({ label: `${code} · ${name}` })
  await dialog.getByLabel('Profession').selectOption({ label: 'Psychologue' })
  await dialog.getByLabel('Rabais').selectOption({ label: 'Montant en moins' })
  await dialog.getByRole('textbox', { name: /^Valeur/ }).fill('25')
  await dialog.getByLabel(/^À partir du/).fill(clinicToday())
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Tarif enregistré.')).toBeVisible()

  // « Prix »: the grid's 175 $ for a psychologist, and the student rate under it.
  const prices = page.getByRole('table', { name: 'Prix par profession' })
  const headers = await prices.getByRole('columnheader').allTextContents()
  const column = headers.findIndex((header) => header.startsWith(String(code)))
  expect(column).toBeGreaterThan(0)
  const cell = prices.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Psychologue', exact: true }) }).getByRole('cell').nth(column)
  await expect(cell).toHaveText(/^175,00\s\$Étudiant 150,00\s\$$/)
  await expect(page.getByText('Aucun écart : les grilles reproduisent les prix observés.')).toBeVisible()

  // Archived: it leaves the active list (and « Prix »).
  await catalogue.getByRole('button', { name: `Actions pour « ${name} »` }).click()
  await page.getByRole('menuitem', { name: 'Archiver' }).click()
  await expect(page.getByText('Service archivé.')).toBeVisible()
  await expect(catalogue.getByRole('rowheader', { name })).toBeHidden()
})

test('a professional never sees the clinic’s price settings', async ({ page, signIn }) => {
  await signIn('provider')
  await page.goto(SECTION_URL)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Services et tarifs' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Services et tarifs' })).toHaveCount(0)
})
