import { expect, test } from './fixtures/auth'

/**
 * The waiting list, part 1 (Demandes D3; local only, after `npm run db:reset`). Fictional names,
 * one per run.
 *
 * The counselor takes a request, makes its client file through Clients' picker, moves it to
 * « Liste d'attente » (the registration: a profession, « Prioritaire » with its reason), finds the
 * person on « Liste d'attente » with her rank, opens her entry: the fee waived (PAE), a call noted,
 * then she leaves the list « Orientée ailleurs » — the request closes with the same reason.
 * (Whether the entry is « Active » depends on the waitlist consent's rule, which consents.spec may
 * switch on: not asserted here; pgTAP 122 covers it.)
 */
test('a request registered on the waiting list, followed, then out of it', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const name = `Maude Attente${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`
  const phone = `438 555-${String(stamp % 10000).padStart(4, '0')}`
  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes' }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  // « Prénom » and « Nom » (D-56): the first word, then the rest.
  await dialog.getByRole('textbox', { name: /^Prénom/ }).fill(name.split(' ')[0]!)
  await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill(name.split(' ').slice(1).join(' '))
  await dialog.getByRole('textbox', { name: 'Téléphone' }).fill(phone)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // Without a file, the registration says so. Chosen right after the record opens, « Liste
  // d'attente » waits for the request's registrations (« Lecture des inscriptions… »), then the
  // dialog opens: the spec waits on the dialog, never on time.
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('waitlist')
  const register = page.getByRole('dialog', { name: "Inscrire sur la liste d'attente" })
  await expect(register).toBeVisible()
  await expect(register.getByRole('alert')).toContainText("Rattachez d'abord le dossier du client")
  await page.keyboard.press('Escape')

  // Her file, then the registration.
  await page.getByRole('button', { name: 'Rattacher un dossier' }).click()
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  await page.getByRole('dialog', { name: 'Nouveau client' }).getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByText('Le dossier est rattaché.')).toBeVisible()
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('waitlist')
  await expect(register).toBeVisible()
  await register.getByRole('combobox', { name: 'Profession', exact: true }).selectOption({ index: 1 })
  const list = (await register.getByRole('combobox', { name: 'Profession', exact: true }).locator('option:checked').textContent())!.replace(/ \(\d+ en attente\)$/, '')
  await register.getByRole('button', { name: 'Prioritaire' }).click()
  await register.getByRole('textbox', { name: 'Pourquoi est-ce prioritaire ?' }).fill('Enfant en attente')
  await register.getByRole('button', { name: 'Inscrire' }).click()
  await expect(page.getByText("La demande est sur la liste d'attente.")).toBeVisible()
  await page.getByRole('tab', { name: 'Suivi' }).click()
  await expect(page.getByRole('list', { name: "Liste d'attente" }).getByRole('link', { name: list })).toBeVisible()

  // « Liste d'attente »: her list, her rank (a priority among the first), « Frais à facturer ».
  await page.getByRole('link', { name: "Liste d'attente" }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: "Liste d'attente" })).toBeVisible()
  const listBox = page.getByRole('combobox', { name: 'Liste' })
  await listBox.selectOption((await listBox.locator('option', { hasText: `${list} (` }).first().getAttribute('value'))!)
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByText(/^\d+(re|e) sur \d+$/)).toBeVisible()
  await expect(row.getByText('Prioritaire')).toBeVisible()
  await expect(row.getByText('Frais à facturer')).toBeVisible()

  // Her entry: the fee waived, a call noted, then out of the list.
  await row.getByRole('button', { name: `Ouvrir l'inscription de ${name}` }).click()
  const sheet = page.getByRole('dialog', { name })
  await sheet.getByRole('button', { name: 'Exonérer les frais…' }).click()
  await sheet.getByRole('textbox', { name: "Raison de l'exonération" }).fill('PAE')
  await sheet.getByRole('button', { name: 'Exonérer', exact: true }).click()
  await expect(sheet.getByText('Frais exonérés')).toBeVisible()
  await sheet.getByRole('button', { name: 'Noter le suivi' }).click()
  await expect(sheet.getByRole('list', { name: 'Suivis notés' }).getByText(/Appel.*Personne jointe/)).toBeVisible()
  const exit = sheet.getByRole('form', { name: 'Sortir de la liste' })
  await exit.getByRole('combobox', { name: 'Raison' }).selectOption('referred_elsewhere')
  await exit.getByRole('button', { name: 'Sortir de la liste' }).click()
  await expect(page.getByText('Sortie de la liste : Orientée ailleurs.')).toBeVisible()

  // The request followed: closed « Orientée ailleurs ».
  await page.goto('/demandes?vue=fermees')
  await page.getByRole('row').filter({ hasText: name }).getByRole('link', { name }).click()
  await expect(page.getByText('Fermée : Orientée ailleurs')).toBeVisible()
})
