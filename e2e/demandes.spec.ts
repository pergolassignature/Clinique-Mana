import { expect, test } from './fixtures/auth'

/**
 * Demandes, D2 (local only, after `npm run db:reset`: the seed enables Demandes; the counselor holds
 * demandes.view / manage / notes by the template, D-1). Fictional names, one per run.
 *
 * The counselor takes a call: « Nouvelle demande » (la saisie rapide) → the record opens → her
 * file made through Clients' picker → « Noter un appel » (no answer, next try tomorrow) → the
 * inbox shows it « Sans réponse » → « Je m'en occupe » → a callback task in « Suivi » →
 * « Historique » tells it → closed with a reason.
 */
test('the counselor takes a request from the first call to its closing', async ({ page, signIn }) => {
  // Letters only (a family name), and a phone per run, so a new file never meets an earlier run's.
  const stamp = Date.now() % 100000
  const name = `Lucie Essai${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`
  const phone = `514 555-${String(stamp % 10000).padStart(4, '0')}`
  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Demandes' })).toBeVisible()

  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  await dialog.getByRole('textbox', { name: 'Nom' }).fill(name)
  await dialog.getByRole('textbox', { name: 'Téléphone' }).fill(phone)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page).toHaveURL(/\/demandes\/[0-9a-f-]{36}\/accueil$/)
  const record = page.url()

  // Her file: Clients' picker in « Accueil », « Nouveau client » prefilled from the request.
  await page.getByRole('button', { name: 'Rattacher un dossier' }).click()
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau client' })
  await expect(sheet.getByRole('textbox', { name: /^Prénom/ })).toHaveValue('Lucie')
  await sheet.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByText('Le dossier est rattaché.')).toBeVisible()
  await expect(page).toHaveURL(/\/demandes\/[0-9a-f-]{36}\/accueil$/)
  await expect(page.getByRole('button', { name: 'Changer de dossier' })).toBeVisible()

  // « Provenance » corrected (D-26): the channel typed by mistake; nothing captured to show.
  const source = page.getByRole('region', { name: 'Provenance' })
  await expect(source.getByText('Aucune donnée de campagne')).toBeVisible()
  await source.getByRole('button', { name: 'Modifier' }).click()
  await source.getByRole('combobox', { name: 'Canal' }).selectOption('email')
  await source.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Provenance enregistrée.')).toBeVisible()
  await expect(source.getByText('Courriel', { exact: true })).toBeVisible()

  // A first call, not answered.
  await page.getByRole('button', { name: 'Noter un appel' }).first().click()
  const call = page.getByRole('dialog', { name: `Noter un appel : ${name}` })
  await expect(call.getByRole('combobox', { name: 'Résultat' })).toHaveValue('no_answer')
  await call.getByRole('button', { name: "Enregistrer l'essai" }).click()
  await expect(call).toBeHidden()
  await expect(page.getByText('Rappelée dans les délais')).toBeVisible()

  // Accueil « Demandes à traiter » (L29): the call went unanswered; the figure opens that list.
  await page.goto('/accueil')
  const queue = page.getByRole('region', { name: 'Demandes à traiter' })
  await queue.getByRole('link', { name: /sans réponse au dernier essai/ }).click()
  await expect(page).toHaveURL(/filtres=sans-reponse/)
  await page.goto(record)

  // « Je m'en occupe », then a callback in « Suivi ».
  await page.getByRole('button', { name: "Je m'en occupe" }).click()
  await expect(page.getByRole('button', { name: 'Je laisse la demande' })).toBeVisible()
  await page.getByRole('tab', { name: 'Suivi' }).click()
  await page.getByRole('form', { name: 'Ajouter une tâche' }).getByRole('combobox', { name: 'Tâche' }).selectOption('callback')
  await page.getByRole('button', { name: 'Ajouter la tâche' }).click()
  await expect(page.getByRole('list', { name: 'Tâches ouvertes' }).getByText('Rappel')).toBeVisible()

  // The inbox: « Sans réponse », handled by her.
  await page.getByRole('link', { name: 'Demandes' }).first().click()
  await page.getByRole('button', { name: /Sans réponse/ }).click()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByText(/s’en occupe/)).toBeVisible()
  await row.getByRole('link', { name }).click()

  // Historique, then closed with a reason.
  await page.getByRole('tab', { name: 'Historique' }).click()
  await expect(page.getByText('Demande reçue')).toBeVisible()
  await expect(page.getByText('Essai : Téléphone · Pas de réponse')).toBeVisible()
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('closed')
  const close = page.getByRole('alertdialog', { name: 'Fermer la demande ?' })
  await close.getByRole('combobox', { name: 'Raison' }).selectOption('duplicate')
  await close.getByRole('button', { name: 'Fermer la demande' }).click()
  await expect(page.getByText('Fermée : En double').first()).toBeVisible()
})

test('the professional has no « Demandes »', async ({ page, signIn }) => {
  await signIn('provider')
  await expect(page.getByRole('link', { name: 'Demandes' })).toHaveCount(0)
})
