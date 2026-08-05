import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { OrganizationResponse } from '@shared/api/authorization'
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router'
import {
  AppWindow,
  Bot,
  Building2,
  Cable,
  ChevronsUpDown,
  Code2,
  Fingerprint,
  Gauge,
  Globe2,
  HelpCircle,
  Menu,
  Palette,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  UserRound,
  UsersRound,
  Webhook,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ProductAccountMenu } from '@/components/product-account-menu'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { UserProfile } from '@/features/account/types'
import { signOut } from '@/lib/auth-client'
import { ConsoleScopeProvider } from '@/lib/console-context'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type ConsoleContext = 'realm' | 'organization'

type ConsoleNavItem = {
  href: string
  icon: typeof Gauge
  label: string
  activePaths?: string[]
  contexts?: ConsoleContext[]
}

type ConsoleNavGroup = {
  items: ConsoleNavItem[]
  label?: string
  contexts?: ConsoleContext[]
}

const consoleNavGroups: ConsoleNavGroup[] = [
  {
    items: [{ href: '/console', label: 'Dashboard', icon: Gauge, activePaths: ['/console', '/console/dashboard'] }],
  },
  {
    label: 'Identity',
    items: [
      { href: '/console/users', label: 'Users', icon: UsersRound },
      { href: '/console/agents', label: 'Agents', icon: Bot },
      { href: '/console/organizations', label: 'Organizations', icon: Building2, contexts: ['realm'] },
    ],
  },
  {
    label: 'Develop',
    items: [
      { href: '/console/applications', label: 'Applications', icon: AppWindow },
      { href: '/console/api-resources', label: 'Resource servers', icon: Server },
      {
        href: '/console/webhooks/endpoints',
        label: 'Webhooks',
        icon: Webhook,
        activePaths: ['/console/webhooks'],
      },
    ],
  },
  {
    label: 'Authorization',
    items: [{ href: '/console/roles', label: 'Roles', icon: ShieldCheck }],
  },
  {
    label: 'Authentication',
    contexts: ['realm'],
    items: [
      { href: '/console/connectors', label: 'Identity providers', icon: Cable },
      {
        href: '/console/sign-in-experience/sign-in',
        label: 'Sign-in & registration',
        icon: Fingerprint,
        activePaths: ['/console/sign-in-experience/sign-in', '/console/sign-in-experience/sign-up-and-sign-in'],
      },
      {
        href: '/console/security/sign-in',
        label: 'Security policies',
        icon: Shield,
        activePaths: ['/console/security'],
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        href: '/console/sign-in-experience/theme',
        label: 'Experience',
        icon: Palette,
        contexts: ['realm'],
        activePaths: [
          '/console/sign-in-experience/theme',
          '/console/sign-in-experience/assets',
          '/console/sign-in-experience/legal',
          '/console/sign-in-experience/branding',
          '/console/sign-in-experience/content',
          '/console/sign-in-experience/account-center',
        ],
      },
      {
        href: '/console/tenant-settings/general',
        label: 'Settings',
        icon: Settings,
        contexts: ['realm'],
        activePaths: ['/console/tenant-settings'],
      },
    ],
  },
]

const consoleUtilities = [
  { href: '/api/openapi.json', label: 'Management API', icon: Code2 },
  { href: 'https://github.com/realmroot/realmroot/tree/main/docs', label: 'Help & documentation', icon: HelpCircle },
]

export function ConsoleShell({
  access,
  children,
  organizations,
  profile,
}: {
  access: DeveloperConsoleAccessResponse
  children: ReactNode
  organizations: OrganizationResponse[]
  profile: UserProfile
}) {
  const navigate = useNavigate()
  const { context: requestedContext } = useSearch({ from: '/console' })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [scope, setScope] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('context')
    if (requested && organizations.some((organization) => organization.id === requested)) return requested
    return access.realmOperator ? 'realm' : (organizations[0]?.id ?? 'realm')
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null)
  const context: ConsoleContext = scope === 'realm' ? 'realm' : 'organization'
  const groups = visibleGroups(context)

  useEffect(() => {
    if (requestedContext && organizations.some((organization) => organization.id === requestedContext)) {
      setScope(requestedContext)
      return
    }
    setScope(access.realmOperator ? 'realm' : (organizations[0]?.id ?? 'realm'))
  }, [access.realmOperator, organizations, requestedContext])

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])

  function changeScope(value: string) {
    setScope(value)
    void navigate({ replace: true, search: value === 'realm' ? {} : { context: value }, to: pathname })
  }

  function changeMobileNavigation(open: boolean) {
    setMobileNavOpen(open)
    if (!open) window.setTimeout(() => mobileNavTriggerRef.current?.focus(), 0)
  }

  async function signOutFromConsole() {
    await signOut()
    window.location.href = '/auth/sign-in'
  }

  return (
    <ConsoleScopeProvider
      value={{ organizationId: context === 'organization' ? scope : undefined, realmOperator: access.realmOperator }}
    >
      <div className="consoleShell text-foreground">
        <a className="skipLink" href="#console-content">
          {tt('Skip to content')}
        </a>
        <header className="consoleTopbar">
          <div className="consoleTopbarBrand">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? tt('Close navigation') : tt('Open navigation')}
                className="lg:hidden"
                onClick={() => setMobileNavOpen((open) => !open)}
                ref={mobileNavTriggerRef}
                size="icon"
                type="button"
                variant="ghost"
              >
                {mobileNavOpen ? <X /> : <Menu />}
              </Button>
              <Link
                aria-label={tt('Realmroot Console home')}
                search={scope === 'realm' ? {} : { context: scope }}
                to="/console"
              >
                <RealmrootWordmark context={tt('Console')} />
              </Link>
            </div>
          </div>
          <div className="consoleTopbarActions">
            <Button
              aria-label={tt('Search Console')}
              className="consoleSearchTrigger"
              onClick={() => setSearchOpen(true)}
              variant="outline"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Search />
                <span className="truncate">{tt('Search Console')}</span>
              </span>
              <kbd>⌘K</kbd>
            </Button>
            <ProductAccountMenu
              onSignOut={() => void signOutFromConsole()}
              primaryAction={{ icon: UserRound, label: 'Account Center', to: '/profile' }}
              profile={profile}
            />
          </div>
        </header>
        <Sheet onOpenChange={changeMobileNavigation} open={mobileNavOpen}>
          <SheetContent
            className="w-[min(292px,calc(100vw-32px))] gap-0 bg-sidebar p-0 lg:hidden"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              mobileNavTriggerRef.current?.focus()
            }}
            side="left"
          >
            <SheetTitle className="sr-only">{tt('Console navigation')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('Navigate Realmroot Console')}</SheetDescription>
            <div className="flex h-16 shrink-0 items-center border-b px-4">
              <RealmrootWordmark context={tt('Console')} />
            </div>
            <aside className="flex min-h-0 flex-1 flex-col">
              <ConsoleOrganizationSwitcher
                access={access}
                onScopeChange={changeScope}
                organizations={organizations}
                scope={scope}
              />
              <ConsoleNavigation
                groups={groups}
                onNavigate={() => setMobileNavOpen(false)}
                pathname={pathname}
                scope={scope}
              />
            </aside>
          </SheetContent>
        </Sheet>
        <div className="consoleBody lg:flex">
          <aside className="consoleRail hidden lg:flex">
            <ConsoleOrganizationSwitcher
              access={access}
              onScopeChange={changeScope}
              organizations={organizations}
              scope={scope}
            />
            <ConsoleNavigation groups={groups} pathname={pathname} scope={scope} />
          </aside>
          <main className="consoleMain" id="console-content" tabIndex={-1}>
            <div className="consoleContent">
              <ConsoleBreadcrumbs context={context} organizations={organizations} pathname={pathname} scope={scope} />
              <div className="consolePage">{children}</div>
            </div>
          </main>
        </div>
        {searchOpen ? <ConsoleSearch groups={groups} onOpenChange={setSearchOpen} open scope={scope} /> : null}
      </div>
    </ConsoleScopeProvider>
  )
}

function ConsoleOrganizationSwitcher({
  access,
  onScopeChange,
  organizations,
  scope,
}: {
  access: DeveloperConsoleAccessResponse
  onScopeChange: (scope: string) => void
  organizations: OrganizationResponse[]
  scope: string
}) {
  const organization = organizations.find((candidate) => candidate.id === scope)
  const currentName = organization?.displayName ?? organization?.name ?? tt('All organizations')

  return (
    <div className="consoleOrganizationSwitcher">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={tt('Switch organization')} className="consoleOrganizationTrigger" variant="ghost">
            <span className="consoleOrganizationIcon" aria-hidden="true">
              {scope === 'realm' ? <Globe2 /> : <Building2 />}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="consoleOrganizationLabel">{tt('Organization')}</span>
              <span className="consoleOrganizationName">{currentName}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="consoleOrganizationChevron" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64" sideOffset={6}>
          <DropdownMenuLabel>{tt('Switch organization')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={onScopeChange} value={scope}>
            {access.realmOperator ? (
              <DropdownMenuRadioItem className="consoleOrganizationOption" value="realm">
                <Globe2 />
                <span>
                  <strong>{tt('All organizations')}</strong>
                  <small>{tt('Realm-wide administration')}</small>
                </span>
              </DropdownMenuRadioItem>
            ) : null}
            {access.realmOperator && organizations.length > 0 ? <DropdownMenuSeparator /> : null}
            {organizations.map((item) => (
              <DropdownMenuRadioItem className="consoleOrganizationOption" key={item.id} value={item.id}>
                <Building2 />
                <span>
                  <strong>{item.displayName ?? item.name}</strong>
                  <small>{item.slug}</small>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ConsoleBreadcrumbs({
  context,
  organizations,
  pathname,
  scope,
}: {
  context: ConsoleContext
  organizations: OrganizationResponse[]
  pathname: string
  scope: string
}) {
  const contextName =
    context === 'realm'
      ? tt('Realm')
      : (organizations.find((organization) => organization.id === scope)?.displayName ??
        organizations.find((organization) => organization.id === scope)?.name ??
        tt('Organization'))
  const crumbs = consoleBreadcrumbSection(pathname)

  return (
    <nav aria-label={tt('Breadcrumb')} className="consoleBreadcrumbs">
      <Link search={scope === 'realm' ? {} : { context: scope }} to="/console">
        {contextName}
      </Link>
      {crumbs.map((crumb, index) => (
        <span className="contents" key={crumb.label}>
          <span aria-hidden="true">/</span>
          {crumb.href ? (
            <Link search={scope === 'realm' ? {} : { context: scope }} to={crumb.href}>
              {tt(crumb.label)}
            </Link>
          ) : (
            <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{tt(crumb.label)}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function consoleBreadcrumbSection(pathname: string): Array<{ href?: string; label: string }> {
  if (pathname === '/console' || pathname === '/console/dashboard') return [{ label: 'Dashboard' }]

  const route = consoleBreadcrumbRoutes.find(
    (candidate) => pathname === candidate.href || pathname.startsWith(`${candidate.href}/`),
  )
  if (!route) return [{ label: 'Console' }]

  const remainder = pathname.slice(route.href.length).split('/').filter(Boolean)
  const nested = remainder.length > 0
  return [
    { label: route.label, ...(nested ? { href: route.href } : {}) },
    ...(nested ? [{ label: breadcrumbSegmentLabel(route.href, remainder.at(-1) ?? '') }] : []),
  ]
}

const breadcrumbRouteSegmentLabels: Record<string, Record<string, string>> = {
  '/console/agents': {
    hosts: 'Installations',
    requests: 'Access requests',
    grants: 'Access grants',
  },
}

const breadcrumbSegmentLabels: Record<string, string> = {
  overview: 'Overview',
  profile: 'Overview',
  authentication: 'Authentication',
  'linked-accounts': 'Authentication',
  security: 'Authentication',
  sessions: 'Sessions',
  agents: 'Agents',
  'authorized-apps': 'Authorized apps',
  applications: 'Authorized apps',
  members: 'Members',
  activity: 'Activity',
  settings: 'Settings',
  operations: 'Settings',
  permissions: 'Permissions',
  assignments: 'Assignments',
  resources: 'Resources',
  authority: 'Roles & grants',
  oauth: 'OAuth',
  authorizations: 'Authorizations',
  roles: 'Roles',
  connections: 'Connections',
  theme: 'Color scheme',
  assets: 'Brand assets',
  legal: 'Legal & support',
  general: 'General',
  email: 'Email delivery',
  developer: 'Developer',
  deployment: 'Deployment',
  endpoints: 'Endpoints',
  requests: 'Requests',
  'sign-in': 'Sign-in security',
  mfa: 'MFA',
  abuse: 'Abuse prevention',
}

function breadcrumbSegmentLabel(route: string, segment: string) {
  return (
    breadcrumbRouteSegmentLabels[route]?.[segment] ??
    breadcrumbSegmentLabels[segment] ??
    segment
      .split('-')
      .filter(Boolean)
      .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
      .join(' ')
  )
}

const consoleBreadcrumbRoutes: Array<{ href: string; label: string }> = [
  { href: '/console/sign-in-experience/sign-up-and-sign-in', label: 'Sign-in & registration' },
  { href: '/console/sign-in-experience/sign-in', label: 'Sign-in & registration' },
  { href: '/console/sign-in-experience', label: 'Experience' },
  { href: '/console/tenant-settings', label: 'Settings' },
  { href: '/console/api-resources', label: 'Resource servers' },
  { href: '/console/webhooks', label: 'Webhooks' },
  { href: '/console/organizations', label: 'Organizations' },
  { href: '/console/applications', label: 'Applications' },
  { href: '/console/connectors', label: 'Identity providers' },
  { href: '/console/security', label: 'Security policies' },
  { href: '/console/users', label: 'Users' },
  { href: '/console/agents', label: 'Agents' },
  { href: '/console/roles', label: 'Roles' },
]

function ConsoleNavigation({
  groups,
  onNavigate,
  pathname,
  scope,
}: {
  groups: ConsoleNavGroup[]
  onNavigate?: () => void
  pathname: string
  scope: string
}) {
  return (
    <>
      <nav aria-label={tt('Console')} className="consoleNavScroll min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="grid gap-4">
          {groups.map((group, index) => (
            <div className="grid gap-1" key={group.label ?? index}>
              {group.label ? <p className="consoleNavGroupLabel">{tt(group.label)}</p> : null}
              {group.items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn('consoleNavItem', active && 'is-active')}
                    key={item.href}
                    onClick={onNavigate}
                    search={scope === 'realm' ? {} : { context: scope }}
                    to={item.href}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{tt(item.label)}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </nav>
      <div className="consoleNavFooter">
        {consoleUtilities.map((item) => (
          <a
            className="consoleNavItem"
            href={item.href}
            key={item.label}
            rel="noreferrer"
            target={item.href.startsWith('http') ? '_blank' : undefined}
          >
            <item.icon aria-hidden="true" />
            <span>{tt(item.label)}</span>
          </a>
        ))}
      </div>
    </>
  )
}

function ConsoleSearch({
  groups,
  onOpenChange,
  open,
  scope,
}: {
  groups: ConsoleNavGroup[]
  onOpenChange: (open: boolean) => void
  open: boolean
  scope: string
}) {
  const navigate = useNavigate()
  return (
    <CommandDialog
      description={tt('Search Console pages and settings.')}
      onOpenChange={onOpenChange}
      open={open}
      title={tt('Search Console')}
    >
      <Command>
        <CommandInput placeholder={tt('Search Console…')} />
        <CommandList>
          <CommandEmpty>{tt('No matching pages.')}</CommandEmpty>
          {groups.map((group, index) => (
            <CommandGroup heading={group.label ? tt(group.label) : tt('General')} key={group.label ?? index}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.href}
                  onSelect={() => {
                    onOpenChange(false)
                    void navigate({ search: scope === 'realm' ? {} : { context: scope }, to: item.href })
                  }}
                  value={item.label}
                >
                  <item.icon />
                  {tt(item.label)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function visibleGroups(context: ConsoleContext) {
  return consoleNavGroups
    .filter((group) => !group.contexts || group.contexts.includes(context))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.contexts || item.contexts.includes(context)),
    }))
    .filter((group) => group.items.length > 0)
}

function isActive(pathname: string, item: ConsoleNavItem) {
  const activePaths = item.activePaths ?? [item.href]
  return activePaths.some((path) => pathname === path || (path !== '/console' && pathname.startsWith(`${path}/`)))
}
