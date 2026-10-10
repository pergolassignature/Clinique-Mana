import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { accessKeys } from '@/core/access/access-context'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { AccountPage } from './AccountPage'

const mocks = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  fetchAuthUser: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@/core/account/api', () => ({ updateDisplayName: mocks.updateDisplayName, fetchAuthUser: mocks.fetchAuthUser }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.resetAllMocks())

const session = (user: Partial<Session['user']> = {}) =>
  ({ access_token: 't1', user: { id: 'u1', email: 'adjointe@mana.test', ...user } }) as Session

/** Matches a label that starts with `text` (the required marker follows), taken literally. */
const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

/** A probe that leaves the page through the unsaved-changes guard. */
function LeaveButton() {
  const confirmLeave = useConfirmLeave()
  return (
    <button type="button" onClick={() => confirmLeave(() => {})}>
      LEAVE
    </button>
  )
}

const baseAccess: Access = { ...testAccess, display_name: 'Camille Tremblay' }

function renderPage(auth: Partial<AuthContextValue> = {}, path: NonNullable<Parameters<typeof renderWithContexts>[1]>['path'] = '/') {
  const current = auth.session ?? session()
  // By default the server agrees with the stored session.
  if (!mocks.fetchAuthUser.getMockImplementation()) mocks.fetchAuthUser.mockImplementation(async () => current.user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const ui = (access: Access) => (
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <AccountPage />
          <LeaveButton />
        </UnsavedChangesProvider>,
        { auth: { ...auth, session: current }, access: { access }, path },
      )}
    </QueryClientProvider>
  )
  const view = render(ui(baseAccess))
  return { invalidate, rerenderWithAccess: (access: Access) => view.rerender(ui(access)) }
}

const card = (title: string) => screen.getByRole('form', { name: title })
const inactive = (button: HTMLElement) => expect(button).toHaveAttribute('aria-disabled', 'true')
/** A clean form shows no « Annuler / Enregistrer » (decision UI-2). */
const noActions = (form: HTMLElement) => {
  expect(within(form).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  expect(within(form).queryByRole('button', { name: t('common.cancel') })).not.toBeInTheDocument()
}

describe('AccountPage', () => {
  it('is titled « Mon compte » (page heading and browser tab) and shows the four cards', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t('account.title') })).toBeInTheDocument()
    expect(document.title).toContain(t('pageTitles.account'))
    for (const title of [t('account.name.title'), t('account.email.title'), t('account.password.title')]) {
      expect(card(title)).toBeInTheDocument()
    }
    // No fields: a region, not a form.
    expect(screen.getByRole('region', { name: t('account.sessions.title') })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t('account.sessions.title') })).not.toBeInTheDocument()
  })
})

describe('« Nom affiché »', () => {
  const nameCard = () => card(t('account.name.title'))
  const nameField = () => within(nameCard()).getByLabelText(label(t('account.name.label')))
  const save = () => within(nameCard()).getByRole('button', { name: t('common.save') })
  const cancel = () => within(nameCard()).getByRole('button', { name: t('common.cancel') })

  it('starts from the current name, with no buttons until something changes', async () => {
    renderPage()
    expect(nameField()).toHaveValue('Camille Tremblay')
    noActions(nameCard())
    await userEvent.type(nameField(), ' bis')
    expect(save()).not.toHaveAttribute('aria-disabled')
    expect(cancel()).not.toHaveAttribute('aria-disabled')
  })

  it('requires a name', async () => {
    renderPage()
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), '   ')
    await userEvent.click(save())
    expect(await screen.findByText(t('settings.validation.nameRequired'))).toBeInTheDocument()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  it('accepts at most 80 characters', async () => {
    renderPage()
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'a'.repeat(81))
    await userEvent.click(save())
    expect(await screen.findByText(t('settings.validation.maxLength', { max: '80' }))).toBeInTheDocument()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  it('saves the trimmed name, refreshes access (the shell shows it), moves focus to the card title and disarms the guard', async () => {
    mocks.updateDisplayName.mockResolvedValue(undefined)
    const { invalidate } = renderPage()
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), '  Camille T.  ')
    await userEvent.click(save())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('account.name.saved')))
    expect(mocks.updateDisplayName).toHaveBeenCalledWith('u1', 'Camille T.')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
    await waitFor(() => noActions(nameCard()))
    expect(within(nameCard()).getByRole('heading', { name: t('account.name.title') })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'LEAVE' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  // The field stays editable while saving; the reset to the saved name must not drop the rest.
  it('keeps what was typed while the save was in flight: still there, dirty, guard armed', async () => {
    let resolve: () => void = () => {}
    mocks.updateDisplayName.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    renderPage()
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'Camille T.')
    await userEvent.click(save())
    inactive(await within(nameCard()).findByRole('button', { name: t('common.saving') }))

    await userEvent.type(nameField(), ' (Laval)')
    resolve()
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('account.name.saved')))
    await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled'))
    expect(nameField()).toHaveValue('Camille T. (Laval)')
    expect(mocks.updateDisplayName).toHaveBeenCalledExactlyOnceWith('u1', 'Camille T.')
    await userEvent.click(screen.getByRole('button', { name: 'LEAVE' }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('« Annuler » puts the saved name back, returns focus to the field and disarms the guard', async () => {
    renderPage()
    await userEvent.type(nameField(), ' bis')
    await userEvent.click(cancel())
    expect(nameField()).toHaveValue('Camille Tremblay')
    expect(nameField()).toHaveFocus()
    noActions(nameCard())
    await userEvent.click(screen.getByRole('button', { name: 'LEAVE' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  // e.g. the access payload refetched on window focus while typing.
  it('keeps what is being typed when the saved name changes underneath', async () => {
    const { rerenderWithAccess } = renderPage()
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'Camille en cours')
    rerenderWithAccess({ ...baseAccess, display_name: 'Renommée ailleurs' })
    expect(nameField()).toHaveValue('Camille en cours')
    await userEvent.click(cancel())
    expect(nameField()).toHaveValue('Renommée ailleurs')
  })

  it('registers unsaved edits with the guard', async () => {
    renderPage()
    await userEvent.type(nameField(), ' bis')
    await userEvent.click(screen.getByRole('button', { name: 'LEAVE' }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })
})

describe('« Courriel »', () => {
  const emailCard = () => card(t('account.email.title'))
  const newEmail = () => within(emailCard()).getByLabelText(label(t('account.email.new')))
  const submit = () => within(emailCard()).getByRole('button', { name: t('account.email.submit') })
  const status = () => within(emailCard()).getByRole('status')

  it('shows the current email', () => {
    renderPage()
    expect(within(emailCard()).getByText('adjointe@mana.test')).toBeInTheDocument()
  })

  // The live region exists before the notice, so screen readers announce it when it appears.
  it('has an empty status region while no change is pending', () => {
    renderPage()
    expect(status()).toBeEmptyDOMElement()
  })

  // Confirmed on another device: the stored session still has the old user until its next refresh.
  it('shows the address from the server once the change is confirmed elsewhere', async () => {
    mocks.fetchAuthUser.mockResolvedValue({ id: 'u1', email: 'nouvelle@mana.test' })
    renderPage({ session: session({ new_email: 'nouvelle@mana.test' }) })
    expect(await within(emailCard()).findByText('nouvelle@mana.test')).toBeInTheDocument()
    expect(within(emailCard()).queryByText('adjointe@mana.test')).not.toBeInTheDocument()
    expect(status()).toBeEmptyDOMElement()
  })

  it.each([
    ['an invalid address', 'pas-un-courriel', 'auth.errors.invalidEmail'],
    ['the current address', ' Adjointe@mana.test ', 'account.email.same'],
  ] as const)('refuses %s', async (_label, value, message) => {
    const updateEmail = vi.fn()
    renderPage({ updateEmail })
    await userEvent.type(newEmail(), value)
    await userEvent.click(submit())
    expect(await within(emailCard()).findByText(t(message))).toBeInTheDocument()
    expect(newEmail()).toHaveAttribute('aria-invalid', 'true')
    expect(updateEmail).not.toHaveBeenCalled()
  })

  // Neutral (decision #38): the same notice whether or not the address could be used, so it
  // names no address and claims no pending change.
  it('requests the change and announces, in the status region, a neutral notice', async () => {
    const updateEmail = vi.fn().mockResolvedValue(null)
    renderPage({ updateEmail })
    await waitFor(() => expect(mocks.fetchAuthUser).toHaveBeenCalledTimes(1))
    await userEvent.type(newEmail(), ' nouvelle@mana.test ')
    await userEvent.click(submit())
    expect(await within(status()).findByText(t('account.email.requested'))).toBeInTheDocument()
    expect(within(status()).getByText(t('account.email.requestedTitle'))).toBeInTheDocument()
    expect(t('account.email.requested')).toMatch(/^Si cette adresse peut être utilisée, /)
    expect(status()).not.toHaveTextContent('nouvelle@mana.test')
    expect(updateEmail).toHaveBeenCalledExactlyOnceWith('nouvelle@mana.test')
    expect(newEmail()).toHaveValue('')
    await waitFor(() => expect(mocks.fetchAuthUser).toHaveBeenCalledTimes(2)) // read again after the request
  })

  // A real change: GoTrue then reports new_email. Switching to « en attente vers … » would make a
  // real change look different from an address already taken.
  it('keeps the neutral notice once the server reports the requested address', async () => {
    mocks.fetchAuthUser
      .mockResolvedValueOnce({ id: 'u1', email: 'adjointe@mana.test' })
      .mockResolvedValue({ id: 'u1', email: 'adjointe@mana.test', new_email: 'nouvelle@mana.test' })
    renderPage({ updateEmail: vi.fn().mockResolvedValue(null) })
    await userEvent.type(newEmail(), 'nouvelle@mana.test')
    await userEvent.click(submit())
    await waitFor(() => expect(mocks.fetchAuthUser).toHaveBeenCalledTimes(2))
    expect(await within(status()).findByText(t('account.email.requested'))).toBeInTheDocument()
    expect(status()).not.toHaveTextContent('nouvelle@mana.test')
  })

  // After a reload: GoTrue keeps the pending address on the user (new_email).
  it('shows a change already waiting for confirmation', () => {
    renderPage({ session: session({ new_email: 'nouvelle@mana.test' }) })
    expect(within(status()).getByText(t('account.email.pendingTitle', { email: 'nouvelle@mana.test' }))).toBeInTheDocument()
  })

  // From /connexion/confirmer: an email-change link just confirmed shows a neutral « Lien confirmé »
  // notice, never « en attente vers … ».
  it('shows the neutral « Lien confirmé » notice after an email-change link is confirmed', () => {
    renderPage({ session: session({ new_email: 'nouvelle@mana.test' }) }, { pathname: '/mon-compte', state: { emailChangeConfirmed: true } })
    expect(within(status()).getByText(t('auth.confirm.emailChangeTitle'))).toBeInTheDocument()
    expect(within(status()).getByText(t('auth.confirm.emailChangeBody'))).toBeInTheDocument()
    expect(status()).not.toHaveTextContent(t('account.email.requestedTitle'))
    expect(status()).not.toHaveTextContent('nouvelle@mana.test')
  })

  it('after a request, shows the neutral notice instead of an older pending change', async () => {
    renderPage({ session: session({ new_email: 'ancienne-demande@mana.test' }), updateEmail: vi.fn().mockResolvedValue(null) })
    await userEvent.type(newEmail(), 'nouvelle@mana.test')
    await userEvent.click(submit())
    expect(await within(status()).findByText(t('account.email.requested'))).toBeInTheDocument()
    expect(status()).not.toHaveTextContent('ancienne-demande@mana.test')
    expect(status()).not.toHaveTextContent('nouvelle@mana.test')
  })

  it('shows an address the server finds invalid on the field', async () => {
    renderPage({ updateEmail: vi.fn().mockResolvedValue('invalid_email') })
    await userEvent.type(newEmail(), 'nouvelle@mana.test')
    await userEvent.click(submit())
    expect(await within(emailCard()).findByText(t('auth.errors.invalid_email'))).toBeInTheDocument()
    expect(newEmail()).toHaveAttribute('aria-invalid', 'true')
    expect(status()).toBeEmptyDOMElement()
  })

  it('shows other failures as an alert', async () => {
    renderPage({ updateEmail: vi.fn().mockResolvedValue('rate_limited') })
    await userEvent.type(newEmail(), 'nouvelle@mana.test')
    await userEvent.click(submit())
    expect(await within(emailCard()).findByRole('alert')).toHaveTextContent(t('auth.errors.rate_limited'))
  })

  it('« Annuler » empties the field, clears the failure and returns focus to the field', async () => {
    renderPage({ updateEmail: vi.fn().mockResolvedValue('rate_limited') })
    await userEvent.type(newEmail(), 'nouvelle@mana.test')
    await userEvent.click(submit())
    await within(emailCard()).findByRole('alert')
    await userEvent.click(within(emailCard()).getByRole('button', { name: t('common.cancel') }))
    expect(newEmail()).toHaveValue('')
    expect(newEmail()).toHaveFocus()
    expect(within(emailCard()).queryByRole('alert')).not.toBeInTheDocument()
    noActions(emailCard())
  })
})

describe('« Mot de passe »', () => {
  const passwordCard = () => card(t('account.password.title'))
  const field = (text: string) => within(passwordCard()).getByLabelText(label(text))
  const codeField = () => within(passwordCard()).queryByLabelText(label(t('account.password.code')))
  const submit = () => within(passwordCard()).getByRole('button', { name: t('account.password.submit') })

  async function fill(password: string, confirm = password) {
    await userEvent.type(field(t('account.password.new')), password)
    await userEvent.type(field(t('account.password.confirm')), confirm)
  }

  it.each([
    ['fewer than 10 characters', 'court', 'court', 'auth.reset.tooShort'],
    ['a confirmation that differs', 'un-long-mot-de-passe', 'un-autre-mot-de-passe', 'auth.reset.mismatch'],
  ] as const)('refuses %s (the reset page rules)', async (_label, password, confirm, message) => {
    const updatePassword = vi.fn()
    renderPage({ updatePassword })
    await fill(password, confirm)
    await userEvent.click(submit())
    expect(await within(passwordCard()).findByText(t(message))).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('tells password managers which account the password belongs to, with the current address', async () => {
    mocks.fetchAuthUser.mockResolvedValue({ id: 'u1', email: 'nouvelle@mana.test' })
    renderPage()
    const username = () => passwordCard().querySelector('input[autocomplete="username"]')
    expect(username()).toHaveValue('adjointe@mana.test')
    await waitFor(() => expect(username()).toHaveValue('nouvelle@mana.test'))
  })

  it('says it is saving while the change is in flight', async () => {
    let finish: (code: null) => void = () => {}
    renderPage({ updatePassword: vi.fn(() => new Promise<null>((resolve) => (finish = resolve))) })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    const pending = await within(passwordCard()).findByRole('button', { name: t('account.password.submitting') })
    inactive(pending)
    expect(pending).toHaveFocus()
    finish(null)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
  })

  it('changes the password without a code on a fresh session, then resets the form', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    const sendReauthenticationCode = vi.fn()
    renderPage({ updatePassword, sendReauthenticationCode })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('account.password.success')))
    expect(updatePassword).toHaveBeenCalledExactlyOnceWith('un-long-mot-de-passe', undefined)
    expect(sendReauthenticationCode).not.toHaveBeenCalled()
    expect(field(t('account.password.new'))).toHaveValue('')
    expect(field(t('account.password.confirm'))).toHaveValue('')
  })

  // Session older than 24 h (secure_password_change): GoTrue wants a code sent by email.
  it('asks for the emailed code when reauthentication is needed, then sends it as the nonce', async () => {
    const updatePassword = vi.fn().mockResolvedValueOnce('reauthentication_needed').mockResolvedValueOnce(null)
    const sendReauthenticationCode = vi.fn().mockResolvedValue(null)
    renderPage({ updatePassword, sendReauthenticationCode })
    expect(codeField()).not.toBeInTheDocument()

    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())

    const code = await within(passwordCard()).findByLabelText(label(t('account.password.code')))
    expect(sendReauthenticationCode).toHaveBeenCalledOnce()
    expect(code).toHaveFocus()
    expect(code).toHaveAccessibleDescription(t('account.password.codeHelp'))
    expect(mocks.toast.success).not.toHaveBeenCalled()

    // The code is required once asked for.
    await userEvent.click(submit())
    expect(await within(passwordCard()).findByText(t('account.password.codeRequired'))).toBeInTheDocument()
    expect(updatePassword).toHaveBeenCalledOnce()

    await userEvent.type(code, ' 123456 ')
    await userEvent.click(submit())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('account.password.success')))
    expect(updatePassword).toHaveBeenLastCalledWith('un-long-mot-de-passe', '123456')
    expect(codeField()).not.toBeInTheDocument()
  })

  it('shows a wrong or expired code on the code field, and can send a new one', async () => {
    const updatePassword = vi.fn().mockResolvedValueOnce('reauthentication_needed').mockResolvedValueOnce('invalid_code')
    const sendReauthenticationCode = vi.fn().mockResolvedValue(null)
    renderPage({ updatePassword, sendReauthenticationCode })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    await userEvent.type(await within(passwordCard()).findByLabelText(label(t('account.password.code'))), '000000')
    await userEvent.click(submit())
    expect(await within(passwordCard()).findByText(t('auth.errors.invalid_code'))).toBeInTheDocument()

    await userEvent.click(within(passwordCard()).getByRole('button', { name: t('account.password.resend') }))
    await waitFor(() => expect(sendReauthenticationCode).toHaveBeenCalledTimes(2))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('account.password.resent'))
  })

  it('sends one code for a double click on « Renvoyer le code »', async () => {
    let finish: (code: null) => void = () => {}
    const sendReauthenticationCode = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => new Promise<null>((resolve) => (finish = resolve)))
    renderPage({ updatePassword: vi.fn().mockResolvedValue('reauthentication_needed'), sendReauthenticationCode })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    const resend = await within(passwordCard()).findByRole('button', { name: t('account.password.resend') })
    await userEvent.dblClick(resend)
    expect(sendReauthenticationCode).toHaveBeenCalledTimes(2) // the first code, then one resend
    finish(null)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('account.password.resent')))
    expect(resend).toHaveFocus()
  })

  // GoTrue throttles the code email: one sent moments ago is still valid, so the field stays.
  it('still asks for the code when sending one is throttled, saying a recent code works', async () => {
    renderPage({
      updatePassword: vi.fn().mockResolvedValue('reauthentication_needed'),
      sendReauthenticationCode: vi.fn().mockResolvedValue('rate_limited'),
    })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    const code = await within(passwordCard()).findByLabelText(label(t('account.password.code')))
    expect(code).toHaveAccessibleDescription(t('account.password.codeRecent'))
    expect(within(passwordCard()).queryByRole('alert')).not.toBeInTheDocument()
  })

  // The hint under the field changes silently: the toast is what screen readers announce.
  it('says so, in a toast, when « Renvoyer le code » is throttled', async () => {
    const sendReauthenticationCode = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('rate_limited')
    renderPage({ updatePassword: vi.fn().mockResolvedValue('reauthentication_needed'), sendReauthenticationCode })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    await userEvent.click(await within(passwordCard()).findByRole('button', { name: t('account.password.resend') }))
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith(t('account.password.codeRecent')))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(codeField()).toHaveAccessibleDescription(t('account.password.codeRecent'))
  })

  it('shows any other failure to send the code as an alert, without the code field', async () => {
    renderPage({
      updatePassword: vi.fn().mockResolvedValue('reauthentication_needed'),
      sendReauthenticationCode: vi.fn().mockResolvedValue('unknown'),
    })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    expect(await within(passwordCard()).findByRole('alert')).toHaveTextContent(t('auth.errors.unknown'))
    expect(codeField()).not.toBeInTheDocument()
  })

  it('« Annuler » clears the fields, leaves the code step and returns focus to the first field', async () => {
    renderPage({ updatePassword: vi.fn().mockResolvedValue('reauthentication_needed'), sendReauthenticationCode: vi.fn().mockResolvedValue(null) })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    await userEvent.type(await within(passwordCard()).findByLabelText(label(t('account.password.code'))), '123456')
    await userEvent.click(within(passwordCard()).getByRole('button', { name: t('common.cancel') }))
    expect(codeField()).not.toBeInTheDocument()
    expect(field(t('account.password.new'))).toHaveValue('')
    expect(field(t('account.password.confirm'))).toHaveValue('')
    expect(field(t('account.password.new'))).toHaveFocus()
    noActions(passwordCard())
  })

  it('shows a refused password on the password field', async () => {
    renderPage({ updatePassword: vi.fn().mockResolvedValue('same_password') })
    await fill('un-long-mot-de-passe')
    await userEvent.click(submit())
    expect(await within(passwordCard()).findByText(t('auth.errors.same_password'))).toBeInTheDocument()
    expect(field(t('account.password.new'))).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('« Sessions »', () => {
  const sessionsCard = () => screen.getByRole('region', { name: t('account.sessions.title') })
  const trigger = () => within(sessionsCard()).getByRole('button', { name: t('account.sessions.signOutEverywhere') })
  const open = () => userEvent.click(trigger())
  const confirmInDialog = async () =>
    userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('account.sessions.confirm') }))

  it('asks for confirmation, with « Annuler » focused first, before signing out everywhere', async () => {
    const signOutEverywhere = vi.fn()
    renderPage({ signOutEverywhere })
    await open()
    const dialog = await screen.findByRole('alertdialog', { name: t('account.sessions.confirmTitle') })
    const cancel = within(dialog).getByRole('button', { name: t('common.cancel') })
    expect(cancel).toHaveFocus()
    await userEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(signOutEverywhere).not.toHaveBeenCalled()
    expect(trigger()).toHaveFocus()
  })

  it('signs out everywhere once confirmed', async () => {
    const signOutEverywhere = vi.fn().mockResolvedValue(null)
    renderPage({ signOutEverywhere })
    await open()
    await confirmInDialog()
    await waitFor(() => expect(signOutEverywhere).toHaveBeenCalledOnce())
  })

  // Like the shell's « Se déconnecter »: unsaved edits in another card are not lost silently.
  it('asks before discarding unsaved edits in another card', async () => {
    const signOutEverywhere = vi.fn().mockResolvedValue(null)
    renderPage({ signOutEverywhere })
    await userEvent.type(within(card(t('account.name.title'))).getByLabelText(label(t('account.name.label'))), ' bis')

    await open()
    await confirmInDialog()
    const unsaved = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    expect(signOutEverywhere).not.toHaveBeenCalled()
    await userEvent.click(within(unsaved).getByRole('button', { name: t('common.unsaved.stay') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(signOutEverywhere).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger()).toHaveFocus())

    await open()
    await confirmInDialog()
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(signOutEverywhere).toHaveBeenCalledOnce()
  })

  it('shows a failure inline and keeps the user here', async () => {
    const signOutEverywhere = vi.fn().mockResolvedValue('unknown')
    renderPage({ signOutEverywhere })
    await open()
    await confirmInDialog()
    const alert = await within(sessionsCard()).findByRole('alert')
    expect(alert).toHaveTextContent(t('account.sessions.failed'))
    expect(alert).toHaveTextContent(t('auth.errors.unknown'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
