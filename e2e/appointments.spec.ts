import { expect, test } from './fixtures/auth'

/**
 * Rendez-vous R2 (local only, after `npm run db:reset`: the seed enables the module, makes Félix
 * available Monday to Friday 9:00–17:00 and books three appointments next week). The admin opens
 * Félix's next week, books a client on a free slot, drags it 30 minutes later, then cancels it
 * so a second run passes too. A booking outside his availability needs the staff's reason (AP-12).
 */

const FELIX = '5eed0000-0000-0000-0000-000000000004'

/** Next week's Monday, as the agenda's `date` parameter (clinic time). */
function nextMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const date = new Date(`${today}T12:00:00Z`)
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + 8 - weekday)
  return date.toISOString().slice(0, 10)
}

test('the admin books, moves and cancels an appointment in Félix’s week', async ({ page, signIn }) => {
  const monday = nextMonday()
  const friday = new Date(`${monday}T12:00:00Z`)
  friday.setUTCDate(friday.getUTCDate() + 4)
  const fridayKey = friday.toISOString().slice(0, 10)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${monday}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Semaine' })).toHaveAttribute('aria-selected', 'true')
  // The seed's Monday 10:00 with Alice.
  await expect(page.getByRole('button', { name: /^10:00, Alice Tremblay-Fictive(,|$)/ })).toBeVisible()

  // Friday 10:00: 4 hours below 6:00 at 48 px an hour.
  const column = page.getByTestId(`agenda-column-${fridayKey}`)
  await column.click({ position: { x: 20, y: 4 * 48 + 2 } })
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await expect(sheet.getByLabel(/^Heure/)).toHaveValue('10:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Gagnon-Fictif')
  await sheet.getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()
  const block = page.getByRole('button', { name: /^10:00, Marc Gagnon-Fictif(,|$)/ })
  await expect(block).toBeVisible()

  // Drag it 30 minutes later (24 px).
  await block.scrollIntoViewIfNeeded()
  const box = (await block.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 4 })
  await page.mouse.move(box.x + box.width / 2, box.y + 32, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByText('Rendez-vous déplacé.')).toBeVisible()
  const moved = page.getByRole('button', { name: /^10:30, Marc Gagnon-Fictif(,|$)/ })
  await expect(moved).toBeVisible()

  // Cancel it (and leave the database as found).
  await moved.click()
  const editor = page.getByRole('dialog', { name: 'Marc Gagnon-Fictif' })
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('outside the availability: refused, then booked with « Hors disponibilités » and a reason (AP-12)', async ({ page, signIn }) => {
  const monday = nextMonday()
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${monday}&vue=jour`)
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('19:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Tremblay-Fic')
  await sheet.getByRole('button', { name: /Alice Tremblay-Fictive/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(sheet.getByText('Hors disponibilités', { exact: true })).toBeVisible()
  await sheet.getByRole('textbox', { name: /^Raison « Hors disponibilités »/ }).fill('Soirée exceptionnelle')
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()
  const block = page.getByRole('button', { name: /^19:00, Alice Tremblay-Fictive(,|$)/ })
  await block.click()
  const editor = page.getByRole('dialog', { name: 'Alice Tremblay-Fictive' })
  await expect(editor.getByText('Hors disponibilités').first()).toBeVisible()
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Autre' })
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('a weekly series: the conflict with Alice listed, skipped, then the rest of the series cancelled (R3)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const following = new Date(`${monday}T12:00:00Z`)
  following.setUTCDate(following.getUTCDate() + 7)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${monday}&vue=jour`)
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('10:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Gagnon-Fictif')
  await sheet.getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await sheet.getByRole('checkbox', { name: 'Répéter ce rendez-vous' }).click()
  await sheet.getByRole('spinbutton', { name: /^Rendez-vous/ }).fill('4')
  // Next Monday 10:00 is Alice's (the seed).
  await expect(sheet.getByText('4 dates, dont 1 en conflit.')).toBeVisible()
  await expect(sheet.getByText('Déjà un rendez-vous')).toBeVisible()
  await sheet.getByRole('checkbox', { name: 'Ignorer les dates en conflit (1)' }).click()
  await sheet.getByRole('button', { name: 'Réserver 3 rendez-vous' }).click()
  await expect(page.getByText('Série réservée.')).toBeVisible()

  // The week after: Marc at 10:00, part of the series; cancel it and the rest.
  await page.goto(`/agenda?professionnel=${FELIX}&date=${following.toISOString().slice(0, 10)}&vue=jour`)
  await page.getByRole('button', { name: /^10:00, Marc Gagnon-Fictif(,|$)/ }).click()
  const editor = page.getByRole('dialog', { name: 'Marc Gagnon-Fictif' })
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await editor.getByRole('checkbox', { name: 'Annuler aussi les rendez-vous suivants de la série' }).click()
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous de la série annulés.')).toBeVisible()
})

test('« Mon agenda »: Félix sees his week and adds then removes a personal appointment (R5)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const tuesday = new Date(`${monday}T12:00:00Z`)
  tuesday.setUTCDate(tuesday.getUTCDate() + 1)
  await signIn('provider')
  await page.getByRole('link', { name: 'Mon agenda' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mon agenda' })).toBeVisible()
  await page.goto(`/mon-agenda?date=${monday}`)
  await expect(page.getByRole('button', { name: /^10:00, Alice Tremblay-Fictive(,|$)/ })).toBeVisible()
  await expect(page.getByLabel('Professionnel')).toHaveCount(0)

  // Tuesday 12:00: 6 hours below 6:00 at 48 px an hour.
  const column = page.getByTestId(`agenda-column-${tuesday.toISOString().slice(0, 10)}`)
  await column.click({ position: { x: 20, y: 6 * 48 + 2 } })
  const dialog = page.getByRole('dialog', { name: 'Rendez-vous personnel' })
  await dialog.getByLabel(/^Libellé/).fill('Dentiste')
  await dialog.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByText('Rendez-vous personnel ajouté.')).toBeVisible()
  const block = page.getByRole('button', { name: /^12:00, Dentiste(,|$)/ })
  await block.scrollIntoViewIfNeeded()
  await block.click()
  await page.getByRole('button', { name: 'Retirer ce rendez-vous personnel' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('the parity audit: « Changer le service », « Marquer confirmé », « Rétablir » (AP-28 … AP-30)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const thursday = new Date(`${monday}T12:00:00Z`)
  thursday.setUTCDate(thursday.getUTCDate() + 3)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${thursday.toISOString().slice(0, 10)}&vue=jour`)
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('15:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Gagnon-Fictif')
  await sheet.getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()

  await page.getByRole('button', { name: /^15:00, Marc Gagnon-Fictif(,|$)/ }).click()
  const editor = page.getByRole('dialog', { name: 'Marc Gagnon-Fictif' })
  // « Changer le service »: another service, the same moment.
  const service = editor.getByRole('combobox', { name: /^Service/ })
  const current = await service.inputValue()
  const values = await service.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
  await service.selectOption(values.find((v) => v !== current)!)
  await editor.getByRole('button', { name: 'Changer le service' }).click()
  await expect(page.getByText('Service changé.')).toBeVisible()
  // « Marquer confirmé ».
  await editor.getByRole('button', { name: 'Marquer confirmé' }).click()
  await expect(page.getByText('Rendez-vous marqué confirmé.')).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Marquer confirmé' })).toHaveCount(0)
  // Cancelled, then « Rétablir ».
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
  await page.getByRole('button', { name: /^15:00, Marc Gagnon-Fictif/ }).click()
  const cancelled = page.getByRole('dialog', { name: 'Marc Gagnon-Fictif' })
  await cancelled.getByRole('tab', { name: 'Annulation' }).click()
  await cancelled.getByRole('button', { name: 'Rétablir le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous rétabli.')).toBeVisible()

  // Cancel it again (leave the database as found).
  await expect(cancelled.getByRole('button', { name: 'Annuler le rendez-vous' })).toBeVisible()
  await cancelled.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await cancelled.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.').first()).toBeVisible()
})

test('the sheet’s « Messages »: the confirmation listed; « Renvoyer » right after it is refused, then the appointment cancelled (AP-47)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const friday = new Date(`${monday}T12:00:00Z`)
  friday.setUTCDate(friday.getUTCDate() + 4)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${friday.toISOString().slice(0, 10)}&vue=jour`)
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('16:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Tremblay-Fictive')
  await sheet.getByRole('button', { name: /Alice Tremblay-Fictive/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()

  await page.getByRole('button', { name: /^16:00, Alice Tremblay-Fictive/ }).click()
  const editor = page.getByRole('dialog', { name: 'Alice Tremblay-Fictive' })
  await editor.getByRole('tab', { name: 'Messages' }).click()
  const list = editor.getByRole('list', { name: 'Messages envoyés aux clients' })
  await expect(list).toContainText('Confirmation')
  await expect(list).toContainText('Courriel · Alice Tremblay-Fictive')
  await editor.getByRole('button', { name: 'Renvoyer la notification' }).click()
  await expect(page.getByText('Une notification vient de partir : réessayez dans quelques minutes.')).toBeVisible()

  // Leave the database as found.
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('« Imprimer »: Félix’s week as a list to print, the shell hidden when printed (AP-48)', async ({ page, signIn }) => {
  const monday = nextMonday()
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${monday}`)
  await page.getByRole('link', { name: 'Imprimer' }).click()
  await expect(page).toHaveURL(new RegExp(`/agenda/imprimer\\?professionnel=${FELIX}&date=${monday}`))
  const sheet = page.getByRole('article', { name: 'Agenda à imprimer' })
  await expect(sheet.getByRole('heading', { level: 1 })).toContainText('Semaine du')
  await expect(sheet).toContainText('Félix Gauthier')
  // The seed's appointments next week: their times and clients, never a note.
  await expect(sheet.locator('tbody tr').first()).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Imprimer' })).toBeHidden()
  if (process.env.AGENDA_PRINT_SHOT) await page.screenshot({ path: process.env.AGENDA_PRINT_SHOT, fullPage: true })
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('link', { name: "Retour à l'agenda" }).click()
  await expect(page).toHaveURL(/\/agenda\?/)
})

test('« Légende »: the blocks’ icons explained, the reminder and the client’s confirmation first (AP-49)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${nextMonday()}`)
  await page.getByRole('button', { name: 'Légende' }).click()
  const legend = page.getByRole('dialog', { name: "Légende de l'agenda" })
  await expect(legend).toContainText('Rappel envoyé pour cette heure')
  await expect(legend).toContainText('Confirmé par le client')
  await expect(legend).toContainText('Personne à qui envoyer le rappel')
})

test('Paramètres → Agenda: the late notice counts business hours by default (AP-31)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/parametres/agenda')
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Préavis compté en heures ouvrables' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Lundi' })).toBeChecked()
})

test('« Clients sans rappel » opens the coming appointments nobody can be reminded of (R4)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}`)
  await page.getByRole('button', { name: 'Clients sans rappel' }).click()
  const sheet = page.getByRole('dialog', { name: 'Clients sans rappel' })
  await expect(sheet.getByText(/7 prochains jours/).first()).toBeVisible()
})

test('« Disponibilités » by direct manipulation: draw, undo, move, resize, undo, delete (AP-27)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const saturday = new Date(`${monday}T12:00:00Z`)
  saturday.setUTCDate(saturday.getUTCDate() + 5)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${monday}&mode=disponibilites`)
  // Félix's seeded windows: Monday to Friday; Saturday is empty.
  const column = page.getByTestId(`agenda-column-${saturday.toISOString().slice(0, 10)}`)
  await expect(column).toBeVisible()
  const toast = (text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text })
  // A drag between two times of Saturday (hours, 48 px each below 6:00), measured afresh: the grid's
  // top at the top of the window, so the toasts (bottom right) stay clear of the hours used.
  const drag = async (from: number, to: number) => {
    // `instant`: the page scrolls smoothly (globals.css), and a box measured mid-scroll is wrong.
    await column.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await expect.poll(async () => (await column.boundingBox())?.y).toBeLessThan(10)
    const box = (await column.boundingBox())!
    const x = box.x + box.width / 2
    const at = (hours: number) => box.y + (hours - 6) * 48
    await page.mouse.move(x, at(from))
    await page.mouse.down()
    await page.mouse.move(x, (at(from) + at(to)) / 2, { steps: 4 })
    await page.mouse.move(x, at(to), { steps: 4 })
    await page.mouse.up()
  }

  // Draw Saturday 9:00–12:00: saved at once, weekly; « Annuler » takes it back.
  await drag(9.05, 11.95)
  await expect(toast('Disponible le samedi 9 h – 12 h, chaque semaine')).toBeVisible()
  await expect(column.getByRole('button', { name: 'Plage de 09:00 à 12:00' })).toBeVisible()
  await toast('Disponible le samedi 9 h – 12 h').getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByText("C'est annulé.").first()).toBeVisible()
  await expect(column.getByRole('button', { name: 'Plage de 09:00 à 12:00' })).toHaveCount(0)

  // Again, then moved an hour down.
  await drag(9.05, 11.95)
  await expect(column.getByRole('button', { name: 'Plage de 09:00 à 12:00' })).toBeVisible()
  await drag(10.5, 11.5)
  await expect(toast('Plage modifiée : samedi 10 h – 13 h, chaque semaine')).toBeVisible()
  const moved = column.getByRole('button', { name: 'Plage de 10:00 à 13:00' })
  await expect(moved).toBeVisible()

  // Its bottom edge an hour down, then « Annuler ».
  await drag(12.95, 13.95)
  await expect(toast('Plage modifiée : samedi 10 h – 14 h, chaque semaine')).toBeVisible()
  await expect(column.getByRole('button', { name: 'Plage de 10:00 à 14:00' })).toBeVisible()
  await toast('Plage modifiée : samedi 10 h – 14 h').getByRole('button', { name: 'Annuler' }).click()
  await expect(moved).toBeVisible()

  // A click: « Supprimer ».
  await moved.click()
  await page.getByRole('button', { name: 'Supprimer' }).click()
  await expect(toast('Plage supprimée : samedi 10 h – 13 h')).toBeVisible()
  await expect(moved).toHaveCount(0)
})

/** Accueil's « sans moyen de rappel » figure (L29) opens the agenda with « Clients sans rappel » shown; closing it clears the address. */
test('the agenda opens « Clients sans rappel » from its address (Accueil, L29)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/agenda?sans-rappel=1')
  const sheet = page.getByRole('dialog', { name: 'Clients sans rappel' })
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page).not.toHaveURL(/sans-rappel/)
})

test('a family of three: booked together, a fourth added, one taken off, then cancelled (R-79)', async ({ page, signIn }) => {
  // Félix's own clients (the seed's Alice, Léa, Marc) and Inès: booking links a client to him, and
  // clients.spec checks that Paule stays out of his « Mes clients ». Alice is the one taken off: Marc
  // manages Léa's appointments, so he would rightly get no cancellation. The person seen
  // comes first in the title: Marc takes Alice's place.
  const monday = nextMonday()
  const wednesday = new Date(`${monday}T12:00:00Z`)
  wednesday.setUTCDate(wednesday.getUTCDate() + 2)
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}&date=${wednesday.toISOString().slice(0, 10)}&vue=jour`)
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('15:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  for (const [query, name] of [
    ['Tremblay-Fictive', 'Alice Tremblay-Fictive'],
    ['Gagnon-Fictif', 'Marc Gagnon-Fictif'],
    ['Gagnon-Fictive', 'Léa Gagnon-Fictive'],
  ] as const) {
    await sheet.getByRole('searchbox').fill(query)
    await sheet.getByRole('button', { name: new RegExp(name) }).click()
  }
  await expect(sheet.getByText('autre personne', { exact: false }).filter({ hasNotText: 'Une autre' })).toHaveCount(2)
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()

  await page.getByRole('button', { name: /^15:00, Alice Tremblay-Fictive, Léa Gagnon-Fictive et Marc Gagnon-Fictif/ }).click()
  const editor = page.getByRole('dialog', { name: 'Alice Tremblay-Fictive, Léa Gagnon-Fictive et Marc Gagnon-Fictif' })
  await editor.getByRole('searchbox', { name: /^Ajouter une personne/ }).fill('Côté-Fictive')
  await editor.getByRole('button', { name: /Inès Côté-Fictive/ }).click()
  await expect(page.getByText('Personne ajoutée au rendez-vous : elle reçoit la confirmation.')).toBeVisible()
  const four = page.getByRole('dialog', { name: 'Alice Tremblay-Fictive, Inès Côté-Fictive, Léa Gagnon-Fictive et Marc Gagnon-Fictif' })
  await four.getByRole('button', { name: 'Retirer Alice Tremblay-Fictive' }).click()
  await page.getByRole('alertdialog', { name: 'Retirer Alice Tremblay-Fictive du rendez-vous ?' }).getByRole('button', { name: 'Retirer du rendez-vous' }).click()
  await expect(page.getByText("Personne retirée du rendez-vous : elle reçoit un avis d'annulation.")).toBeVisible()
  const three = page.getByRole('dialog', { name: 'Marc Gagnon-Fictif, Inès Côté-Fictive et Léa Gagnon-Fictive' })
  await three.getByRole('tab', { name: 'Messages' }).click()
  const messages = three.getByRole('list', { name: 'Messages envoyés aux clients' })
  await expect(messages).toContainText('Courriel · Inès Côté-Fictive')
  await expect(messages).toContainText('Annulation')

  // Leave the database as found.
  await three.getByRole('tab', { name: 'Annulation' }).click()
  await three.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await three.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('« Mon agenda »: Félix books his client in the evening, outside his availability, without a reason (R-82)', async ({ page, signIn }) => {
  const monday = nextMonday()
  const wednesday = new Date(`${monday}T12:00:00Z`)
  wednesday.setUTCDate(wednesday.getUTCDate() + 2)
  await signIn('provider')
  await page.goto(`/mon-agenda?date=${wednesday.toISOString().slice(0, 10)}&vue=jour`)
  await page.getByRole('button', { name: 'Rendez-vous avec un client' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await sheet.getByLabel(/^Heure/).fill('19:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox').fill('Tremblay-Fictive')
  await sheet.getByRole('button', { name: /Alice Tremblay-Fictive/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()
  await expect(sheet).toBeHidden()

  await page.getByRole('button', { name: /^19:00, Alice Tremblay-Fictive(,|$)/ }).click()
  const editor = page.getByRole('dialog', { name: 'Alice Tremblay-Fictive' })
  await expect(editor.getByText('Réservé par le professionnel sur son propre agenda.')).toBeVisible()
  await editor.getByRole('tab', { name: 'Annulation' }).click()
  await editor.getByLabel(/^Raison de l'annulation/).selectOption({ label: 'Plus requis' })
  await editor.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})
