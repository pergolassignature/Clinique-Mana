import { Controller } from 'react-hook-form'
import { t, type TranslationKey } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { regionSchema, toRegionFormValues } from '@/core/settings/organization/schemas'
import { CANADIAN_TIMEZONES, isCanadianTimezone, timezoneLabel } from '@/core/settings/organization/timezones'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'
import { TimezonePicker } from '../components/TimezonePicker'

const LANGUAGES: Record<string, TranslationKey> = { 'fr-CA': 'settings.region.locale.languages.fr-CA' }
const CURRENCIES: Record<string, TranslationKey> = { CAD: 'settings.region.locale.currencies.CAD' }

/** A stored code's French name; the code itself for one the app does not name yet. */
const nameOf = (names: Record<string, TranslationKey>, code: string) => {
  const key = names[code]
  return key ? t(key) : code
}

/**
 * The select's zones: the Canadian ones, then the stored zone and the one chosen through « Autre
 * fuseau… » when they are elsewhere, so the select always shows them by name and the stored one
 * can be chosen again.
 */
function zoneOptions(stored: string, current: string): string[] {
  const extra = [stored, current].filter((zone, index, all) => zone !== '' && !isCanadianTimezone(zone) && all.indexOf(zone) === index)
  return [...CANADIAN_TIMEZONES.map((zone) => zone.value), ...extra]
}

function LocaleCard({ organization }: { organization: Organization }) {
  const lines = [
    [t('settings.region.locale.language'), nameOf(LANGUAGES, organization.default_locale)],
    [t('settings.region.locale.currency'), nameOf(CURRENCIES, organization.currency)],
  ] as const
  return (
    <SettingsCard as="section" title={t('settings.region.locale.title')}>
      <dl className="space-y-1 text-sm">
        {lines.map(([term, value]) => (
          <div key={term}>
            {/* A no-break space before the colon (French typography): it never starts a line. */}
            <dt className="inline text-muted-foreground">{term}{'\u00a0'}:</dt> <dd className="inline">{value}</dd>
          </div>
        ))}
      </dl>
    </SettingsCard>
  )
}

/**
 * Paramètres → Région: the clinic's timezone (every date in the app follows it), then its language
 * and currency, shown only. Saving the zone refreshes the access payload, which sets the clinic
 * timezone (`useUpdateOrganization`).
 */
export function RegionSettingsPage() {
  return (
    <OrganizationSettingsPage title={t('settings.sections.region')} description={t('settings.region.description')}>
      {(organization) => (
        <>
          <OrganizationCard
            organization={organization}
            title={t('settings.region.timezone.title')}
            description={t('settings.region.timezone.description')}
            schema={regionSchema}
            toFormValues={toRegionFormValues}
            firstField="timezone"
            successMessage={t('settings.region.timezone.saved')}
          >
            {({ control, setFocus, formState: { errors } }) => (
              <FormField label={t('settings.region.fields.timezone')} error={errors.timezone?.message}>
                {(field) => (
                  // Controlled, so the read-only Select can show the zone's name.
                  <Controller
                    control={control}
                    name="timezone"
                    render={({ field: timezone }) => (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <Select {...field} {...timezone}>
                            {zoneOptions(organization.timezone, timezone.value).map((zone) => (
                              <option key={zone} value={zone}>
                                {timezoneLabel(zone)}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {/* A button does not inherit read-only: hidden, since it would change the zone. */}
                        {!field.readOnly && (
                          <TimezonePicker value={timezone.value} onSelect={(zone) => timezone.onChange(zone)} onChosen={() => setFocus('timezone')} />
                        )}
                      </div>
                    )}
                  />
                )}
              </FormField>
            )}
          </OrganizationCard>

          <LocaleCard organization={organization} />
        </>
      )}
    </OrganizationSettingsPage>
  )
}
