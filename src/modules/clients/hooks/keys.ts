/**
 * React Query keys of Clients. C5a (consents) first; C2 / C3 add the client lists and records.
 *
 * | Change                                          | Invalidated                                  |
 * |-------------------------------------------------|----------------------------------------------|
 * | a consent sent, re-sent or cancelled            | `consentKeys.toObtain()`, `client(id)`       |
 * | a rule or the settings saved                    | `rules()` / `settings()` (written as is)     |
 * | a text published                                | `templates()`, `consentKeys.all` (flags)     |
 * | the public page                                 | none: component state only (a credential)    |
 */
export const consentKeys = {
  all: ['clients', 'consents'] as const,
  types: () => [...consentKeys.all, 'types'] as const,
  rules: () => [...consentKeys.all, 'rules'] as const,
  settings: () => [...consentKeys.all, 'settings'] as const,
  templates: () => [...consentKeys.all, 'templates'] as const,
  toObtain: () => [...consentKeys.all, 'to-obtain'] as const,
  client: (clientId: string) => [...consentKeys.all, 'client', clientId] as const,
}
