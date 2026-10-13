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
  await expect(page.getByRole('button', { name: '10:00, Alice Tremblay-Fictive' })).toBeVisible()

  // Friday 10:00: 3 hours below 7:00 at 48 px an hour.
  const column = page.getByTestId(`agenda-column-${fridayKey}`)
  await column.click({ position: { x: 20, y: 3 * 48 + 2 } })
  const sheet = page.getByRole('dialog', { name: 'Nouveau rendez-vous' })
  await expect(sheet.getByLabel(/^Heure/)).toHaveValue('10:00')
  await sheet.getByLabel(/^Service/).selectOption({ index: 1 })
  await sheet.getByRole('searchbox', { name: /^Client/ }).fill('Gagnon-Fictif')
  await sheet.getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await sheet.getByRole('button', { name: 'Réserver' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText('Rendez-vous réservé.')).toBeVisible()
  const block = page.getByRole('button', { name: '10:00, Marc Gagnon-Fictif' })
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
  const moved = page.getByRole('button', { name: '10:30, Marc Gagnon-Fictif' })
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
  const block = page.getByRole('button', { name: '19:00, Alice Tremblay-Fictive' })
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
  await page.getByRole('button', { name: '10:00, Marc Gagnon-Fictif' }).click()
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
  await expect(page.getByRole('button', { name: '10:00, Alice Tremblay-Fictive' })).toBeVisible()
  await expect(page.getByLabel('Professionnel')).toHaveCount(0)

  // Tuesday 12:00: 5 hours below 7:00 at 48 px an hour.
  const column = page.getByTestId(`agenda-column-${tuesday.toISOString().slice(0, 10)}`)
  await column.click({ position: { x: 20, y: 5 * 48 + 2 } })
  const dialog = page.getByRole('dialog', { name: 'Rendez-vous personnel' })
  await dialog.getByLabel(/^Libellé/).fill('Dentiste')
  await dialog.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByText('Rendez-vous personnel ajouté.')).toBeVisible()
  const block = page.getByRole('button', { name: '12:00, Dentiste' })
  await block.scrollIntoViewIfNeeded()
  await block.click()
  await page.getByRole('button', { name: 'Retirer ce rendez-vous personnel' }).click()
  await expect(page.getByText('Rendez-vous annulé.')).toBeVisible()
})

test('« Clients sans rappel » opens the coming appointments nobody can be reminded of (R4)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto(`/agenda?professionnel=${FELIX}`)
  await page.getByRole('button', { name: 'Clients sans rappel' }).click()
  const sheet = page.getByRole('dialog', { name: 'Clients sans rappel' })
  await expect(sheet.getByText(/7 prochains jours/).first()).toBeVisible()
})
