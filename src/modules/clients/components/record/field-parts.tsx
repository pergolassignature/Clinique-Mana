import type { ReactNode } from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { DateField } from '@/shared/ui/date-field'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { ClientFieldKey, ClientFieldOutput, ClientFormValues } from '../../schemas/client'

/** The record cards' field pieces, so each card reads as a list of fields. */
type ClientForm = UseFormReturn<ClientFormValues, unknown, ClientFieldOutput>

interface TextProps {
  form: ClientForm
  name: ClientFieldKey
  label: string
  width?: 'xs' | 'sm' | 'md' | 'full'
  required?: boolean
  help?: string
  type?: 'text' | 'email' | 'tel'
  /** Regroups the value once the field is left (phones, postal codes). */
  regroup?: (value: string) => string
}

export function TextField({ form, name, label, width = 'md', required, help, type = 'text', regroup }: TextProps) {
  const error = form.formState.errors[name]?.message
  return (
    <FormField label={label} width={width} required={required} help={help} error={error}>
      {(field) => (
        <Input
          {...field}
          {...form.register(name, regroup ? regroupOnBlur(form, name, regroup) : undefined)}
          type={type}
          autoComplete="off"
          spellCheck={type === 'email' ? false : undefined}
        />
      )}
    </FormField>
  )
}

/** A calendar date (birthday): `yyyy-MM-dd`, clearable, as the native date input was. */
export function DateInputField({ form, name, label, width = 'sm', required, help }: Omit<TextProps, 'type' | 'regroup'>) {
  const error = form.formState.errors[name]?.message
  return (
    <FormField label={label} width={width} required={required} help={help} error={error}>
      {(field) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field: f }) => <DateField {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} min="1900-01-01" clearable={!required} />}
        />
      )}
    </FormField>
  )
}

interface SelectProps {
  form: ClientForm
  name: ClientFieldKey
  label: string
  width?: 'sm' | 'md' | 'full'
  required?: boolean
  /** The empty choice's words; without it the field has no empty choice. */
  placeholder?: string
  help?: string
  options: readonly { value: string; label: string }[]
}

export function SelectField({ form, name, label, width = 'md', required, placeholder, help, options }: SelectProps) {
  const error = form.formState.errors[name]?.message
  return (
    <FormField label={label} width={width} required={required} help={help} error={error}>
      {(field) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field: f }) => (
            <Select
              {...field}
              value={f.value as string}
              onChange={f.onChange}
              onBlur={f.onBlur}
              ref={f.ref}
              placeholder={placeholder}
              clearable={placeholder !== undefined}
              readOnlyEmptyLabel={placeholder}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        />
      )}
    </FormField>
  )
}

export function CheckField({ form, name, label, help }: { form: ClientForm; name: ClientFieldKey; label: string; help?: string }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field: f }) => <CheckboxField ref={f.ref} label={label} help={help} checked={f.value as boolean} onCheckedChange={f.onChange} onBlur={f.onBlur} />}
    />
  )
}

/** A group of check fields, spaced as a form row. */
export function CheckGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>
}
