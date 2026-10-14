import { useState } from 'react'
import { Download } from 'lucide-react'
import { t } from '@/i18n'
import { downloadCsv } from '@/shared/lib/csv'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { ignoreWhenInactive, softDisabledClasses } from './soft-disabled'

/** What a list's export gives: the file, and whether it stopped at the maximum. */
export interface CsvFile {
  fileName: string
  content: string
  truncated?: boolean
}

/**
 * « Exporter (CSV) » on a list (parity audit L7): builds the file of what the list's filters
 * select (every page, `collectPages`), then hands it to the browser. The file is made in the
 * browser from what the caller may read (no file stored). A cut file is said (« les 5 000
 * premières lignes »); a failure is a toast in plain French.
 */
export function ExportCsvButton({ build, className }: { build: () => Promise<CsvFile>; className?: string }) {
  const [pending, setPending] = useState(false)
  const run = async () => {
    setPending(true)
    try {
      const file = await build()
      downloadCsv(file.fileName, file.content)
      if (file.truncated) toast.warning(t('common.exportCsv.truncated'))
    } catch {
      toast.error(t('common.exportCsv.failed'))
    } finally {
      setPending(false)
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={pending || undefined}
      className={cn(softDisabledClasses, className)}
      onClick={ignoreWhenInactive(pending, () => void run())}
    >
      <Download aria-hidden className="h-4 w-4" />
      {pending ? t('common.exportCsv.preparing') : t('common.exportCsv.label')}
    </Button>
  )
}
