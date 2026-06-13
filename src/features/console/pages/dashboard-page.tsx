import { useQuery } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import type { AdminDashboard } from '@/lib/api/management'
import { consoleQueryKeys, getAdminDashboard } from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ErrorState, LoadingState } from '../helpers/helpers-dialogs'

export function ConsoleDashboardPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.dashboard,
    queryFn: getAdminDashboard,
  })
  if (query.isLoading) return <LoadingState label={tt('Loading Console dashboard')} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const dashboard = query.data
  /* v8 ignore next -- data is always present after the isLoading/isError guards above */
  if (!dashboard) return null
  return (
    <>
      <PageHeader
        title={tt('Dashboard')}
        description={tt('Get an overview about your identity service performance.')}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          detail={tt('Tenant identities available to hosted auth.')}
          label={tt('Total users')}
          value={dashboard.users.pagination.total}
        />
        <MetricCard
          detail={tt('Users created in the last 24 hours.')}
          label={tt('New users today')}
          pending
          value="--"
        />
        <MetricCard
          detail={tt('Users created in the past seven days.')}
          label={tt('New users past 7 days')}
          pending
          value="--"
        />
      </div>
      <DashboardChartPanel dashboard={dashboard} />
    </>
  )
}

export function MetricCard({
  detail,
  label,
  pending,
  value,
}: {
  detail: string
  label: string
  pending?: boolean
  value: number | string
}) {
  return (
    <Card className="consoleMetricCard">
      <CardHeader className="p-5">
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="font-semibold text-foreground">{label}</CardDescription>
          {pending ? <Badge variant="outline">{tt('Pending')}</Badge> : null}
        </div>
        <CardTitle className="pt-5 text-2xl leading-none">{value}</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardHeader>
    </Card>
  )
}

function DashboardChartPanel({ dashboard }: { dashboard: AdminDashboard }) {
  void dashboard
  return (
    <Card className="consoleChartPanel">
      <CardHeader className="flex-row items-start justify-between gap-3 p-5">
        <div>
          <CardTitle>{tt('Daily active users')}</CardTitle>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-2xl font-semibold leading-none">--</span>
            <span className="text-sm font-medium text-muted-foreground">{tt('Pending activity data')}</span>
          </div>
        </div>
        <Button type="button" variant="secondary">
          {formatDashboardDate(new Date())}
          <CalendarDays data-icon="inline-end" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-6 p-5 pt-0">
        <div aria-label={tt('Daily active users trend')} className="consoleChartCanvas" role="img">
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartLine" />
          <div className="consoleChartLabels" aria-hidden="true">
            {dashboardChartLabels(new Date()).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardActivityCard label={tt('Weekly active users')} />
          <DashboardActivityCard label={tt('Monthly active users')} />
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardActivityCard({ label }: { label: string }) {
  return (
    <div className="consoleActivityCard">
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-8 flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold leading-none">--</span>
        <span className="text-sm font-medium text-muted-foreground">{tt('Pending')}</span>
      </div>
    </div>
  )
}

export function formatDashboardDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dashboardChartLabels(date: Date) {
  return Array.from({ length: 8 }, (_, index) => {
    const labelDate = new Date(date)
    labelDate.setDate(date.getDate() - (7 - index) * 4)
    const month = String(labelDate.getMonth() + 1).padStart(2, '0')
    const day = String(labelDate.getDate()).padStart(2, '0')
    return `${month}-${day}`
  })
}
