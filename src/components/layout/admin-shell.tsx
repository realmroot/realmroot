import { Link, useRouterState } from '@tanstack/react-router'
import {
  AppWindow,
  BellRing,
  Boxes,
  Building2,
  Cable,
  ChevronRight,
  Code2,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Menu,
  Network,
  Settings,
  Shield,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

type ConsoleNavItem = {
  href: string
  icon: typeof Gauge
  label: string
  match?: string
}

type ConsoleNavGroup = {
  items: ConsoleNavItem[]
  label: string
}

const adminNavGroups: ConsoleNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/console', label: 'Dashboard', icon: Gauge }],
  },
  {
    label: 'Authentication',
    items: [
      { href: '/console/applications', label: 'Applications', icon: AppWindow },
      {
        href: '/console/sign-in-experience/sign-up-and-sign-in',
        label: 'Sign-in & account',
        icon: Fingerprint,
        match: '/console/sign-in-experience',
      },
      {
        href: '/console/mfa',
        label: 'Multi-factor auth',
        icon: ShieldCheck,
      },
      {
        href: '/console/connectors/passwordless',
        label: 'Connectors',
        icon: Cable,
        match: '/console/connectors',
      },
      {
        href: '/console/security/password-policy',
        label: 'Security',
        icon: Shield,
        match: '/console/security',
      },
    ],
  },
  {
    label: 'Authorization',
    items: [
      { href: '/console/api-resources', label: 'API resources', icon: KeyRound },
      { href: '/console/roles', label: 'Roles', icon: LockKeyhole },
      {
        href: '/console/organization-template/organization-roles',
        label: 'Organization template',
        icon: Network,
        match: '/console/organization-template',
      },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/console/organizations', label: 'Organizations', icon: Building2 },
      { href: '/console/users', label: 'User management', icon: UsersRound },
    ],
  },
  {
    label: 'Developer',
    items: [
      { href: '/console/customize-jwt', label: 'Custom JWT', icon: Code2 },
      {
        href: '/console/webhooks/endpoints',
        label: 'Webhooks',
        icon: BellRing,
        match: '/console/webhooks',
      },
    ],
  },
  {
    label: 'Tenant',
    items: [
      {
        href: '/console/tenant-settings/oidc-configs',
        label: 'Settings',
        icon: Settings,
        match: '/console/tenant-settings',
      },
    ],
  },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const currentItem = adminNavGroups
    .flatMap((group) => group.items)
    .find((item) => isActive(pathname, getItemMatchPath(item)))
  const currentGroup = adminNavGroups.find((group) =>
    group.items.some((item) => isActive(pathname, getItemMatchPath(item))),
  )

  return (
    <div className="consoleShell text-foreground">
      <header className="consoleTopbar lg:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close console navigation' : 'Open console navigation'}
              className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              type="button"
            >
              {mobileNavOpen ? (
                <X aria-hidden="true" className="size-4" />
              ) : (
                <Menu aria-hidden="true" className="size-4" />
              )}
            </button>
            <ConsoleBrand />
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-2 px-2 text-sm text-muted-foreground md:flex">
            <span className="truncate">Console</span>
            {currentGroup ? (
              <>
                <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{currentGroup.label}</span>
              </>
            ) : null}
            {currentItem ? (
              <>
                <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate font-medium text-foreground">{currentItem.label}</span>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm lg:flex">
              <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Default</span>
            </div>
            <a
              aria-label="Open account center"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/account"
            >
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                AC
              </span>
              <span className="hidden sm:inline">Account</span>
            </a>
          </div>
        </div>
      </header>
      {mobileNavOpen ? (
        <div className="consoleMobileNavLayer lg:hidden">
          <button
            aria-label="Dismiss console navigation"
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setMobileNavOpen(false)}
            type="button"
          />
          <aside className="relative h-full w-[min(320px,calc(100vw-32px))] border-r border-border bg-background shadow-lg">
            <nav aria-label="Console mobile" className="h-full overflow-y-auto px-3 py-4">
              <AdminNavigation onNavigate={() => setMobileNavOpen(false)} pathname={pathname} />
            </nav>
          </aside>
        </div>
      ) : null}
      <div className="consoleBody lg:flex">
        <aside className="consoleRail hidden lg:flex">
          <div className="px-4 pb-4 pt-4">
            <ConsoleBrand />
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-label="Console">
            <AdminNavigation pathname={pathname} />
          </nav>
          <div className="border-t border-border/70 p-4">
            <a
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/account"
            >
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                AC
              </span>
              <span className="truncate">Account center</span>
            </a>
          </div>
        </aside>
        <main className="consoleMain">
          <div className="consoleContent">{children}</div>
        </main>
      </div>
    </div>
  )
}

function ConsoleBrand() {
  return (
    <a className="flex h-10 min-w-0 items-center gap-2.5 text-foreground" href="/console">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        F
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-none">FlareAuth</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">Console</p>
      </div>
    </a>
  )
}

function AdminNavigation({ onNavigate, pathname }: { onNavigate?: () => void; pathname: string }) {
  return (
    <div className="grid gap-3">
      {adminNavGroups.map((group) => (
        <div className="grid gap-1" key={group.label}>
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, getItemMatchPath(item))
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
                key={item.href}
                onClick={onNavigate}
                to={item.href}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function getItemMatchPath(item: ConsoleNavItem) {
  return item.match ?? item.href
}

function isActive(pathname: string, href: string) {
  if (href === '/console') return pathname === href || pathname === '/console/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}
