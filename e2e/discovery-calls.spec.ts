import { expect, test } from './fixtures/auth'

/**
 * « Appels découverte » (Demandes D3b; local only, after `npm run db:reset`). Fictional names, one
 * per run.
 *
 * The counselor takes a request, plans its discovery call for tomorrow (Suivi, the default 10 h),
 * finds it on « Appels découverte » → « Demain » with the number to call, gives it to herself, then
 * notes it « Jointe »: the call shows done, and the request's history counts the attempt.
 */
test('a discovery call planned, found on the day of calls, then done', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const name = `Noé Appel${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`
  const phone = `450 555-${String(stamp % 10000).padStart(4, '0')}`
  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  // « Prénom » and « Nom » (D-56): the first word, then the rest.
  await dialog.getByRole('textbox', { name: /^Prénom/ }).fill(name.split(' ')[0]!)
  await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill(name.split(' ').slice(1).join(' '))
  await dialog.getByRole('textbox', { name: 'Téléphone' }).fill(phone)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  await page.getByRole('tab', { name: 'Suivi' }).click()
  const add = page.getByRole('form', { name: 'Ajouter une tâche' })
  await add.getByRole('combobox', { name: 'Tâche' }).selectOption('discovery_call')
  await page.getByRole('button', { name: 'Ajouter la tâche' }).click()
  await expect(page.getByText('La tâche est ajoutée.')).toBeVisible()

  await page.getByRole('link', { name: 'Appels découverte' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Appels découverte' })).toBeVisible()
  await page.getByRole('tab', { name: 'Demain' }).click()
  const row = page.getByRole('listitem').filter({ hasText: name })
  await expect(row.getByText('10:00')).toBeVisible()
  await expect(row.getByRole('link', { name: phone })).toBeVisible()
  await row.getByRole('combobox', { name: `Qui appelle ${name}` }).selectOption({ label: 'Conseillère Locale' })
  await row.getByRole('button', { name: 'Jointe' }).click()
  await expect(page.getByText(`Appel noté pour ${name}.`)).toBeVisible()
  await expect(row.getByText(/Fait.*Jointe/)).toBeVisible()
})
