import { lazy } from 'react'

/**
 * The client picker for other modules (`@/modules/clients`), lazy: nothing of the module's API or
 * hooks loads with the manifest (the login page's entry path). Render it inside a <Suspense>.
 * Props: `ClientPickerProps` (components/picker/ClientPicker.tsx).
 */
export const ClientPicker = lazy(() => import('./components/picker/ClientPicker').then((m) => ({ default: m.ClientPicker })))
