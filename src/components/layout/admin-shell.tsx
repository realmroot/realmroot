import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  AppWindow,
  BellRing,
  Boxes,
  Building2,
  Cable,
  ChevronRight,
  Code2,
  FileClock,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Menu,
  Network,
  Settings,
  Shield,
  ShieldCheck,
  UserCog,
  UsersRound,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

type ConsoleNavItem = {
  description: string
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
    items: [{ href: '/console', label: 'Dashboard', description: 'Tenant health', icon: Gauge }],
  },
  {
    label: 'Authentication',
    items: [
      { href: '/console/applications', label: 'Applications', description: 'OIDC clients', icon: AppWindow },
      {
        href: '/console/sign-in-experience/sign-up-and-sign-in',
        label: 'Sign-in & account',
        description: 'Hosted auth settings',
        icon: Fingerprint,
        match: '/console/sign-in-experience',
      },
      {
        href: '/console/mfa',
        label: 'Multi-factor auth',
        description: 'MFA posture',
        icon: ShieldCheck,
      },
      {
        href: '/console/connectors/passwordless',
        label: 'Connectors',
        description: 'Identity providers',
        icon: Cable,
        match: '/console/connectors',
      },
      {
        href: '/console/security/password-policy',
        label: 'Security',
        description: 'Password and session policy',
        icon: Shield,
        match: '/console/security',
      },
    ],
  },
  {
    label: 'Authorization',
    items: [
      { href: '/console/api-resources', label: 'API resources', description: 'Audiences and scopes', icon: KeyRound },
      { href: '/console/roles', label: 'Roles', description: 'RBAC definitions', icon: LockKeyhole },
      {
        href: '/console/organization-template/organization-roles',
        label: 'Organization template',
        description: 'Default org policy',
        icon: Network,
        match: '/console/organization-template',
      },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/console/organizations', label: 'Organizations', description: 'Tenant groups', icon: Building2 },
      { href: '/console/users', label: 'User management', description: 'Profiles and access', icon: UsersRound },
    ],
  },
  {
    label: 'Developer',
    items: [
      { href: '/console/customize-jwt', label: 'Custom JWT', description: 'Token claims', icon: Code2 },
      { href: '/console/webhooks', label: 'Webhooks', description: 'Event delivery', icon: BellRing },
      { href: '/console/audit-logs', label: 'Audit logs', description: 'Activity trail', icon: FileClock },
    ],
  },
  {
    label: 'Tenant',
    items: [
      {
        href: '/console/tenant-settings/oidc-configs',
        label: 'Settings',
        description: 'OIDC metadata',
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
    <div className="min-h-dvh bg-muted/60 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-border bg-background lg:flex lg:flex-col">
        <ConsoleBrand />
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Console">
          <AdminNavigation pathname={pathname} />
        </nav>
        <div className="border-t border-border p-4">
          <a
            className="flex min-h-12 items-center gap-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm font-semibold hover:bg-muted"
            href="/account"
          >
            <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs text-primary">AC</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">Account center</span>
              <span className="block truncate text-xs font-medium text-muted-foreground">Profile and sessions</span>
            </span>
          </a>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 lg:px-6">
            <button
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close console navigation' : 'Open console navigation'}
              className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-background lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              type="button"
            >
              {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span>Console</span>
                {currentGroup ? (
                  <>
                    <ChevronRight aria-hidden="true" className="size-3" />
                    <span>{currentGroup.label}</span>
                  </>
                ) : null}
              </div>
              <p className="truncate text-sm font-semibold">{currentItem?.label ?? 'Console'}</p>
            </div>
            <div className="hidden items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm lg:flex">
              <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium leading-none text-muted-foreground">Tenant</p>
                <p className="mt-1 font-semibold leading-none">Default</p>
              </div>
            </div>
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/account"
            >
              <UserCog data-icon="inline-start" />
              Account
            </a>
          </div>
          {mobileNavOpen ? (
            <div className="border-t border-border bg-background p-3 lg:hidden">
              <nav aria-label="Console mobile">
                <AdminNavigation onNavigate={() => setMobileNavOpen(false)} pathname={pathname} />
              </nav>
            </div>
          ) : null}
        </header>
        <main className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}

function ConsoleBrand() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-border px-4">
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        F
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-none">FlareAuth</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">Identity Console</p>
      </div>
      <Activity className="ml-auto size-4 text-primary" aria-hidden="true" />
    </div>
  )
}

function AdminNavigation({ onNavigate, pathname }: { onNavigate?: () => void; pathname: string }) {
  return (
    <div className="grid gap-5">
      {adminNavGroups.map((group) => (
        <div className="grid gap-1" key={group.label}>
          <p className="px-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground">{group.label}</p>
          {group.items.map((item) => {
            const active = isActive(pathname, getItemMatchPath(item))
            return (
              <Link
                className={cn(
                  'group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  active && 'bg-primary/10 text-primary',
                )}
                key={item.href}
                onClick={onNavigate}
                to={item.href}
              >
                <item.icon aria-hidden="true" data-icon="inline-start" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className="block truncate text-xs font-medium text-muted-foreground">{item.description}</span>
                </span>
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
  if (href === '/console') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
