/**
 * Fixtures for the email function tests: a `get_email_context` result for
 * `core.staff_invite` (the Task 3.6 shape) and `get_my_access` payloads.
 * Test-only: never deployed.
 */

export const ORG_ID = '00000000-0000-4000-8000-000000000001'
export const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1'
export const ADMIN_EMAIL = 'admin@mana.test'

/** A `get_email_context` result; `template` fields are merged, others replace. */
export function emailContextFixture(over: {
  template?: Record<string, unknown>
  [key: string]: unknown
} = {}): Record<string, unknown> {
  const { template, ...rest } = over
  return {
    module_key: 'core',
    module_enabled: true,
    timezone: 'America/Toronto',
    template: {
      key: 'core.staff_invite',
      version: 0,
      subject: 'Votre accès à {{clinic.name}}',
      body: 'Bonjour {{invitee.display_name}},\n\n' +
        '{{inviter.display_name}} vous invite. ' +
        'Valide jusqu’au {{invitation.expires_at}}.',
      button_label: 'Créer mon accès',
      why_line:
        'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.',
      variables: [
        {
          path: 'invitee.display_name',
          label: 'Personne invitée',
          sample: 'Ana Gagnon',
          required: true,
          kind: 'text',
        },
        {
          path: 'inviter.display_name',
          label: 'Personne qui invite',
          sample: 'Christine Tremblay',
          required: true,
          kind: 'text',
        },
        {
          path: 'clinic.name',
          label: 'Nom de la clinique',
          sample: 'Clinique MANA',
          required: true,
          kind: 'text',
        },
        {
          path: 'invitation.expires_at',
          label: 'Expiration',
          sample: '15 octobre 2026 à 14 h 30',
          required: true,
          kind: 'datetime',
        },
      ],
      view_permission: 'users.view',
      recipient_mode: 'subject',
      allows_attachments: false,
      ...template,
    },
    sender: {
      from_name: 'Clinique MANA (local)',
      from_address: 'no-reply@gestion.cliniquemana.com',
      reply_to: null,
    },
    clinic: {
      name: 'Clinique MANA (local)',
      address_line1: null,
      address_line2: null,
      city: null,
      province: null,
      postal_code: null,
      phone: null,
      website: null,
      privacy_officer_name: null,
      privacy_officer_email: null,
    },
    ...rest,
  }
}

/** A `get_my_access` payload: the seed admin, or anyone with `permissions`. */
export function accessFixture(
  permissions = ['settings.view', 'settings.email_manage'],
): Record<string, unknown> {
  return {
    user_id: ADMIN_ID,
    org_id: ORG_ID,
    email: ADMIN_EMAIL,
    status: 'active',
    role: 'admin',
    permissions,
    modules: [],
  }
}
