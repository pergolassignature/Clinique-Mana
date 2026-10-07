// src/facturation/components/client-balance-badge.tsx
// Badge component showing client balance (positive = credit, negative = owes)

import { cn } from '@/shared/lib/utils'
import { formatCentsCurrency } from '../utils/pricing'

interface ClientBalanceBadgeProps {
  balanceCents: number
  size?: 'sm' | 'md' | 'lg'
  showZero?: boolean
  className?: string
}

/**
 * Displays client balance as a colored badge.
 * - Negative balance (owes money): red/amber
 * - Zero balance: neutral/green
 * - Positive balance (has credit): green/blue
 */
export function ClientBalanceBadge({
  balanceCents,
  size = 'sm',
  showZero = false,
  className,
}: ClientBalanceBadgeProps) {
  // Don't show badge if balance is zero and showZero is false
  if (balanceCents === 0 && !showZero) {
    return null
  }

  const isNegative = balanceCents < 0
  const isPositive = balanceCents > 0

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-base px-2.5 py-1',
  }

  const colorClasses = isNegative
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : isPositive
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-muted text-foreground-muted border-border'

  const displayAmount = formatCentsCurrency(Math.abs(balanceCents))
  const prefix = isNegative ? 'Solde: ' : isPositive ? 'Crédit: ' : ''

  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-medium',
        sizeClasses[size],
        colorClasses,
        className
      )}
    >
      {prefix}{displayAmount}
    </span>
  )
}

/**
 * Inline text display of client balance (no badge styling).
 * For use in tables or compact lists.
 */
export function ClientBalanceText({
  balanceCents,
  showLabel = false,
  className,
}: {
  balanceCents: number
  showLabel?: boolean
  className?: string
}) {
  if (balanceCents === 0) {
    return showLabel ? (
      <span className={cn('text-foreground-muted', className)}>
        Aucun solde
      </span>
    ) : null
  }

  const isNegative = balanceCents < 0
  const colorClass = isNegative ? 'text-amber-600' : 'text-emerald-600'
  const displayAmount = formatCentsCurrency(Math.abs(balanceCents))
  const label = isNegative ? 'Doit: ' : 'Crédit: '

  return (
    <span className={cn(colorClass, className)}>
      {showLabel && label}
      {isNegative ? '-' : '+'}{displayAmount}
    </span>
  )
}
