import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@testing-library/react'
import { t } from '@/i18n'
import { CATALOG_VIEW, GENDERED_CATALOG_VIEW, recordFixture, socialWorkerRecord } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import type { ProfessionalRecord } from '../../api/parse'
import { RecordHeader } from './RecordHeader'

const H = 'modules.professionals.record.header'

function renderHeader(change: (record: ProfessionalRecord) => ProfessionalRecord = (r) => r) {
  render(<RecordHeader record={change(recordFixture())} onboarding={null} catalog={CATALOG_VIEW} />)
}

describe('RecordHeader', () => {
  it('shows the name as the page heading, the status, the title line and the languages', () => {
    renderHeader((r) => ({ ...r, languageIds: [IDS.en, IDS.fr] }))
    expect(screen.getByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(screen.getByText('MT')).toBeInTheDocument()
    expect(screen.getByText(t('modules.professionals.status.draft'))).toBeInTheDocument()
    expect(screen.getByText('Psychologue · OPQ 12345 · marie.t@exemple.ca')).toBeInTheDocument()
    const chips = screen.getAllByRole('listitem')
    expect(chips.map((chip) => chip.textContent)).toEqual([`${t(`${H}.languages`)} FR · EN`])
  })

  it('names the title in the professional\'s form (P4-342)', () => {
    const { unmount } = render(<RecordHeader record={socialWorkerRecord('female')} onboarding={null} catalog={GENDERED_CATALOG_VIEW} />)
    expect(screen.getByText('Travailleuse sociale · OPQ TS04518 · marie.t@exemple.ca')).toBeInTheDocument()
    unmount()
    render(<RecordHeader record={socialWorkerRecord('male')} onboarding={null} catalog={GENDERED_CATALOG_VIEW} />)
    expect(screen.getByText('Travailleur social · OPQ TS04518 · marie.t@exemple.ca')).toBeInTheDocument()
  })

  it('says when the professional takes no new clients', () => {
    renderHeader((r) => ({ ...r, matchingProfile: { ...r.matchingProfile, acceptingNewClients: false } }))
    expect(within(screen.getByRole('list')).getByText(t(`${H}.notAccepting`))).toBeInTheDocument()
  })

  it('ellipsises a chip on its text, inside a shrinkable chip (a flex item draws no ellipsis)', () => {
    renderHeader((r) => ({ ...r, matchingProfile: { ...r.matchingProfile, acceptingNewClients: false } }))
    const text = screen.getByText(t(`${H}.notAccepting`))
    expect(text.tagName).toBe('SPAN')
    expect(text).toHaveClass('truncate', 'min-w-0')
    expect(text.parentElement).toHaveClass('min-w-0', 'max-w-full')
  })

  it('puts the actions after the identity, which keeps 16rem before they wrap under it', () => {
    render(<RecordHeader record={recordFixture()} onboarding={null} catalog={CATALOG_VIEW} actions={<button type="button">Activer</button>} />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('flex-wrap')
    expect(header.lastElementChild).toBe(screen.getByRole('button', { name: 'Activer' }))
    expect(screen.getByRole('heading', { level: 1 }).closest('.basis-64')).toBe(header.firstElementChild)
  })

  it('shows the email alone without a title, and no chips without languages', () => {
    renderHeader((r) => ({ ...r, professions: [], languageIds: [] }))
    expect(screen.getByText('marie.t@exemple.ca')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
