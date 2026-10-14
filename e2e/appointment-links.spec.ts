import { expect, test } from './fixtures/auth'
import { localSql, SEED_ORG } from './fixtures/db'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * « Annuler ou demander un changement » in the client's emails (Rendez-vous L16, AP-50; local only,
 * after `npm run db:reset`: Rendez-vous is on, Félix Gauthier and Camille Exemple are in the seed).
 * Needs the edge functions served (`npx supabase functions serve --env-file
 * supabase/functions/.env`); skipped when they do not answer.
 *
 * The admin turns the link on in Paramètres → Agenda. Two appointments of Camille's with Félix, four
 * weeks ahead, each with its confirmation email's manage link (issued here as the job issues it:
 * the job and its email are covered by pgTAP and the function's tests). Camille asks for a change
 * through the first (the appointment stays booked, the staff are told) and cancels the second
 * (cancelled, on time). Everything is removed afterwards, the switch turned off again.
 */

const API = 'http://127.0.0.1:55321'
const FELIX = '5eed0000-0000-0000-0000-000000000004'
const CAMILLE = 'c11e0000-0000-0000-0000-000000000001'
const APPTS = ['e2e01600-0000-4000-8000-000000000001', 'e2e01600-0000-4000-8000-000000000002']
/** Well-formed tokens (43 base64url characters of 32 bytes: the last one ends on zero bits). */
const TOKENS = ['L16change' + 'a'.repeat(33) + 'A', 'L16cancel' + 'b'.repeat(33) + 'A']

function cleanUp(): void {
  localSql(`
    delete from public.notifications where subject_id in ('${APPTS[0]}', '${APPTS[1]}');
    delete from public.secure_links where subject_id in (select id from public.appointment_messages where appointment_id in ('${APPTS[0]}', '${APPTS[1]}'));
    delete from public.appointments where id in ('${APPTS[0]}', '${APPTS[1]}');
    update public.appointment_settings set client_manage_links = false where org_id = '${SEED_ORG}';`)
}

/** Four weeks from this Tuesday, 13:00 and 15:00 clinic time: away from the other specs' weeks. */
function setUp(): void {
  localSql(`
    begin;
    insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode)
    select x.id::uuid, '${SEED_ORG}', '${FELIX}', s.id, x.at, x.at + interval '50 minutes', x.at + interval '60 minutes', 'phone'
      from (select id from public.services where org_id = '${SEED_ORG}' and code = 10150) s,
           (values ('${APPTS[0]}', (date_trunc('week', now() at time zone 'America/Toronto')::date + 29 + time '13:00') at time zone 'America/Toronto'),
                   ('${APPTS[1]}', (date_trunc('week', now() at time zone 'America/Toronto')::date + 29 + time '15:00') at time zone 'America/Toronto')) as x(id, at);
    insert into public.appointment_participants (appointment_id, client_id, org_id)
    values ('${APPTS[0]}', '${CAMILLE}', '${SEED_ORG}'), ('${APPTS[1]}', '${CAMILLE}', '${SEED_ORG}');
    commit;
    select private.issue_secure_link('${SEED_ORG}', 'appointment_manage', 'appointment_message', m.id,
             extensions.digest(case m.appointment_id when '${APPTS[0]}' then '${TOKENS[0]}' else '${TOKENS[1]}' end, 'sha256'), null, interval '20 days')
      from public.appointment_messages m
     where m.appointment_id in ('${APPTS[0]}', '${APPTS[1]}') and m.kind = 'confirmation' and m.channel = 'email';`)
}

test.afterEach(() => cleanUp())

test('the admin turns the link on; the client asks for a change, then cancels another appointment', async ({ page, browser, request, signIn }) => {
  const up = await request
    .fetch(`${API}/functions/v1/appointments-manage`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!up, 'the edge functions are not running')
  test.setTimeout(90_000)
  cleanUp()

  await signIn('admin')
  await page.goto('/parametres/agenda')
  const links = page.getByRole('checkbox', { name: 'Lien « Annuler ou demander un changement » dans les courriels' })
  await expect(links).not.toBeChecked()
  await links.click()
  await links.locator('xpath=ancestor::form').getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Réglage des liens enregistré.')).toBeVisible()
  expect(localSql(`select client_manage_links from public.appointment_settings where org_id = '${SEED_ORG}';`)).toBe('t')
  setUp()

  const client = await browser.newPage()
  await client.goto(`/rendez-vous/gerer#t=${TOKENS[0]}`)
  await expect(client.getByRole('heading', { level: 1, name: 'Annuler ou changer votre rendez-vous' })).toBeVisible()
  await expect(client.getByText(/avec Félix Gauthier, par téléphone\./)).toBeVisible()
  await expect(client).toHaveURL(/\/rendez-vous\/gerer$/)
  await expect(client.getByText(/La clinique demande un préavis de \d+ h ouvrables/)).toBeVisible()
  await client.getByRole('button', { name: 'Demander un changement' }).click()
  await client.getByRole('button', { name: 'Envoyer la demande' }).click()
  await expect(client.getByText(/Votre demande est envoyée/)).toBeVisible()
  expect(localSql(`select state, change_requested_at is not null from public.appointments where id = '${APPTS[0]}';`)).toBe('booked|t')
  expect(localSql(`select count(*) from public.notifications where kind = 'appointments.change_request' and subject_id = '${APPTS[0]}';`)).not.toBe('0')

  // The same link a second time: used.
  await client.goto('/accueil')
  await client.goto(`/rendez-vous/gerer#t=${TOKENS[0]}`)
  await expect(client.getByText('Ce lien ne peut plus être utilisé. Pour toute question, appelez la clinique.')).toBeVisible()

  await client.goto(`/rendez-vous/gerer#t=${TOKENS[1]}`)
  await client.getByRole('button', { name: 'Annuler le rendez-vous' }).click()
  await expect(client.getByText(/Voulez-vous vraiment l’annuler/)).toBeVisible()
  await client.getByRole('button', { name: 'Oui, annuler le rendez-vous' }).click()
  await expect(client.getByText('Votre rendez-vous est annulé. Un courriel vous le confirmera.')).toBeVisible()
  expect(localSql(`select state, cancel_late from public.appointments where id = '${APPTS[1]}';`)).toBe('cancelled|f')
  await client.close()
})
