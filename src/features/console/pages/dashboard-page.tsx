import { useQuery } from '@tanstack/react-query'
import { AppWindow, ArrowRight, KeyRound, Server, UsersRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState, LoadingState } from '@/features/management/dialogs'
import type { AdminDashboard } from '@/lib/api/management'
import { consoleQueryKeys, getAdminDashboard } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export function ConsoleDashboardPage() {
  const query = useQuery<AdminDashboard>({
    queryKey: consoleQueryKeys.dashboard,
    queryFn: getAdminDashboard,
  })
  if (query.isLoading) return <LoadingState label={tt('Loading Console dashboard')} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const dashboard = query.data
  if (!dashboard) return null
  const realmDashboard = dashboard

  return (
    <>
      <PageHeader
        description={tt('Review Realm inventory, hosted authentication readiness, and configuration gaps.')}
        title={tt('Dashboard')}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail={tt('Realm identities')}
          label={tt('Users')}
          value={realmDashboard.users.pagination.totalItems}
        />
        <MetricCard
          detail={tt('Registered OIDC clients')}
          label={tt('Applications')}
          value={realmDashboard.applications.pagination.totalItems}
        />
        <MetricCard
          detail={tt('Protected APIs')}
          label={tt('Resource servers')}
          value={realmDashboard.apiResources.pagination.totalItems}
        />
        <MetricCard
          detail={tt('Shared membership spaces')}
          label={tt('Organizations')}
          value={realmDashboard.organizations.pagination.totalItems}
        />
      </div>
      <div className="consoleDashboardGrid">
        <RealmReadiness dashboard={realmDashboard} />
        <ConfigurationGaps dashboard={realmDashboard} />
      </div>
    </>
  )
}

export function MetricCard({ detail, label, value }: { detail: string; label: string; value: number | string }) {
  return (
    <Card className="consoleMetricCard border shadow-none ring-0">
      <CardHeader>
        <CardDescription className="font-semibold">{label}</CardDescription>
        <CardTitle className="pt-3 text-[26px] font-semibold tracking-[-0.04em]">{value}</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardHeader>
    </Card>
  )
}

function RealmReadiness({ dashboard }: { dashboard: AdminDashboard }) {
  const enabledMethods = hostedMethodCount(dashboard)
  const enabledConnectors = dashboard.connectors.items.filter((connector) => connector.enabled).length
  const rows = [
    {
      label: tt('Hosted sign-in methods'),
      value: tt('{{count}} available', { count: enabledMethods }),
      ready: enabledMethods > 0,
    },
    {
      label: tt('Identity connectors'),
      value: enabledConnectors ? tt('{{count}} ready', { count: enabledConnectors }) : tt('Built-in methods only'),
      ready: true,
    },
    {
      label: tt('MFA prompt policy'),
      value: dashboard.security.policy.mfa.mode === 'required' ? tt('Required') : tt('Optional'),
      ready: true,
    },
    {
      label: tt('Passkeys'),
      value: dashboard.security.policy.passkeys.enabled ? tt('Available') : tt('Not available'),
      ready: dashboard.security.policy.passkeys.enabled,
    },
  ]

  return (
    <Card className="border shadow-none ring-0">
      <CardHeader>
        <CardTitle>{tt('Realm readiness')}</CardTitle>
        <CardDescription>{tt('Live authentication state from the current management configuration.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid p-0">
        {rows.map((row) => (
          <div className="consoleDashboardStatusRow" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
            <Badge variant={row.ready ? 'secondary' : 'outline'}>{row.ready ? tt('Ready') : tt('Review')}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ConfigurationGaps({ dashboard }: { dashboard: AdminDashboard }) {
  const items: Array<{ href: string; icon: ReactNode; label: string; meta: string }> = []
  if (hostedMethodCount(dashboard) === 0) {
    items.push({
      href: '/console/sign-in-experience/sign-in',
      icon: <KeyRound />,
      label: tt('Enable a sign-in method'),
      meta: tt('Hosted authentication currently has no usable method.'),
    })
  }
  if (dashboard.applications.pagination.totalItems === 0) {
    items.push({
      href: '/console/applications',
      icon: <AppWindow />,
      label: tt('Register an application'),
      meta: tt('No client can use this Realm yet.'),
    })
  }
  if (dashboard.apiResources.pagination.totalItems === 0) {
    items.push({
      href: '/console/api-resources',
      icon: <Server />,
      label: tt('Register a resource server'),
      meta: tt('No protected API is represented in authorization.'),
    })
  }
  return (
    <Card className="border shadow-none ring-0">
      <CardHeader>
        <CardTitle>{tt('Configuration gaps')}</CardTitle>
        <CardDescription>{tt('Actionable gaps derived from current Realm inventory.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid p-0">
        {items.length ? (
          items.map((item) => (
            <div className="consoleAttentionRow" key={item.label}>
              <span className="consoleAttentionIcon">{item.icon}</span>
              <div>
                <strong>{item.label}</strong>
                <span>{item.meta}</span>
              </div>
              <LinkButton
                aria-label={tt('Open {{item}}', { item: item.label })}
                size="icon-sm"
                to={item.href}
                variant="ghost"
              >
                <ArrowRight />
              </LinkButton>
            </div>
          ))
        ) : (
          <div className="consoleDashboardClearState">
            <UsersRound />
            <div>
              <strong>{tt('No overview gaps')}</strong>
              <span>{tt('Core identity, application, API, and role inventory is present.')}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function hostedMethodCount(dashboard: AdminDashboard) {
  const { builtInProviders, signIn } = dashboard.signIn
  return [
    signIn.passwordEnabled,
    signIn.emailOtpEnabled && builtInProviders.email.enabled,
    signIn.socialLoginEnabled &&
      dashboard.connectors.items.some((connector) => connector.enabled && connector.authenticationEnabled),
    dashboard.security.policy.passkeys.enabled,
    builtInProviders.phone.enabled,
    builtInProviders.web3Wallet.enabled,
    builtInProviders.oneTap.enabled,
  ].filter(Boolean).length
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
    return `${String(labelDate.getMonth() + 1).padStart(2, '0')}-${String(labelDate.getDate()).padStart(2, '0')}`
  })
}
