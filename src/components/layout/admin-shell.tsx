import { Link, useRouterState } from '@tanstack/react-router'
import {
  AppWindow,
  Building2,
  Cable,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Palette,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const adminNavItems = [
  { href: '/admin', label: 'Dashboard', icon: Gauge },
  { href: '/admin/applications', label: 'Applications', icon: AppWindow },
  { href: '/admin/users', label: 'Users', icon: UsersRound },
  { href: '/admin/connectors', label: 'Connectors', icon: Cable },
  { href: '/admin/sign-in', label: 'Sign-in settings', icon: Fingerprint },
  { href: '/admin/security', label: 'Security', icon: ShieldCheck },
  { href: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/admin/roles', label: 'Roles', icon: LockKeyhole },
  { href: '/admin/api-resources', label: 'API resources', icon: KeyRound },
  { href: '/admin/branding', label: 'Branding', icon: Palette },
  { href: '/admin/deployment', label: 'Deployment', icon: ShieldCheck },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <div className="min-h-dvh bg-muted/35 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-background lg:block">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            F
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">FlareAuth</p>
            <p className="text-xs text-muted-foreground">Admin console</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label="Admin">
          {adminNavItems.map((item) => (
            <Link
              className={cn(
                'flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground',
                isActive(pathname, item.href) && 'bg-muted text-foreground',
              )}
              key={item.href}
              to={item.href}
            >
              <item.icon aria-hidden="true" data-icon="inline-start" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Admin console</p>
            <p className="text-xs text-muted-foreground">Manage tenant identity, access, and deployment controls.</p>
          </div>
          <a className="text-sm font-medium text-muted-foreground hover:text-foreground" href="/account">
            Account
          </a>
        </header>
        <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
