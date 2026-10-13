import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { ModuleSlotsContext } from '@/core/modules/slots'
import { lazyPage } from '@/shared/lib/lazy-page'
import { renderWithContexts } from '@/test/contexts'
import { VisitsTab } from './VisitsTab'

const Panel = lazyPage(async () => ({ default: () => <p>Panneau des rendez-vous</p> }))

describe('VisitsTab', () => {
  it('without a module panel: says where the history lives today', () => {
    render(renderWithContexts(<VisitsTab />))
    expect(screen.getByText(t('modules.clients.record.visits.title'))).toBeInTheDocument()
  })

  it('renders the panels the shell hands over for the slot client.visits (Clients never imports them)', async () => {
    render(
      renderWithContexts(
        <ModuleSlotsContext.Provider value={{ 'client.visits': [{ id: 'appointments.visits', permissions: ['appointments.view'], component: Panel }] }}>
          <VisitsTab />
        </ModuleSlotsContext.Provider>,
      ),
    )
    expect(await screen.findByText('Panneau des rendez-vous')).toBeInTheDocument()
    expect(screen.queryByText(t('modules.clients.record.visits.body'))).not.toBeInTheDocument()
  })
})
