// The module's only public entry (design §6.2). It is on the login page's entry path
// (ALL_MODULES): export the manifest, lazyPages and types only, never runtime code (API, hooks, schemas).
export { clientsManifest, consentPublicPage } from './manifest'
// The client picker for other modules (Demandes, Rendez-vous): lazy, inside a <Suspense>.
export { ClientPicker } from './client-picker'
export type { ClientPickerProps, PickedClient } from './components/picker/ClientPicker'
