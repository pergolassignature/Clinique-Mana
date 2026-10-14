import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { ExportCsvButton } from './ExportCsvButton'

const mocks = vi.hoisted(() => ({ download: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/shared/lib/csv', async (importOriginal) => ({ ...(await importOriginal<object>()), downloadCsv: mocks.download }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.clearAllMocks())

describe('ExportCsvButton (L7)', () => {
  it('builds the file, hands it to the browser, says when it is cut', async () => {
    render(<ExportCsvButton build={() => Promise.resolve({ fileName: 'x.csv', content: 'a', truncated: true })} />)
    await userEvent.click(screen.getByRole('button', { name: t('common.exportCsv.label') }))
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('x.csv', 'a'))
    expect(mocks.toast.warning).toHaveBeenCalledWith(t('common.exportCsv.truncated'))
  })

  it('a failure is said in French, nothing downloaded', async () => {
    render(<ExportCsvButton build={() => Promise.reject(new Error('boom'))} />)
    await userEvent.click(screen.getByRole('button', { name: t('common.exportCsv.label') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.exportCsv.failed')))
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
