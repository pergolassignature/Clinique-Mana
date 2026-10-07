import { motion } from 'framer-motion'
import {
  Users,
  UserCircle,
  Inbox,
  Clock,
  BarChart3,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'

interface Stat {
  labelKey: string
  value: string
  icon: typeof Inbox
  color: 'sage' | 'honey' | 'wine'
  suffix?: string
}

const stats: Stat[] = [
  {
    labelKey: 'pages.dashboard.stats.pendingRequests',
    value: '—',
    icon: Inbox,
    color: 'wine',
  },
  {
    labelKey: 'pages.dashboard.stats.activeClients',
    value: '—',
    icon: UserCircle,
    color: 'sage',
  },
  {
    labelKey: 'pages.dashboard.stats.ongoingAssignments',
    value: '—',
    icon: Users,
    color: 'honey',
  },
  {
    labelKey: 'pages.dashboard.stats.avgAssignmentTime',
    value: '—',
    suffix: 'pages.dashboard.units.days',
    icon: Clock,
    color: 'sage',
  },
]

const colorClasses = {
  sage: {
    bg: 'bg-sage-100',
    icon: 'text-sage-600',
  },
  honey: {
    bg: 'bg-honey-100',
    icon: 'text-honey-600',
  },
  wine: {
    bg: 'bg-wine-100',
    icon: 'text-wine-600',
  },
}

export function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          const colors = colorClasses[stat.color as keyof typeof colorClasses]
          const label = t(stat.labelKey as Parameters<typeof t>[0])

          return (
            <motion.div
              key={stat.labelKey}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="rounded-xl border border-border bg-background p-5 shadow-soft"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-foreground-secondary">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {stat.value}
                    {stat.suffix && stat.value !== '—' && (
                      <span className="ml-1 text-sm font-normal text-foreground-muted">
                        {t(stat.suffix as Parameters<typeof t>[0])}
                      </span>
                    )}
                  </p>
                </div>
                <div className={cn('rounded-xl p-2.5', colors.bg)}>
                  <Icon className={cn('h-5 w-5', colors.icon)} />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Two column layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent requests */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl border border-border bg-background p-5 shadow-soft"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">
              {t('pages.dashboard.sections.recentRequests')}
            </h3>
            <Inbox className="h-5 w-5 text-foreground-muted" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border bg-background-secondary/50 p-3"
              >
                <div className="shimmer h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-4 w-32 rounded" />
                  <div className="shimmer h-3 w-24 rounded" />
                </div>
                <div className="shimmer h-6 w-16 rounded-lg" />
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-foreground-muted">
            {t('pages.dashboard.empty.requests')}
          </p>
        </motion.div>

        {/* Recent activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="rounded-xl border border-border bg-background p-5 shadow-soft"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">
              {t('pages.dashboard.sections.recentActivity')}
            </h3>
            <CheckCircle2 className="h-5 w-5 text-foreground-muted" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg p-2"
              >
                <div className="mt-0.5 shimmer h-2 w-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-4 w-full rounded" />
                  <div className="shimmer h-3 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-foreground-muted">
            {t('pages.dashboard.empty.activity')}
          </p>
        </motion.div>
      </div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="rounded-xl border border-border bg-background p-5 shadow-soft"
      >
        <h3 className="font-semibold text-foreground mb-4">
          {t('pages.dashboard.quickActions.title')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { labelKey: 'pages.dashboard.quickActions.newClient', icon: UserCircle },
            { labelKey: 'pages.dashboard.quickActions.processRequest', icon: Inbox },
            { labelKey: 'pages.dashboard.quickActions.viewProfessionals', icon: Users },
            { labelKey: 'pages.dashboard.quickActions.generateReport', icon: BarChart3 },
          ].map((action) => {
            const Icon = action.icon
            const label = t(action.labelKey as Parameters<typeof t>[0])
            return (
              <button
                key={action.labelKey}
                disabled
                className="flex items-center gap-3 rounded-xl border border-border bg-background-secondary/50 p-4 text-left opacity-60 cursor-not-allowed transition-colors"
              >
                <div className="rounded-lg bg-sage-100 p-2">
                  <Icon className="h-4 w-4 text-sage-600" />
                </div>
                <span className="text-sm font-medium text-foreground">
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
