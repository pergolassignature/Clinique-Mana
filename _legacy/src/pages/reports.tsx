import { Link } from '@tanstack/react-router'
import { Building2, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'

const REPORTS = [
  {
    id: 'ivac',
    title: 'Rapport IVAC',
    description: 'Suivi des allocations IVAC pour la facturation aux tiers payeurs',
    href: '/rapports/ivac',
    icon: Building2,
  },
]

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Link key={report.id} to={report.href}>
            <Card className="hover:border-sage-300 hover:shadow-sm transition-all cursor-pointer h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-sage-100 rounded-lg">
                      <report.icon className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">{report.title}</h3>
                      <p className="text-sm text-foreground-muted mt-1">
                        {report.description}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-foreground-muted flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
