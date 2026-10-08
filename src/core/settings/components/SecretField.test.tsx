import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { SecretField } from './SecretField'

const mocks = vi.hoisted(() => ({
  api: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/core/settings/secrets/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.resetAllMocks())

const LABEL = "Clé d'API Resend"
/** Testing Library reads non-breaking spaces as spaces. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ')
const STORED_VALUE = 're_local-dev-stored'

function renderField(props: Partial<Parameters<typeof SecretField>[0]> = {}) {
  mocks.api.listOrgSecretKeys.mockResolvedValue([])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SecretField secretKey="resend_api_key" label={LABEL} configuredAt="2026-10-08T12:00:00Z" readOnly={false} {...props} />
    </QueryClientProvider>,
  )
}

describe('SecretField', () => {
  it('says the secret is configured, when, and never shows a value', () => {
    const { container } = renderField()
    expect(screen.getByText(t('settings.secrets.configured'))).toBeInTheDocument()
    expect(screen.getByText(/08 oct\. 2026/)).toBeInTheDocument()
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).not.toContain(STORED_VALUE)
  })

  it('says when it is not configured, and offers « Ajouter »', () => {
    renderField({ configuredAt: null })
    expect(screen.getByText(t('settings.secrets.notConfigured'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.secrets.add', { label: LABEL }) })).toBeInTheDocument()
  })

  it('« Remplacer » reveals an empty password input; saving calls setOrgSecret once, then hides and clears it', async () => {
    const user = userEvent.setup()
    mocks.api.setOrgSecret.mockResolvedValue(undefined)
    renderField()
    await user.click(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) }))
    const input = screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('')
    // Not the user's password: browsers and password managers neither fill nor save it.
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore')
    expect(input).toHaveAttribute('data-lpignore', 'true')
    expect(input).toHaveAttribute('data-bwignore')
    expect(input).toHaveFocus()
    await user.type(input, ' re_new-key {Enter}')
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.secrets.saved')))
    expect(mocks.api.setOrgSecret).toHaveBeenCalledExactlyOnceWith('resend_api_key', 're_new-key')
    expect(screen.queryByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) })).toHaveFocus()
  })

  it('refuses an empty value without calling the server', async () => {
    const user = userEvent.setup()
    renderField()
    await user.click(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) }))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    // Announced (an alert), and read with the field.
    expect(screen.getByRole('alert')).toHaveTextContent(t('settings.secrets.required'))
    expect(screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))).toHaveAccessibleDescription(t('settings.secrets.required'))
    expect(mocks.api.setOrgSecret).not.toHaveBeenCalled()
  })

  it('« Annuler » drops what was typed and returns focus to « Remplacer »', async () => {
    const user = userEvent.setup()
    renderField()
    await user.click(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) }))
    await user.type(screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL }))), 'abc')
    await user.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) }))
    expect(screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))).toHaveValue('')
    expect(mocks.api.setOrgSecret).not.toHaveBeenCalled()
  })

  it('keeps the input and what was typed when the server refuses', async () => {
    const user = userEvent.setup()
    mocks.api.setOrgSecret.mockRejectedValue({ code: '42501', message: 'Permission refusée' })
    renderField()
    await user.click(screen.getByRole('button', { name: t('settings.secrets.replace', { label: LABEL }) }))
    await user.type(screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL }))), 'abc{Enter}')
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
    expect(screen.getByLabelText(plain(t('settings.secrets.newValue', { label: LABEL })))).toHaveValue('abc')
  })

  it('read-only: the status only, no way to change it', () => {
    renderField({ readOnly: true })
    expect(screen.getByText(t('settings.secrets.configured'))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
