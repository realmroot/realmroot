import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  AppWindow,
  Bot,
  Building2,
  Cable,
  Code2,
  Fingerprint,
  Gauge,
  HelpCircle,
  Menu,
  Palette,
  Search,
  Server,
  Settings,
  Shield,
  UserRound,
  UsersRound,
  Webhook,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { UserProfile } from '@/features/account/types'
import { signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type ConsoleNavItem = {
  href: string
  icon: typeof Gauge
  label: string
  activePaths?: string[]
}

type ConsoleNavGroup = {
  items: ConsoleNavItem[]
  label?: string
}

const consoleNavGroups: ConsoleNavGroup[] = [
  {
    items: [{ href: '/console', label: 'Dashboard', icon: Gauge, activePaths: ['/console'] }],
  },
  {
    label: 'Identity',
    items: [
      { href: '/console/users', label: 'Users', icon: UsersRound },
      { href: '/console/agents', label: 'Agents', icon: Bot },
      { href: '/console/organizations', label: 'Organizations', icon: Building2 },
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
    label: 'Authentication',
    items: [
      { href: '/console/connectors', label: 'Identity providers', icon: Cable },
      {
        href: '/console/sign-in-experience/sign-in',
        label: 'Sign-in & registration',
        icon: Fingerprint,
        activePaths: ['/console/sign-in-experience/sign-in'],
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
        activePaths: [
          '/console/sign-in-experience/theme',
          '/console/sign-in-experience/assets',
          '/console/sign-in-experience/legal',
        ],
      },
      {
        href: '/console/tenant-settings/general',
        label: 'Settings',
        icon: Settings,
        activePaths: ['/console/tenant-settings'],
      },
    ],
  },
]

const consoleUtilities = [
  { href: '/api/docs', label: 'API Documentation', icon: Code2, target: '_blank' },
  {
    href: 'https://github.com/realmroot/realmroot/tree/main/docs',
    label: 'Help & documentation',
    icon: HelpCircle,
    target: '_blank',
  },
]

export function ConsoleShell({ children, profile }: { children: ReactNode; profile: UserProfile }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null)
  const groups = consoleNavGroups

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

  function changeMobileNavigation(open: boolean) {
    setMobileNavOpen(open)
    if (!open) window.setTimeout(() => mobileNavTriggerRef.current?.focus(), 0)
  }

  async function signOutFromConsole() {
    try {
      await signOut()
      queryClient.clear()
      toast.success(tt('Signed out'))
      await navigate({ to: '/auth/sign-in' })
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? tt(mutationError.message) : tt('Account update failed.'))
    }
  }

  return (
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
            <Link aria-label={tt('Realmroot Console home')} to="/console">
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
            <ConsoleNavigation groups={groups} onNavigate={() => setMobileNavOpen(false)} pathname={pathname} />
          </aside>
        </SheetContent>
      </Sheet>
      <div className="consoleBody lg:flex">
        <aside className="consoleRail hidden lg:flex">
          <ConsoleNavigation groups={groups} pathname={pathname} />
        </aside>
        <main className="consoleMain" id="console-content" tabIndex={-1}>
          <div className="consoleContent">
            <ConsoleBreadcrumbs pathname={pathname} />
            <div className="consolePage">{children}</div>
          </div>
        </main>
      </div>
      {searchOpen ? <ConsoleSearch groups={groups} onOpenChange={setSearchOpen} open /> : null}
    </div>
  )
}
function ConsoleBreadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = consoleBreadcrumbSection(pathname)

  return (
    <nav aria-label={tt('Breadcrumb')} className="consoleBreadcrumbs">
      <Link to="/console">{tt('Realm')}</Link>
      {crumbs.map((crumb, index) => (
        <span className="contents" key={crumb.label}>
          <span aria-hidden="true">/</span>
          {crumb.href ? (
            <Link to={crumb.href}>{tt(crumb.label)}</Link>
          ) : (
            <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{tt(crumb.label)}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function consoleBreadcrumbSection(pathname: string): Array<{ href?: string; label: string }> {
  if (pathname === '/console') return [{ label: 'Dashboard' }]

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
    grants: 'Resource access',
  },
}

const breadcrumbSegmentLabels: Record<string, string> = {
  overview: 'Overview',
  authentication: 'Authentication',
  sessions: 'Sessions',
  agents: 'Agents',
  'authorized-apps': 'Authorized apps',
  applications: 'Authorized apps',
  members: 'Members',
  activity: 'Activity',
  settings: 'Settings',
  permissions: 'Permissions',
  assignments: 'Assignments',
  scopes: 'Scopes',
  oauth: 'OAuth',
  authorizations: 'User authorizations',
  roles: 'Roles',
  connections: 'Connections',
  theme: 'Color scheme',
  assets: 'Brand assets',
  legal: 'Legal & support',
  general: 'General',
  'external-services': 'External services',
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
]

function ConsoleNavigation({
  groups,
  onNavigate,
  pathname,
}: {
  groups: ConsoleNavGroup[]
  onNavigate?: () => void
  pathname: string
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
          <a className="consoleNavItem" href={item.href} key={item.label} rel="noreferrer" target={item.target}>
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
}: {
  groups: ConsoleNavGroup[]
  onOpenChange: (open: boolean) => void
  open: boolean
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
                    void navigate({ to: item.href })
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

function isActive(pathname: string, item: ConsoleNavItem) {
  const activePaths = item.activePaths ?? [item.href]
  return activePaths.some((path) => pathname === path || (path !== '/console' && pathname.startsWith(`${path}/`)))
}
