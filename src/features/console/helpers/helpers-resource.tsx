import { useConsoleScope } from '@/lib/console-context'
import {
  AlertCircle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CheckCircle2,
  ConsoleToolbar,
  cn,
  createElement,
  type DetailTab,
  EmptyState,
  type ManagementReadinessItem,
  PageHeader,
  type ReactNode,
  Tabs,
  TabsList,
  TabsTrigger,
  useNavigate,
} from '../console-shared'
import { ErrorState, LoadingState } from './helpers-dialogs'

export function ResourcePage({
  action,
  aside,
  auxiliary,
  children,
  description,
  empty,
  emptyDescription,
  emptyTitle,
  error,
  framed = true,
  loading,
  onRetry,
  tableToolbar,
  title,
  toolbar,
}: {
  action?: ReactNode
  aside?: ReactNode
  auxiliary?: ReactNode
  children: ReactNode
  description: string
  empty?: boolean
  emptyDescription?: string
  emptyTitle?: string
  error?: Error | null
  framed?: boolean
  loading?: boolean
  onRetry?: () => void
  tableToolbar?: ReactNode
  title: string
  toolbar?: ReactNode
}) {
  const content = (
    <>
      <PageHeader action={action} description={description} title={title} />
      {toolbar ? <div>{toolbar}</div> : null}
      {loading && !tableToolbar ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
      {error && !tableToolbar ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && empty && !framed ? (
        <EmptyState
          description={emptyDescription ?? `Create a ${title.toLowerCase()} item to populate this page.`}
          title={emptyTitle ?? `No ${title.toLowerCase()} yet`}
        />
      ) : null}
      {framed && tableToolbar ? (
        <DataTablePanel toolbar={tableToolbar}>
          {loading ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
          {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
          {!loading && !error ? children : null}
        </DataTablePanel>
      ) : null}
      {!loading && !error && framed && !tableToolbar ? (
        <Card className="consoleResourceFrame border py-0 shadow-none ring-0">
          <CardContent className="p-0">{children}</CardContent>
        </Card>
      ) : null}
      {!loading && !error && !empty && !framed ? children : null}
      {auxiliary}
    </>
  )

  if (!aside || loading || error) return content

  return (
    <div className="consoleResourcePageWithAside">
      <div className="consoleResourcePageMain">{content}</div>
      {aside}
    </div>
  )
}
export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <ConsoleToolbar className="consoleListToolbar">
      <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-max">{children}</div>
    </ConsoleToolbar>
  )
}
export function DataTablePanel({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  return (
    <Card className="consoleDataTablePanel consoleResourceFrame gap-0 overflow-hidden border py-0 shadow-none ring-0">
      {toolbar ? <CardHeader className="consoleDataTableToolbar border-b">{toolbar}</CardHeader> : null}
      <CardContent className="overflow-x-auto p-0">{children}</CardContent>
    </Card>
  )
}
export function ObjectHeader({ badge, id, title }: { badge: string; id: string; title: string }) {
  return (
    <div className="objectHeader">
      <div className="objectAvatar" aria-hidden="true">
        {title.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{badge}</Badge>
          <code className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{id}</code>
        </div>
        <p className="text-xl font-semibold leading-tight tracking-normal">{title}</p>
      </div>
    </div>
  )
}
export function DetailTabs({
  label,
  onChange,
  tabs,
  value,
}: {
  label: string
  onChange: (value: string) => void
  tabs: DetailTab[]
  value: string
}) {
  return (
    <Tabs onValueChange={onChange} value={value}>
      <TabsList aria-label={label} className="w-full sm:w-auto" variant="navigation">
        {tabs.map((tab) =>
          createElement(
            TabsTrigger,
            {
              key: tab.value,
              value: tab.value,
            },
            tab.label,
          ),
        )}
      </TabsList>
    </Tabs>
  )
}
export function navigateConsoleTab(navigate: ReturnType<typeof useNavigate>, href: string, context?: string) {
  if (window.location.pathname.startsWith('/console/'))
    void navigate({
      to: href,
      search: context ? { context } : {},
    })
}
export function userDetailTabs(): DetailTab[] {
  return [
    {
      value: 'overview',
      label: 'Overview',
    },
    {
      value: 'authentication',
      label: 'Authentication',
    },
    {
      value: 'sessions',
      label: 'Sessions',
    },
    {
      value: 'agents',
      label: 'Agents',
    },
    {
      value: 'authorized-apps',
      label: 'Authorized apps',
    },
    {
      value: 'settings',
      label: 'Settings',
    },
  ]
}
export function organizationDetailTabs(): DetailTab[] {
  return [
    {
      value: 'overview',
      label: 'Overview',
    },
    {
      value: 'members',
      label: 'Members',
    },
    {
      value: 'agents',
      label: 'Agents',
    },
    {
      value: 'activity',
      label: 'Activity',
    },
    {
      value: 'settings',
      label: 'Settings',
    },
  ]
}
export function roleDetailTabs(): DetailTab[] {
  return [
    {
      value: 'overview',
      label: 'Overview',
    },
    {
      value: 'permissions',
      label: 'Permissions',
    },
    {
      value: 'assignments',
      label: 'Assignments',
    },
    {
      value: 'activity',
      label: 'Activity',
    },
    {
      value: 'settings',
      label: 'Settings',
    },
  ]
}
export function apiResourceDetailTabs(): DetailTab[] {
  return [
    { value: 'overview', label: 'Overview' },
    { value: 'resources', label: 'Resources' },
    { value: 'authority', label: 'Roles & grants' },
    { value: 'settings', label: 'Settings' },
  ]
}
export function SetupChecklist({ items, title }: { items: ManagementReadinessItem[]; title: string }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-3">
        {items.map((item) => {
          const complete = item.status === 'complete'
          return (
            <div
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
              key={item.id}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {complete ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <a className="uiButton uiButton-ghost" href={item.href}>
                {item.action}
              </a>
            </div>
          )
        })}
      </div>
    </section>
  )
}
export function SecuritySectionTabs({ active }: { active: 'captcha' | 'blocklist' | 'general' }) {
  return (
    <RoutedSettingsTabs
      active={active}
      ariaLabel="Security settings"
      tabs={[
        ['captcha', 'CAPTCHA', '/console/security/captcha'],
        ['blocklist', 'Blocklist', '/console/security/blocklist'],
        ['general', 'General', '/console/security/general'],
      ]}
    />
  )
}
export function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
export function RoutedSettingsTabs<TValue extends string>({
  active,
  ariaLabel,
  onSelect,
  tabs,
}: {
  active: TValue
  ariaLabel: string
  onSelect?: (value: TValue) => void
  tabs: ReadonlyArray<readonly [TValue, string, string]>
}) {
  const navigate = useNavigate()
  const { organizationId } = useConsoleScope()
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-6 border-b border-border">
      {tabs.map(([value, label, to]) => (
        <a
          aria-current={active === value ? 'page' : undefined}
          className={cn(
            'relative -mb-px inline-flex min-h-10 items-center justify-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground',
            active === value && 'border-primary text-primary',
          )}
          href={organizationId ? `${to}?context=${encodeURIComponent(organizationId)}` : to}
          key={value}
          onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0) return
            if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
            event.preventDefault()
            onSelect?.(value)
            navigateConsoleTab(navigate, to, organizationId)
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  )
}
