import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/auth'
import { forgetRememberedFilters } from './fixtures/db'

/**
 * Clients (plan C3.6; local only, after `npm run db:reset`: the seed enables the module and holds
 * five fictional files). The admin finds a seeded file, is stopped from creating it twice, creates
 * a new person, then adds a parent with rights from « Proches ». Each run creates its own file
 * (a stamped name), so a second run on the same database passes too. The provider login (Félix,
 * seed) sees her own clients only, never the clinic list (CL-5).
 */

// A spec never leaves a remembered list filter behind (another spec opening « Clients » would see a filtered list).
test.afterEach(() => forgetRememberedFilters('clients.list_filters'))

test('the admin is stopped on a duplicate, creates a file and adds a parent with rights', async ({ page, signIn }) => {
  const stamp = Date.now()
  const firstName = `Essai${stamp}`
  await signIn('admin')
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Clients' })
  await expect(table.getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeVisible()

  // The search is by name, number, email or phone.
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('gagnon')
  await expect(table.getByRole('link', { name: 'Marc Gagnon-Fictif' })).toBeVisible()
  await expect(table.getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeHidden()
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('')

  // « Nouveau client »: the seeded file is found while typing; creation is refused.
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau client' })
  await sheet.getByRole('textbox', { name: /^Prénom/ }).fill('Alice')
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill('Tremblay-Fictive')
  await sheet.getByRole('textbox', { name: /^Courriel/ }).fill('alice.fictive@exemple.test')
  await expect(sheet.getByText("Ce client a déjà un dossier : ouvrez-le plutôt que d'en créer un autre.")).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Ouvrir le dossier existant' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Créer le dossier' })).toHaveAttribute('aria-disabled', 'true')

  // Another person: the warning goes, the file is created and opened.
  await sheet.getByRole('textbox', { name: /^Prénom/ }).fill(firstName)
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill('Fictif')
  await sheet.getByRole('textbox', { name: /^Courriel/ }).fill(`essai.${stamp}@exemple.test`)
  await expect(sheet.getByText("Ce client a déjà un dossier : ouvrez-le plutôt que d'en créer un autre.")).toBeHidden()
  // « Référé par » (CL-30): a file of the clinic, found by typing.
  await sheet.getByRole('combobox', { name: 'Référé par' }).fill('Gagnon-Fictif')
  await sheet.getByRole('option', { name: /Marc Gagnon-Fictif/ }).click()
  await expect(sheet.getByRole('link', { name: /^CLI-\d{6} · Marc Gagnon-Fictif$/ })).toBeVisible()
  await sheet.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/apercu$/)
  await expect(page.getByRole('heading', { level: 1, name: `${firstName} Fictif` })).toBeVisible()
  await expect(page.getByText('Dossier créé.')).toBeVisible()
  await expect(page.getByRole('link', { name: /^CLI-\d{6} · Marc Gagnon-Fictif$/ })).toBeVisible()

  // « Informations », « Dossier »: back to a typed name, which replaces the file.
  await page.getByRole('tab', { name: 'Informations' }).click()
  const fileCard = page.getByRole('form', { name: 'Dossier' })
  await fileCard.getByRole('button', { name: 'Retirer le dossier' }).click()
  await fileCard.getByRole('combobox', { name: 'Référé par' }).fill('Une amie de la famille')
  await fileCard.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Dossier enregistré.')).toBeVisible()
  await expect(fileCard.getByRole('combobox', { name: 'Référé par' })).toHaveValue('Une amie de la famille')
  await page.getByRole('tab', { name: 'Aperçu' }).click()
  await expect(page.getByText('Une amie de la famille')).toBeVisible()

  // « Proches »: Marc is the parent, manages the appointments and receives the invoices.
  await page.getByRole('tab', { name: 'Proches' }).click()
  await expect(page).toHaveURL(/\/proches$/)
  await page.getByRole('button', { name: 'Ajouter un proche' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un proche' })
  await dialog.getByRole('searchbox', { name: /^Proche/ }).fill('Gagnon-Fictif')
  await dialog.getByRole('list', { name: 'Dossiers trouvés' }).getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await dialog.getByLabel(/^Ce proche est/).selectOption({ label: 'Parent' })
  const marcRights = dialog.getByRole('group', { name: /^Ce que Marc Gagnon-Fictif peut faire/ })
  await marcRights.getByRole('checkbox', { name: 'Gère les rendez-vous et formulaires' }).click()
  await marcRights.getByRole('checkbox', { name: 'Reçoit les reçus et factures' }).click()
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Proche enregistré.')).toBeVisible()
  const row = page.getByRole('table', { name: 'Proches du client' }).getByRole('row').filter({ hasText: 'Marc Gagnon-Fictif' })
  await expect(row).toContainText('Parent')
  await expect(row).toContainText('Gère les rendez-vous et formulaires')
  await expect(row).toContainText('Reçoit les reçus et factures')

  // Leave the database as found: archive the new file.
  await page.getByRole('button', { name: 'Archiver' }).click()
  await expect(page.getByText('Dossier archivé.')).toBeVisible()
})

test('a professional sees « Mes clients », never the clinic list', async ({ page, signIn }) => {
  await signIn('provider')
  await page.goto('/mes-clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Mes clients' })).toBeVisible()
  await expect(page.getByText('Alice Tremblay-Fictive')).toBeVisible()
  await expect(page.getByText('Léa Gagnon-Fictive')).toBeVisible()
  // Paule has no appointment with Félix (the seed books Alice, Léa and Marc with him).
  await expect(page.getByText('Paule Roy-Fictive')).toBeHidden()
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Clients', exact: true })).toBeHidden()
})

/** Creates a file through « Nouveau client » and returns its record URL. */
async function createFile(page: Page, first: string, last: string, extra: { email?: string; birthday?: string; confirmMedium?: boolean }) {
  await page.goto('/clients')
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau client' })
  await sheet.getByRole('textbox', { name: /^Prénom/ }).fill(first)
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill(last)
  if (extra.email) await sheet.getByRole('textbox', { name: /^Courriel/ }).fill(extra.email)
  if (extra.birthday) await sheet.getByLabel(/^Date de naissance/).fill(extra.birthday)
  if (extra.confirmMedium) await sheet.getByRole('checkbox', { name: "C'est une autre personne" }).click()
  await sheet.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/apercu$/)
  return page.url()
}

test('C4: two files of one person are merged, the kept one keeps its history; then the Loi 25 export and anonymisation', async ({ page, signIn }) => {
  const stamp = Date.now()
  const first = `Fusion${stamp}`
  await signIn('admin')
  const kept = await createFile(page, first, 'Fictif', { email: `fusion.${stamp}@exemple.test`, birthday: '1985-05-05' })
  // The same name and birth date: a MEDIUM duplicate, created after « C'est une autre personne ».
  await createFile(page, first, 'Fictif', { birthday: '1985-05-05', confirmMedium: true })

  // « Doublons possibles » on the second file, « Fusionner »: the older file is kept by default.
  await expect(page.getByText('Doublons possibles : ces dossiers semblent être la même personne.')).toBeVisible()
  await page.getByRole('button', { name: 'Fusionner', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Fusionner deux dossiers' })
  await expect(dialog.getByText('Une fusion ne se défait pas.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Fusionner les dossiers' }).click()
  await expect(page).toHaveURL(kept)
  await expect(page.getByText('Dossiers fusionnés.')).toBeVisible()

  // « Historique » names the merge.
  await page.getByRole('tab', { name: 'Historique' }).click()
  await expect(page.getByText(/Fusions de dossiers/).first()).toBeVisible()

  // « Confidentialité »: the export downloads a PDF named by the number, never the name.
  await page.getByRole('button', { name: 'Autres actions sur le dossier' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Exporter le dossier (PDF)' }).click()
  expect((await download).suggestedFilename()).toMatch(/^dossier-CLI-\d{6}\.pdf$/)

  // « Anonymiser »: the number typed, then the file reads « Anonymisé ».
  const number = (await page.getByText(/^CLI-\d{6}$/).first().textContent()) ?? ''
  await page.getByRole('button', { name: 'Autres actions sur le dossier' }).click()
  await page.getByRole('menuitem', { name: 'Anonymiser le dossier…' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Anonymiser ce dossier ?' })
  await confirm.getByRole('textbox').fill(number)
  await confirm.getByRole('button', { name: 'Anonymiser' }).click()
  await expect(page.getByText('Dossier anonymisé.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Client anonymisé')
})

test('C4: ⌘K finds a file by name', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/clients')
  await page.getByRole('banner').getByRole('button', { name: 'Rechercher' }).click()
  const palette = page.getByRole('dialog', { name: 'Rechercher' })
  await palette.getByRole('combobox').fill('Tremblay-Fic')
  await palette.getByRole('option', { name: /Alice Tremblay-Fictive/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Alice Tremblay-Fictive/ })).toBeVisible()
})

test('A-2: « Dernier rendez-vous » on the list: Alice’s last session, the filter and the order', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/clients')
  const table = page.getByRole('table', { name: 'Clients' })
  await expect(table.getByRole('columnheader', { name: 'Dernier rendez-vous' })).toBeVisible()
  // The seed's completed session last week: a date, never « Aucun ».
  const alice = table.getByRole('row').filter({ has: page.getByRole('link', { name: /Alice Tremblay-Fictive/ }) })
  await expect(alice).toBeVisible()
  await expect(alice).not.toContainText('Aucun')
  const lastVisit = page.getByRole('combobox', { name: 'Dernier rendez-vous' })
  const sort = page.getByRole('combobox', { name: 'Trier par' })
  await lastVisit.selectOption({ label: 'Dans les 30 derniers jours' })
  await expect(page).toHaveURL(/dernier=30-jours/)
  await expect(alice).toBeVisible()
  await sort.selectOption({ label: "Dernier rendez-vous, le plus récent d'abord" })
  await expect(page).toHaveURL(/tri=recents/)
  await lastVisit.selectOption({ label: 'Aucun rendez-vous' })
  await expect(page).toHaveURL(/dernier=jamais/)
  await expect(alice).toHaveCount(0)
  // Back to the defaults (the filters are remembered for the next runs).
  await lastVisit.selectOption({ label: 'Tout dernier rendez-vous' })
  await expect(page).not.toHaveURL(/dernier=/)
  await expect(page).toHaveURL(/tri=recents/)
  await sort.selectOption({ label: 'Nom' })
  await expect(page).not.toHaveURL(/tri=|dernier=/)
  await expect(alice).toBeVisible()
})
