import { ReceiptText } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'

// On the login page's entry path (ALL_MODULES): icons, lazyPage and types only. The settings
// section's API, hooks and schemas load with its page.

/**
 * Services et tarifs (plan §5): one catalogue per clinic, coded like GOrendezvous, with the
 * duration, the taxes and the source of each price (the retention grids, a fixed amount, free,
 * or typed on the invoice). No menu entry of its own: one settings section, changed with
 * `services.manage` and read by the other holders of `settings.view` (the adjointe); a
 * professional or a counselor never sees the clinic's price settings, though `services.view`
 * lets them read the published catalogue (S-8). Depends on Professionnels (titles, retention grids).
 */
export const servicesManifest: ModuleManifest = {
  key: 'services',
  labelKey: 'modules.services.name',
  dependsOn: ['professionals'],
  routes: [],
  // The Journal d'audit's names and values for the module's tables: loaded with the journal.
  audit: () => import('./lib/audit-labels').then((m) => m.servicesAuditLabels),
  settingsSections: [
    {
      id: 'services',
      path: 'services-et-tarifs',
      labelKey: 'modules.services.settings.title',
      icon: ReceiptText,
      // Any of them (S-8): the module's managers, and the staff who see Paramètres; never a
      // professional or a counselor, who hold `services.view` only for the published reads.
      permission: ['services.manage', 'settings.view'],
      editPermission: 'services.manage',
      group: 'modules',
      component: lazyPage(() => import('./pages/settings/ServicesSettingsPage'), 'ServicesSettingsPage'),
    },
  ],
}
