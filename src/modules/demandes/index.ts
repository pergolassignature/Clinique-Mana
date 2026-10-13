// The module's only public entry (design §6.2). It is on the login page's entry path
// (ALL_MODULES): export the manifest, lazyPages and types only, never runtime code (API, hooks, schemas).
export { bookingCancelPublicPage, bookingPublicPage, demandesManifest } from './manifest'
