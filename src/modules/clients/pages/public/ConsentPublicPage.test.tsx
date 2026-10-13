import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import * as Sentry from '@sentry/react'
import { renderWithContexts } from '@/test/contexts'
import type { ConsentPage } from '../../api/public-consent'
import { ConsentPublicPage } from './ConsentPublicPage'

const mocks = vi.hoisted(() => ({ resolveConsentLink: vi.fn(), openConsent: vi.fn(), startConsentSigning: vi.fn() }))
vi.mock('../../api/public-consent', () => mocks)
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
// Documenso's frame: a button standing for « the signer finished ».
vi.mock('@/core/signing/components/EmbeddedSigning', () => ({
  EmbeddedSigning: ({ title, language, onCompleted }: { title: string; language: string; onCompleted: () => void }) => (
    <button type="button" onClick={onCompleted}>
      {`FRAME ${title} ${language}`}
    </button>
  ),
}))

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const FR = 'modules.clients.consents.page.fr'
const EN = 'modules.clients.consents.page.en'
const DISPLAY = { clinic_name: 'Clinique MANA', language: 'fr' as const, consent_name: 'Consentement général', expires_at: '2026-10-30T16:00:00Z' }
const PAGE: ConsentPage = {
  state: 'ready',
  request_id: 'q1',
  role: 'client',
  language: 'fr',
  clinic_name: 'Clinique MANA',
  consent_name: 'Consentement général',
  client_first_name: 'Camille',
  signer_first_name: 'Camille',
  clauses: [
    { key: 'accord', kind: 'agree', text_fr: 'J’accepte les services.', text_en: 'I agree to the services.' },
    { key: 'courriel', kind: 'yes_no', text_fr: 'Recevoir des courriels ?', text_en: 'Receive emails?' },
  ],
  answers: null,
  can_answer: true,
  signing: null,
}
const LINK = { host: 'https://sign.test', token: 'signer-token', signingUrl: 'https://sign.test/sign/signer-token' }

function openLink(hash = `#t=${TOKEN}`, search = '') {
  window.history.replaceState(null, '', `/consentement${search}${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/consentement" element={<ConsentPublicPage />} />
        </Routes>,
        { path: `/consentement${search}${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolveConsentLink.mockResolvedValue(DISPLAY)
  mocks.openConsent.mockResolvedValue(PAGE)
  mocks.startConsentSigning.mockResolvedValue(LINK)
})
afterEach(() => vi.clearAllMocks())

describe('ConsentPublicPage', () => {
  it('a link without a token, or a malformed one, ends there: no call', async () => {
    openLink('#t=court')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${FR}.states.link_invalid`))
    expect(mocks.resolveConsentLink).not.toHaveBeenCalled()
  })

  it('the token leaves the address bar; the clinic and the consent are named', async () => {
    openLink()
    expect(await screen.findByText(t(`${FR}.intro`, { clinic: 'Clinique MANA', consent: 'Consentement général' }))).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mocks.resolveConsentLink).toHaveBeenCalledExactlyOnceWith(TOKEN)
  })

  it('identity, then the « Oui / Non » answers (an agree clause needs « Oui »), then the signature, then « Merci »', async () => {
    openLink()
    await userEvent.type(await screen.findByRole('textbox', { name: new RegExp(t(`${FR}.identity.firstName`)) }), 'Camille')
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(t(`${FR}.identity.birthYear`)) }), '2012')
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.identity.submit`) }))
    await waitFor(() => expect(mocks.openConsent).toHaveBeenCalledExactlyOnceWith(TOKEN, { firstName: 'Camille', birthYear: 2012 }))

    const [accordYes, accordNo, courrielYes] = await screen.findAllByRole('radio')
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.sign`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${FR}.clauses.missing`))
    await userEvent.click(accordNo!)
    await userEvent.click(courrielYes!)
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.sign`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${FR}.clauses.mustAgree`))
    expect(mocks.startConsentSigning).not.toHaveBeenCalled()

    await userEvent.click(accordYes!)
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.sign`) }))
    await waitFor(() =>
      expect(mocks.startConsentSigning).toHaveBeenCalledExactlyOnceWith(TOKEN, { firstName: 'Camille', birthYear: 2012 }, { accord: 'yes', courriel: 'yes' }, expect.any(String)),
    )
    expect(screen.getByText(t(`${FR}.signerFor`, { client: 'Camille' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: `FRAME ${t(`${FR}.frameTitle`)} fr` }))
    expect(await screen.findByText(t(`${FR}.done.title`))).toBeInTheDocument()
  })

  it('the second signer sees the answers already given and signs without answering', async () => {
    mocks.openConsent.mockResolvedValue({ ...PAGE, role: 'client_2', can_answer: false, answers: { accord: 'yes', courriel: 'no' } })
    openLink()
    await userEvent.type(await screen.findByRole('textbox', { name: new RegExp(t(`${FR}.identity.firstName`)) }), 'Camille')
    await userEvent.click(screen.getByRole('checkbox', { name: t(`${FR}.identity.birthYearUnknown`) }))
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.identity.submit`) }))
    expect(await screen.findByText(t(`${FR}.clauses.answeredBy`))).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.sign`) }))
    await waitFor(() => expect(mocks.startConsentSigning).toHaveBeenCalledWith(TOKEN, { firstName: 'Camille', birthYear: null }, null, expect.any(String)))
  })

  it('the year is asked (or « je ne la connais pas »), and the five attempts are said before any try', async () => {
    openLink()
    expect(await screen.findByText(t(`${FR}.identity.attempts`))).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(t(`${FR}.identity.firstName`)) }), 'Camille')
    await userEvent.click(screen.getByRole('button', { name: t(`${FR}.identity.submit`) }))
    expect(await screen.findByText(t(`${FR}.identity.birthYearRequired`))).toBeInTheDocument()
    expect(mocks.openConsent).not.toHaveBeenCalled()
  })

  it('a wrong identity: the page’s own words (in English for an English request), never reported', async () => {
    const refusal = new FunctionCallError('invalid_request', 400, 'Le prénom ou l’année de naissance ne correspond pas au dossier.', { refusal: true })
    mocks.resolveConsentLink.mockResolvedValue({ ...DISPLAY, language: 'en' })
    mocks.openConsent.mockRejectedValue(refusal)
    openLink()
    await userEvent.type(await screen.findByRole('textbox', { name: new RegExp(t(`${EN}.identity.firstName`)) }), 'Other')
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(t(`${EN}.identity.birthYear`)) }), '2001')
    await userEvent.click(screen.getByRole('button', { name: t(`${EN}.identity.submit`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${EN}.identity.mismatch`))
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('an unexpected failure is reported with its code only', async () => {
    mocks.resolveConsentLink.mockRejectedValue(new FunctionCallError('internal', 500, 'Boom'))
    openLink()
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${FR}.states.error`))
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ name: 'FunctionCallError internal' }), { tags: { area: 'clients', code: 'internal' } }))
  })

  it('an ended link: « déjà signé »', async () => {
    mocks.resolveConsentLink.mockRejectedValue(new FunctionCallError('link_used', 410, 'Used'))
    openLink()
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${FR}.states.link_used`))
  })

  it('in English when the request is in English, Documenso too', async () => {
    mocks.resolveConsentLink.mockResolvedValue({ ...DISPLAY, language: 'en', consent_name: 'General consent' })
    mocks.openConsent.mockResolvedValue({ ...PAGE, language: 'en', clauses: [] })
    openLink()
    await userEvent.type(await screen.findByRole('textbox', { name: new RegExp(t(`${EN}.identity.firstName`)) }), 'Camille')
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(t(`${EN}.identity.birthYear`)) }), '2012')
    await userEvent.click(screen.getByRole('button', { name: t(`${EN}.identity.submit`) }))
    await userEvent.click(await screen.findByRole('button', { name: t(`${EN}.sign`) }))
    expect(await screen.findByRole('button', { name: `FRAME ${t(`${EN}.frameTitle`)} en` })).toBeInTheDocument()
  })

  it('back from Documenso’s own page (?signe=1): « Merci », in English with &lang=en', async () => {
    const view = openLink('', '?signe=1')
    expect(await screen.findByText(t(`${FR}.done.title`))).toBeInTheDocument()
    view.unmount()
    openLink('', '?signe=1&lang=en')
    expect(await screen.findByText(t(`${EN}.done.title`))).toBeInTheDocument()
    expect(mocks.resolveConsentLink).not.toHaveBeenCalled()
  })
})
