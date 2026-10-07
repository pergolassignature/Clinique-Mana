import { useState } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, Sparkles } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/ui/popover'
import type { PAECoverageRule, PAECoverageRuleType } from '../types'
import { COVERAGE_RULE_TEMPLATES } from './coverage-rule-templates'

interface CoverageRuleBuilderProps {
  rules: PAECoverageRule[]
  onChange: (rules: PAECoverageRule[]) => void
}

export function CoverageRuleBuilder({ rules, onChange }: CoverageRuleBuilderProps) {
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const handleAddRule = () => {
    const newOrder = rules.length > 0 ? Math.max(...rules.map((r) => r.order)) + 1 : 1
    const newRule: PAECoverageRule = {
      type: 'free_appointments',
      order: newOrder,
      appointment_count: 3,
    }
    onChange([...rules, newRule])
  }

  const handleRemoveRule = (index: number) => {
    const updated = rules.filter((_, i) => i !== index)
    // Re-order remaining rules
    const reordered = updated.map((rule, i) => ({ ...rule, order: i + 1 }) as PAECoverageRule)
    onChange(reordered)
  }

  const handleUpdateRule = (index: number, updatedRule: PAECoverageRule) => {
    const updated = [...rules]
    updated[index] = updatedRule
    onChange(updated)
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const updated = [...rules]
    const temp = updated[index]
    updated[index] = { ...updated[index - 1], order: index + 1 } as PAECoverageRule
    updated[index - 1] = { ...temp, order: index } as PAECoverageRule
    onChange(updated)
  }

  const handleMoveDown = (index: number) => {
    if (index === rules.length - 1) return
    const updated = [...rules]
    const temp = updated[index]
    updated[index] = { ...updated[index + 1], order: index + 1 } as PAECoverageRule
    updated[index + 1] = { ...temp, order: index + 2 } as PAECoverageRule
    onChange(updated)
  }

  const handleApplyTemplate = (templateRules: PAECoverageRule[]) => {
    onChange(templateRules.map((rule, i) => ({ ...rule, order: i + 1 }) as PAECoverageRule))
    setTemplatesOpen(false)
  }

  // Sort rules by order
  const sortedRules = [...rules].sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      {/* Templates */}
      <div className="flex items-center gap-2">
        <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Sparkles className="h-4 w-4 mr-1" />
              {t('externalPayers.coverageRules.templates')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">{t('externalPayers.coverageRules.selectTemplate')}</h4>
              <div className="space-y-1">
                {COVERAGE_RULE_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleApplyTemplate(template.rules)}
                    className="w-full p-2 text-left rounded hover:bg-background-secondary transition-colors"
                  >
                    <div className="font-medium text-sm">{template.label}</div>
                    <div className="text-xs text-foreground-muted">{template.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="outline" size="sm" onClick={handleAddRule}>
          <Plus className="h-4 w-4 mr-1" />
          {t('externalPayers.coverageRules.addRule')}
        </Button>
      </div>

      {/* Rules List */}
      {sortedRules.length === 0 ? (
        <div className="text-sm text-foreground-muted italic py-4 text-center border border-dashed rounded-lg">
          {t('externalPayers.coverageRules.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRules.map((rule, index) => (
            <RuleEditor
              key={`${rule.type}-${index}`}
              rule={rule}
              index={index}
              totalRules={sortedRules.length}
              onUpdate={(updated) => handleUpdateRule(index, updated)}
              onRemove={() => handleRemoveRule(index)}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
            />
          ))}
        </div>
      )}

      {/* Preview */}
      {sortedRules.length > 0 && (
        <div className="p-3 bg-background-secondary rounded-lg">
          <h5 className="text-xs font-medium text-foreground-secondary mb-1">
            {t('externalPayers.coverageRules.preview')}
          </h5>
          <div className="text-sm">{formatRulesPreview(sortedRules)}</div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// RULE EDITOR
// =============================================================================

interface RuleEditorProps {
  rule: PAECoverageRule
  index: number
  totalRules: number
  onUpdate: (rule: PAECoverageRule) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function RuleEditor({
  rule,
  index,
  totalRules,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: RuleEditorProps) {
  const handleTypeChange = (newType: PAECoverageRuleType) => {
    let newRule: PAECoverageRule

    switch (newType) {
      case 'free_appointments':
        newRule = { type: 'free_appointments', order: rule.order, appointment_count: 3 }
        break
      case 'shared_cost':
        newRule = { type: 'shared_cost', order: rule.order, from_appointment: 1, pae_percentage: 50 }
        break
      case 'fixed_client_amount':
        newRule = { type: 'fixed_client_amount', order: rule.order, from_appointment: 1, client_amount_cents: 5000 }
        break
      case 'included_services':
        newRule = { type: 'included_services', order: rule.order, services: ['evaluation'] }
        break
      default:
        return
    }

    onUpdate(newRule)
  }

  return (
    <div className="flex items-start gap-2 p-3 border rounded-lg bg-background">
      {/* Order controls */}
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveUp}
          disabled={index === 0}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveDown}
          disabled={index === totalRules - 1}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Rule content */}
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">
            {t('externalPayers.coverageRules.rule')} {index + 1}
          </span>
          <Select
            value={rule.type}
            onChange={(e) => handleTypeChange(e.target.value as PAECoverageRuleType)}
            className="h-8 text-sm"
          >
            <option value="free_appointments">{t('externalPayers.coverageRules.types.free_appointments')}</option>
            <option value="shared_cost">{t('externalPayers.coverageRules.types.shared_cost')}</option>
            <option value="fixed_client_amount">{t('externalPayers.coverageRules.types.fixed_client_amount')}</option>
            <option value="included_services">{t('externalPayers.coverageRules.types.included_services')}</option>
          </Select>
        </div>

        {/* Type-specific fields */}
        {rule.type === 'free_appointments' && (
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Nombre de rendez-vous:</Label>
            <Input
              type="number"
              min={1}
              value={rule.appointment_count}
              onChange={(e) =>
                onUpdate({ ...rule, appointment_count: parseInt(e.target.value) || 1 })
              }
              className="h-8 w-20"
            />
          </div>
        )}

        {rule.type === 'shared_cost' && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">A partir du RV:</Label>
              <Input
                type="number"
                min={1}
                value={rule.from_appointment}
                onChange={(e) =>
                  onUpdate({ ...rule, from_appointment: parseInt(e.target.value) || 1 })
                }
                className="h-8 w-16"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">% PAE:</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={rule.pae_percentage}
                onChange={(e) =>
                  onUpdate({ ...rule, pae_percentage: parseInt(e.target.value) || 0 })
                }
                className="h-8 w-16"
              />
            </div>
          </div>
        )}

        {rule.type === 'fixed_client_amount' && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">A partir du RV:</Label>
              <Input
                type="number"
                min={1}
                value={rule.from_appointment}
                onChange={(e) =>
                  onUpdate({ ...rule, from_appointment: parseInt(e.target.value) || 1 })
                }
                className="h-8 w-16"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Client paie:</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={(rule.client_amount_cents / 100).toFixed(2)}
                onChange={(e) =>
                  onUpdate({
                    ...rule,
                    client_amount_cents: Math.round(parseFloat(e.target.value) * 100) || 0,
                  })
                }
                className="h-8 w-20"
              />
              <span className="text-xs">$</span>
            </div>
          </div>
        )}

        {rule.type === 'included_services' && (
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Services:</Label>
            <Input
              value={rule.services.join(', ')}
              onChange={(e) =>
                onUpdate({
                  ...rule,
                  services: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              placeholder="evaluation, suivi"
              className="h-8"
            />
          </div>
        )}
      </div>

      {/* Remove button */}
      <Button variant="ghost" size="icon" onClick={onRemove} className="h-8 w-8 text-wine-600">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

// =============================================================================
// HELPERS
// =============================================================================

function formatRulesPreview(rules: PAECoverageRule[]): string {
  if (!rules || rules.length === 0) return '—'

  const sortedRules = [...rules].sort((a, b) => a.order - b.order)
  const parts: string[] = []

  for (const rule of sortedRules) {
    switch (rule.type) {
      case 'free_appointments':
        parts.push(`${rule.appointment_count} rendez-vous gratuits`)
        break
      case 'shared_cost':
        parts.push(`puis ${rule.pae_percentage}% PAE / ${100 - rule.pae_percentage}% client`)
        break
      case 'fixed_client_amount':
        parts.push(`puis client paie ${(rule.client_amount_cents / 100).toFixed(2)}$`)
        break
      case 'included_services':
        parts.push(`services inclus: ${rule.services.join(', ')}`)
        break
    }
  }

  return parts.join(' → ')
}
