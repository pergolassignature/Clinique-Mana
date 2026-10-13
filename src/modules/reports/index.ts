// The module's only public entry (design §6.2). It is on the login page's entry path
// (ALL_MODULES): export the manifest only, never runtime code (API, hooks).
export { reportsManifest } from './manifest'
