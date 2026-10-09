// The module's only public entry (design §6.2). It is on the login page's entry path
// (ALL_MODULES): export the manifest and types only, never runtime code (API, hooks, schemas).
export { professionalsManifest } from './manifest'
export type { ProfessionalStatus, AvailabilityPeriod, Gender } from './lib/constants'
