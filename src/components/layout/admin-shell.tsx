import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  AppWindow,
  Boxes,
  Building2,
  Cable,
  ChevronRight,
  Cloud,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Menu,
  Palette,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

const adminNavGroups = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', description: 'Tenant health', icon: Gauge }],
  },
  {
    label: 'Identity',
    items: [
      { href: '/admin/users', label: 'Users', description: 'Profiles and access', icon: UsersRound },
      { href: '/admin/organizations', label: 'Organizations', description: 'Tenant groups', icon: Building2 },
    ],
  },
  {
    label: 'Applications',
    items: [
      { href: '/admin/applications', label: 'Applications', description: 'OIDC clients', icon: AppWindow },
      { href: '/admin/connectors', label: 'Connectors', description: 'Social and OAuth IdPs', icon: Cable },
    ],
  },
  {
    label: 'Authorization',
    items: [
      { href: '/admin/roles', label: 'Roles', description: 'RBAC definitions', icon: LockKeyhole },
      { href: '/admin/api-resources', label: 'API resources', description: 'Audiences and scopes', icon: KeyRound },
      { href: '/admin/security', label: 'Security', description: 'MFA, passkeys, sessions', icon: ShieldCheck },
    ],
  },
  {
    label: 'Experience',
    items: [
      {
        href: '/admin/sign-in',
        label: 'Sign-in experience',
        description: 'Identifiers and hosted auth',
        icon: Fingerprint,
      },
      { href: '/admin/branding', label: 'Branding', description: 'Hosted UI identity', icon: Palette },
    ],
  },
  {
    label: 'Operations',
    items: [{ href: '/admin/deployment', label: 'Deployment', description: 'Runtime and endpoints', icon: Cloud }],
  },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const currentItem = adminNavGroups.flatMap((group) => group.items).find((item) => isActive(pathname, item.href))
  const currentGroup = adminNavGroups.find((group) => group.items.some((item) => isActive(pathname, item.href)))

  return (
    <div className="min-h-dvh bg-muted/60 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-border bg-background lg:flex lg:flex-col">
        <ConsoleBrand />
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Admin">
          <AdminNavigation pathname={pathname} />
        </nav>
        <div className="border-t border-border p-4">
          <div className="rounded-lg border border-border bg-muted/35 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Activity data-icon="inline-start" />
              Production
            </div>
            <p className="mt-2 text-sm font-semibold">Default tenant</p>
            <p className="text-xs leading-5 text-muted-foreground">Cloudflare Workers deployment</p>
          </div>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 lg:px-6">
            <button
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close admin navigation' : 'Open admin navigation'}
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
                <p className="text-xs font-medium leading-none text-muted-foreground">Environment</p>
                <p className="mt-1 font-semibold leading-none">Production</p>
              </div>
            </div>
            <a
              className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/account"
            >
              Account
            </a>
          </div>
          {mobileNavOpen ? (
            <div className="border-t border-border bg-background p-3 lg:hidden">
              <nav aria-label="Admin mobile">
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
      <Sparkles className="ml-auto size-4 text-primary" aria-hidden="true" />
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
            const active = isActive(pathname, item.href)
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

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
