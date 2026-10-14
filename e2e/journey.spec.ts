import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/auth'
import { SEED_ORG, localSql } from './fixtures/db'
import { MAILPIT_URL } from './fixtures/mailpit'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * « Parcours complet » (pre-code-complete, local only, after `npm run db:reset`, with the edge
 * functions served and EMAIL_TRANSPORT=mailpit; skipped otherwise): one person across the modules.
 *
 *  1. Demandes D3c: she books a discovery call on the public page (with a campaign's utm_*).
 *  2. Demandes: the conseillère finds the request, reads where it came from, makes her file,
 *     accepts it and reads the matching panel; she proposes Félix Gauthier with one free slot.
 *  3. The person chooses the slot through the email's link: booked, the request « Jumelée ».
 *  4. Rendez-vous: the appointment is in the agenda; its reminder is queued (P3-40: while
 *     Rendez-vous is reserved for testers, none is).
 *  5. Time passes (the only database step: the appointment moved to the last weekday of last
 *     month, completed, as the nightly job would).
 *  6. Facturation: the session's invoice (the morning queue when the session is within its 14 days,
 *     else « Visites et paiements »), sent; an Interac payment entered by hand; its receipt.
 *  7. Paie: last month calculated; Félix's summary holds the session.
 */

const API = 'http://127.0.0.1:55321'
const ORG = SEED_ORG
const UUID = /^[0-9a-f-]{36}$/

/** The newest email to `address` whose text matches `pattern` (the booking's comes first). */
async function emailMatching(address: string, pattern: RegExp): Promise<string> {
  let text = ''
  await expect
    .poll(
      async () => {
        const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=10`)
        if (!response.ok) return null
        const body = (await response.json()) as { messages: { ID: string }[] }
        for (const m of body.messages) {
          const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()) as { Text: string }
          if (pattern.test(full.Text)) {
            text = full.Text
            return m.ID
          }
        }
        return null
      },
      { timeout: 20_000, message: `no email matching ${pattern} to ${address}` },
    )
    .not.toBeNull()
  return text
}

async function signOutAndIn(page: Page, signIn: (who: 'admin' | 'adminAssistant' | 'counselor') => Promise<void>, who: 'admin' | 'adminAssistant' | 'counselor') {
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await signIn(who)
}

test('parcours complet: appel découverte → demande → jumelage → rendez-vous → facture → paiement → paie', async ({ page, request, signIn }) => {
  const up = await request
    .fetch(`${API}/functions/v1/demandes-book-call`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!up, 'the edge functions are not running')
  test.setTimeout(240_000)
  const stamp = Date.now() % 100000
  const lastName = `Parcours${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`
  const name = `Rose ${lastName}`
  const email = `parcours.e2e.${Date.now()}@mana.test`

  // 1. The public booking page.
  await page.goto(`/appel-decouverte?clinique=${ORG}&utm_source=e2e&utm_campaign=parcours`)
  await page.getByRole('radio').first().check({ force: true })
  await page.getByRole('textbox', { name: /^Prénom/ }).fill('Rose')
  await page.getByRole('textbox', { name: /^Nom/ }).fill(lastName)
  await page.getByRole('textbox', { name: /^Courriel/ }).fill(email)
  await page.getByRole('textbox', { name: /^Téléphone/ }).fill('514 555-0177')
  const heard = page.getByRole('combobox', { name: /entendu parler de MANA/ })
  if (await heard.count()) await heard.selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Réserver l’appel' }).click()
  await expect(page.getByRole('heading', { name: 'Votre appel est réservé' })).toBeVisible({ timeout: 20_000 })

  // 2. The conseillère: the request, its source, her file, « Acceptée », the matching panel.
  await signIn('counselor')
  await page.goto('/demandes')
  await page.getByRole('link', { name }).first().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByText('parcours').first()).toBeVisible()
  await page.getByRole('button', { name: 'Rattacher un dossier' }).click()
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  await page.getByRole('dialog', { name: 'Nouveau client' }).getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByText('Le dossier est rattaché.')).toBeVisible()
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('accepted')
  await expect(page.getByText('La demande est maintenant « Acceptée ».')).toBeVisible()
  await page.getByRole('tab', { name: 'Jumelage' }).click()
  await expect(page.getByRole('heading', { name: 'Ce que la demande indique' })).toBeVisible()
  const others = page.getByRole('button', { name: /^Non admissibles \(\d+\)$/ })
  if (await others.isVisible()) await others.click()
  await expect(page.getByText('Félix Gauthier').first()).toBeVisible()

  // The proposal (« Suivi »): Félix, his first service, one free slot.
  await page.getByRole('tab', { name: 'Suivi' }).click()
  await page.getByRole('button', { name: 'Proposer un professionnel' }).click()
  const form = page.getByRole('dialog', { name: 'Proposer un professionnel' })
  const pro = form.getByRole('combobox', { name: 'Professionnel' })
  await pro.selectOption((await pro.locator('option', { hasText: 'Félix' }).first().getAttribute('value'))!)
  await form.getByRole('combobox', { name: 'Service' }).selectOption({ index: 1 })
  await form.getByRole('checkbox').first().check()
  await form.getByRole('button', { name: /Envoyer la proposition/ }).click()
  await expect(page.getByText('Proposition envoyée : les plages sont réservées 48 h.')).toBeVisible({ timeout: 20_000 })

  // 3. The person: the email's link, the slot, booked.
  const proposal = await emailMatching(email, /\/proposition#t=/)
  const token = /\/proposition#t=([A-Za-z0-9_-]{43})/.exec(proposal)?.[1]
  expect(token, 'a link in the proposal').toBeTruthy()
  const person = await page.context().newPage()
  await person.goto(`/proposition#t=${token}`)
  await person.getByRole('radio').first().check()
  await person.getByRole('button', { name: 'Choisir cette plage' }).click()
  await expect(person.getByRole('heading', { name: "C'est réservé !" })).toBeVisible({ timeout: 20_000 })
  await person.close()
  await page.reload()
  await expect(page.locator('header').getByText('Jumelée', { exact: true })).toBeVisible()

  // 4. The appointment, and its reminder (P3-40).
  const appointment = localSql(
    `select a.id from public.appointments a join public.appointment_participants p on p.appointment_id = a.id
       join public.clients c on c.id = p.client_id
      where c.email = '${email}' and a.state in ('booked', 'confirmed') order by a.starts_at limit 1`,
  )
  expect(appointment).toMatch(UUID)
  const reminder = (reserved: boolean) =>
    localSql(
      `begin;
       update public.org_modules set testers_only = ${reserved} where org_id = '${ORG}' and module_key = 'appointments';
       -- The booking's confirmation, a day old: the next business day's reminder is due (not one message too many).
       update public.appointment_messages set created_at = now() - interval '1 day' where appointment_id = '${appointment}';
       select private.appointments_queue_message('${ORG}', '${appointment}', 'reminder');
       select pg_catalog.count(*) from public.appointment_messages where appointment_id = '${appointment}' and kind = 'reminder' and status = 'pending';
       rollback;`,
    ).split('\n').pop()
  expect(Number(reminder(true)), 'reserved for testers: no reminder queued').toBe(0)
  expect(Number(reminder(false)), 'open to all: the reminder queued').toBeGreaterThan(0)

  // 5. Time passes: the last weekday of last month, 15:00 in Toronto, completed.
  const day = localSql(
    `select d from (select (date_trunc('month', now() at time zone 'America/Toronto') - interval '1 day')::date as d) x`,
  )
  const session = localSql(
    `with d as (select ('${day}'::date - case extract(isodow from '${day}'::date) when 6 then 1 when 7 then 2 else 0 end) as day)
     update public.appointments a
        set starts_at = (d.day + time '15:00') at time zone 'America/Toronto',
            ends_at = (d.day + time '15:00') at time zone 'America/Toronto' + (a.ends_at - a.starts_at),
            blocks_until = (d.day + time '15:00') at time zone 'America/Toronto' + (a.blocks_until - a.starts_at),
            state = 'completed',
            completed_at = (d.day + time '15:00') at time zone 'America/Toronto' + (a.ends_at - a.starts_at)
       from d where a.id = '${appointment}'
     returning d.day;`,
  ).split('\n')[0] ?? ''
  expect(session, 'the session moved to a finished day').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const inQueue = localSql(`select ('${session}'::date >= (now() at time zone 'America/Toronto')::date - 14)::text`) === 'true'
  if (inQueue) {
    localSql(
      `update public.billing_settings set queue_from = least(queue_from, '${session}'::date) where org_id = '${ORG}';
       select private.job_billing_build_drafts();`,
    )
  }

  // 6. Facturation: the invoice, sent; an Interac payment entered by hand; its receipt.
  await signOutAndIn(page, signIn, 'adminAssistant')
  if (inQueue) {
    await page.goto('/facturation')
    await expect(page.getByRole('list', { name: 'Brouillons de la file du matin' }).getByRole('link', { name: new RegExp(lastName) })).toBeVisible()
    await page.getByRole('button', { name: /^Tout envoyer \(\d+\)$/ }).click()
    await expect(page.getByText(/^Factures envoyées\s:\s\d+\.$/)).toBeVisible()
    await page.getByRole('tab', { name: 'Émises' }).click()
    await page.getByRole('row', { name: new RegExp(lastName) }).first().getByRole('link').click()
  } else {
    await page.goto('/clients')
    await page.getByRole('link', { name: new RegExp(lastName) }).first().click()
    await page.getByRole('tab', { name: 'Visites et paiements' }).click()
    await page.getByRole('list', { name: 'Rendez-vous à facturer' }).getByRole('button', { name: 'Créer la facture' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Brouillon de facture' })).toBeVisible()
    await page.getByRole('button', { name: /^Finaliser et envoyer$|^Finaliser sans envoyer$/ }).first().click()
  }
  await expect(page.getByRole('heading', { level: 1, name: /^Facture \d{4}-\d+$/ })).toBeVisible()
  const payment = page.getByRole('form', { name: 'Enregistrer un paiement' })
  const mode = payment.getByRole('combobox', { name: 'Mode de paiement' })
  if (await mode.count()) await mode.selectOption('interac')
  await payment.getByLabel(/^Référence/).fill('CAparcours')
  await payment.getByRole('button', { name: 'Enregistrer le paiement' }).click()
  await expect(page.getByText('Paiement enregistré : le reçu part au payeur.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Paiements de la facture' }).getByText(/Reçu R-\d{4}-\d+/)).toBeVisible()
  await expect(page.getByText('Payée', { exact: true })).toBeVisible()

  // 7. Paie: last month; Félix's summary holds the session.
  await signOutAndIn(page, signIn, 'admin')
  const month = session.slice(0, 7)
  await page.goto(`/facturation/paie?mois=${month}`)
  await page.getByRole('button', { name: /^(Calculer|Recalculer) le mois$/ }).click()
  await expect(page.getByText(/^Mois calculé/)).toBeVisible()
  const felix = page.getByRole('table', { name: 'Sommaires du mois' }).getByRole('row').filter({ hasText: 'Félix Gauthier' })
  await felix.getByRole('button', { name: 'Félix Gauthier' }).click()
  await expect(page.getByRole('dialog').getByRole('table', { name: 'Lignes du sommaire' }).getByText(new RegExp(lastName)).first()).toBeVisible()
})
