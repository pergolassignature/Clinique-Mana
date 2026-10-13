import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { PERIOD_PRESETS, presetPeriod, type Period } from '../lib/reports'

const R = 'modules.reports'

interface ReportControlsProps {
  period: Period
  today: string
  periodError: string | null
  onPeriod: (p: Period) => void
  /** The other filters (professional, service…), after the period. */
  children?: ReactNode
  /** « Exporter (CSV) »; omitted while nothing can be exported. */
  onExport?: () => void
}

/** The period (« Du », « Au » and the quick choices), the report's filters and « Exporter (CSV) ». */
export function ReportControls({ period, today, periodError, onPeriod, children, onExport }: ReportControlsProps) {
  return (
    <section aria-label={t(`${R}.filters`)} className="space-y-3 rounded-lg border border-border-light bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t(`${R}.period.from`)} width="sm" error={periodError ?? undefined}>
          {(field) => <Input {...field} type="date" className="tabular" value={period.from} onChange={(e) => onPeriod({ ...period, from: e.target.value })} />}
        </FormField>
        <FormField label={t(`${R}.period.to`)} width="sm">
          {(field) => <Input {...field} type="date" className="tabular" value={period.to} onChange={(e) => onPeriod({ ...period, to: e.target.value })} />}
        </FormField>
        <div className="flex flex-wrap gap-2 pb-0.5" role="group" aria-label={t(`${R}.period.presets`)}>
          {PERIOD_PRESETS.map((preset) => (
            <Button key={preset} type="button" variant="outline" size="sm" onClick={() => onPeriod(presetPeriod(preset, today))}>
              {t(`${R}.period.${preset}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <div className="ml-auto pb-0.5">
          <Button type="button" variant="outline" onClick={onExport} aria-disabled={!onExport || undefined}>
            <Download aria-hidden className="h-4 w-4" />
            {t(`${R}.export`)}
          </Button>
        </div>
      </div>
    </section>
  )
}

interface FilterSelectProps {
  label: string
  value: string | null
  allLabel: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string | null) => void
}

/** A filter: « Tous les professionnels » or one of them. A value no longer offered stays listed. */
export function FilterSelect({ label, value, allLabel, options, onChange }: FilterSelectProps) {
  const listed = value && !options.some((o) => o.value === value) ? [...options, { value, label: t(`${R}.otherValue`) }] : options
  return (
    <FormField label={label} width="md">
      {(field) => (
        <Select {...field} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{allLabel}</option>
          {listed.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  )
}

/** The report's totals, as figures with their labels. */
export function Totals({ label, items }: { label: string; items: readonly { label: string; value: string }[] }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border-light bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="tabular mt-0.5 text-base font-semibold text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
