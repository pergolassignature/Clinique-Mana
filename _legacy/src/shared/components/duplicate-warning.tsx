import { motion } from 'framer-motion'
import { AlertTriangle, User, Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { DuplicateMatch, DuplicateConfidence } from '@/shared/hooks/use-duplicate-detection'

interface DuplicateWarningProps {
  matches: DuplicateMatch[]
  highestConfidence: DuplicateConfidence
  onSelectClient: (match: DuplicateMatch) => void
  // For medium confidence - confirmation checkbox
  confirmed?: boolean
  onConfirmChange?: (confirmed: boolean) => void
  className?: string
}

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const today = new Date()
  const birthDate = new Date(dateOfBirth)
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

export function DuplicateWarning({
  matches,
  highestConfidence,
  onSelectClient,
  confirmed,
  onConfirmChange,
  className,
}: DuplicateWarningProps) {
  if (matches.length === 0) return null

  const isHighConfidence = highestConfidence === 'high'
  const isMediumConfidence = highestConfidence === 'medium'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'rounded-xl border p-4',
        isHighConfidence
          ? 'border-honey-200 bg-honey-50/50'
          : 'border-border bg-background-secondary/50',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className={cn(
            'shrink-0 rounded-lg p-2',
            isHighConfidence ? 'bg-honey-100' : 'bg-background-tertiary'
          )}
        >
          <AlertTriangle
            className={cn(
              'h-4 w-4',
              isHighConfidence ? 'text-honey-600' : 'text-foreground-muted'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm font-medium',
              isHighConfidence ? 'text-honey-800' : 'text-foreground'
            )}
          >
            {matches.length > 1
              ? t('pages.requestDetail.clientPicker.duplicates.titlePlural')
              : t('pages.requestDetail.clientPicker.duplicates.title')}
          </p>
          <p className="text-xs text-foreground-muted mt-0.5">
            {isHighConfidence
              ? t('pages.requestDetail.clientPicker.duplicates.highConfidence.description')
              : t('pages.requestDetail.clientPicker.duplicates.mediumConfidence.description')}
          </p>
        </div>
      </div>

      {/* Matched clients */}
      <div className="space-y-2">
        {matches.map((match) => {
          const age = calculateAge(match.dateOfBirth)

          return (
            <div
              key={match.id}
              className={cn(
                'rounded-lg border p-3',
                isHighConfidence
                  ? 'border-honey-200 bg-white'
                  : 'border-border bg-background'
              )}
            >
              {/* Client info row */}
              <div className="flex items-center gap-2.5">
                {/* Avatar */}
                <div className="shrink-0 h-8 w-8 rounded-full bg-sage-100 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-sage-600" />
                </div>

                {/* Name and age */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {match.firstName} {match.lastName}
                    </span>
                    {age !== null && (
                      <span className="text-xs text-foreground-muted shrink-0">
                        {age} {t('pages.requestDetail.clientPicker.duplicates.client.age')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Match reasons */}
              <div className="flex flex-wrap gap-1 mt-2 ml-10.5">
                {match.matchReasons.map((reason) => (
                  <Badge
                    key={reason}
                    variant={match.confidence === 'high' ? 'warning' : 'secondary'}
                    className="text-xs"
                  >
                    {t(
                      `pages.requestDetail.clientPicker.duplicates.matchReasons.${reason}` as Parameters<
                        typeof t
                      >[0]
                    )}
                  </Badge>
                ))}
              </div>

              {/* Contact info */}
              <div className="mt-1.5 ml-10.5 text-xs text-foreground-muted space-y-0.5">
                {match.email && <div className="truncate">{match.email}</div>}
                {match.phone && <div>{match.phone}</div>}
              </div>

              {/* Action button - full width below */}
              <div className="mt-3 pt-2.5 border-t border-border/50">
                <Button
                  size="sm"
                  variant={isHighConfidence ? 'default' : 'outline'}
                  className="w-full h-8 text-xs gap-1.5"
                  onClick={() => onSelectClient(match)}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t('pages.requestDetail.clientPicker.duplicates.actions.selectExisting')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* High confidence: blocked message */}
      {isHighConfidence && (
        <div className="mt-3 pt-3 border-t border-honey-200">
          <p className="text-xs text-honey-700">
            {t('pages.requestDetail.clientPicker.duplicates.highConfidence.blocked')}
          </p>
        </div>
      )}

      {/* Medium confidence: confirmation checkbox */}
      {isMediumConfidence && onConfirmChange !== undefined && (
        <div className="mt-3 pt-3 border-t border-border">
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <div className="relative shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => onConfirmChange(e.target.checked)}
                className="peer sr-only"
              />
              <div
                className={cn(
                  'h-4 w-4 rounded border transition-colors',
                  confirmed
                    ? 'bg-sage-500 border-sage-500'
                    : 'bg-background border-border group-hover:border-sage-300'
                )}
              >
                {confirmed && <Check className="h-4 w-4 text-white p-0.5" />}
              </div>
            </div>
            <span className="text-sm text-foreground-secondary group-hover:text-foreground transition-colors">
              {t('pages.requestDetail.clientPicker.duplicates.mediumConfidence.confirmLabel')}
            </span>
          </label>
        </div>
      )}
    </motion.div>
  )
}
