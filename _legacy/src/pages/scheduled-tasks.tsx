// src/pages/scheduled-tasks.tsx

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Loader2, Play, Clock, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { formatInClinicTimezone } from '@/shared/lib/timezone'
import { useToast } from '@/shared/hooks/use-toast'

interface CronJob {
  jobid: number
  schedule: string
  command: string
  nodename: string
  nodeport: number
  database: string
  username: string
  active: boolean
  jobname: string
}

interface CronJobRun {
  runid: number
  jobid: number
  job_pid: number
  database: string
  username: string
  command: string
  status: string
  return_message: string
  start_time: string
  end_time: string
}

// Fetch cron jobs from pg_cron schema
async function fetchCronJobs(): Promise<CronJob[]> {
  const { data, error } = await supabase.rpc('get_cron_jobs')

  if (error) {
    // If function doesn't exist yet, return empty array
    if (error.code === 'PGRST202' || error.message.includes('does not exist')) {
      return []
    }
    throw error
  }

  return data || []
}

// Fetch recent cron job runs
async function fetchCronJobRuns(limit = 20): Promise<CronJobRun[]> {
  const { data, error } = await supabase.rpc('get_cron_job_runs', { run_limit: limit })

  if (error) {
    // If function doesn't exist yet, return empty array
    if (error.code === 'PGRST202' || error.message.includes('does not exist')) {
      return []
    }
    throw error
  }

  return data || []
}

// Execute a cron job manually
async function executeCronJob(jobName: string): Promise<{ success: boolean; message: string }> {
  // For insurance expiry check, we call the function directly
  if (jobName === 'check-insurance-expiry-daily') {
    const { data, error } = await supabase.rpc('deactivate_professionals_with_expired_insurance')

    if (error) {
      throw error
    }

    const count = Array.isArray(data) ? data.length : 0
    return {
      success: true,
      message: count > 0
        ? `${count} professionnel(s) désactivé(s) pour assurance expirée`
        : 'Aucun professionnel à désactiver'
    }
  }

  throw new Error(`Tâche inconnue: ${jobName}`)
}

// Hook to fetch cron jobs
function useCronJobs() {
  return useQuery({
    queryKey: ['cron-jobs'],
    queryFn: fetchCronJobs,
    staleTime: 30000, // 30 seconds
  })
}

// Hook to fetch cron job runs
function useCronJobRuns() {
  return useQuery({
    queryKey: ['cron-job-runs'],
    queryFn: () => fetchCronJobRuns(20),
    staleTime: 30000,
  })
}

// Format cron schedule to human-readable (basic)
function formatCronSchedule(schedule: string): string {
  // Common patterns
  if (schedule === '0 6 * * *') return 'Tous les jours à 6h00 UTC (1h00 EST)'
  if (schedule === '0 0 * * *') return 'Tous les jours à minuit UTC'
  if (schedule === '0 * * * *') return 'Toutes les heures'
  if (schedule === '* * * * *') return 'Toutes les minutes'

  return schedule
}

// Get status badge variant
function getStatusBadge(status: string) {
  switch (status) {
    case 'succeeded':
      return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />Succès</Badge>
    case 'failed':
      return <Badge variant="error" className="gap-1"><AlertCircle className="h-3 w-3" />Échec</Badge>
    case 'running':
      return <Badge variant="warning" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />En cours</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

export function ScheduledTasksPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: jobs, isLoading: jobsLoading, error: jobsError } = useCronJobs()
  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useCronJobRuns()

  const executeMutation = useMutation({
    mutationFn: executeCronJob,
    onSuccess: (result) => {
      toast({
        title: 'Tâche exécutée',
        description: result.message,
      })
      // Refresh runs after manual execution
      queryClient.invalidateQueries({ queryKey: ['cron-job-runs'] })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur lors de l\'exécution',
        variant: 'error',
      })
    },
  })

  // Hardcoded task for display even if pg_cron not configured yet
  const insuranceTask = {
    jobname: 'check-insurance-expiry-daily',
    schedule: '0 6 * * *',
    description: 'Vérifie les preuves d\'assurance expirées et désactive les professionnels sans assurance valide',
    active: jobs?.some(j => j.jobname === 'check-insurance-expiry-daily') ?? false,
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tâches planifiées</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Gestion des tâches automatiques (cron jobs)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
            refetchRuns()
          }}
          disabled={jobsLoading || runsLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${(jobsLoading || runsLoading) ? 'animate-spin' : ''}`} />
          Actualiser
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-sage-200 bg-sage-50 p-4">
        <div className="flex gap-3">
          <Clock className="h-5 w-5 text-sage-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-sage-800">À propos des tâches planifiées</p>
            <p className="text-sage-600 mt-1">
              Ces tâches s'exécutent automatiquement selon leur horaire configuré.
              Vous pouvez également les exécuter manuellement si nécessaire.
            </p>
          </div>
        </div>
      </div>

      {/* Tasks list */}
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Tâches configurées</h2>

        {jobsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-sage-600" />
          </div>
        ) : jobsError ? (
          <Card>
            <CardContent className="py-8 text-center">
              <AlertCircle className="h-8 w-8 text-wine-500 mx-auto mb-2" />
              <p className="text-sm text-foreground-muted">
                Impossible de charger les tâches planifiées.
                <br />
                Vérifiez que l'extension pg_cron est activée.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Insurance expiry task (always shown) */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      Vérification des assurances expirées
                      {insuranceTask.active ? (
                        <Badge variant="success" className="text-xs">Actif</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Non configuré</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {insuranceTask.description}
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => executeMutation.mutate('check-insurance-expiry-daily')}
                    disabled={executeMutation.isPending}
                  >
                    {executeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-1" />
                        Exécuter
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-foreground-muted">
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{formatCronSchedule(insuranceTask.schedule)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Other jobs from database */}
            {jobs?.filter(j => j.jobname !== 'check-insurance-expiry-daily').map((job) => (
              <Card key={job.jobid}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {job.jobname}
                        {job.active ? (
                          <Badge variant="success" className="text-xs">Actif</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Inactif</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {job.command}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-4 text-sm text-foreground-muted">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatCronSchedule(job.schedule)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent runs */}
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Exécutions récentes</h2>

        {runsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-sage-600" />
          </div>
        ) : !runs || runs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Clock className="h-8 w-8 text-foreground-muted mx-auto mb-2" />
              <p className="text-sm text-foreground-muted">
                Aucune exécution récente enregistrée
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-background-secondary/50">
                  <th className="text-left py-2 px-4 font-medium">Tâche</th>
                  <th className="text-left py-2 px-4 font-medium">Statut</th>
                  <th className="text-left py-2 px-4 font-medium">Début</th>
                  <th className="text-left py-2 px-4 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runid} className="border-b last:border-0">
                    <td className="py-2 px-4 font-mono text-xs">{run.command.slice(0, 50)}...</td>
                    <td className="py-2 px-4">{getStatusBadge(run.status)}</td>
                    <td className="py-2 px-4 text-foreground-muted">
                      {formatInClinicTimezone(run.start_time, 'dd MMM HH:mm')}
                    </td>
                    <td className="py-2 px-4 text-foreground-muted truncate max-w-xs">
                      {run.return_message || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Setup instructions if pg_cron not configured */}
      {!insuranceTask.active && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base text-amber-800 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Configuration requise
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-700 space-y-3">
            <p>
              Pour activer la vérification automatique des assurances, configurez pg_cron dans le dashboard Supabase :
            </p>
            <ol className="list-decimal list-inside space-y-2">
              <li>Aller dans <strong>Database → Extensions</strong></li>
              <li>Activer l'extension <code className="bg-amber-100 px-1 rounded">pg_cron</code></li>
              <li>Exécuter la commande SQL suivante dans l'éditeur SQL :</li>
            </ol>
            <pre className="bg-amber-100 p-3 rounded text-xs overflow-x-auto">
{`SELECT cron.schedule(
  'check-insurance-expiry-daily',
  '0 6 * * *',
  $$ SELECT public.deactivate_professionals_with_expired_insurance(); $$
);`}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
