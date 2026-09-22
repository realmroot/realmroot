import './account-redesign.css'
import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { SiteNavigation } from '@shared/api/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AppWindow,
  ArrowUpRight,
  BookOpen,
  Bot,
  Building2,
  Database,
  Folder,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Menu,
  UserRound,
  Wallet,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { toast } from 'sonner'
import { brandingStyle } from '@/components/layout/auth-layout'
import { ProductAccountMenu } from '@/components/product-account-menu'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Status } from '@/components/ui/status'
import { signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { OrganizationWorkspaceNavigation } from './organization-workspace-navigation'
import type { AccountCenterSection, defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

type AccountCenterSettings = typeof defaultAccountCenterSettings

const accountNavigation = [
  { section: 'overview', href: '/', label: 'Workbench', icon: LayoutDashboard },
  { section: 'agents', href: '/agents', label: 'Agents', icon: Bot },
  { section: 'applications', href: '/applications', label: 'Access management', icon: Link2 },
  { section: 'profile', href: '/profile', label: 'Account settings', icon: UserRound },
  { section: 'data-privacy', href: '/data-privacy', label: 'Data & privacy', icon: Database },
] as const

export function AccountPageShell({
  access,
  accountCenter,
  children,
  config,
  organizationId,
  pathname = window.location.pathname,
  profile,
  section,
}: {
  access: DeveloperConsoleAccessResponse
  accountCenter: AccountCenterSettings
  children: ReactNode
  config: Parameters<typeof brandingStyle>[0]
  organizationId?: string
  pathname?: string
  profile: UserProfile
  section: AccountCenterSection
}) {
  void accountCenter
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationTriggerRef = useRef<HTMLButtonElement>(null)
  const productName = organizationId ? 'Developer Center' : 'Account Center'

  function changeNavigation(open: boolean) {
    setNavigationOpen(open)
    if (!open) window.setTimeout(() => navigationTriggerRef.current?.focus(), 0)
  }

  async function signOutFromAccount() {
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
    <main className={cn('accountShell', !organizationId && 'accountRedesign')} style={brandingStyle(config)}>
      <a className="skipLink" href="#account-content">
        {tt('Skip to content')}
      </a>
      <header className="accountProductTopbar">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            aria-expanded={navigationOpen}
            aria-label={tt(organizationId ? 'Open Developer Center navigation' : 'Open Account Center navigation')}
            className="accountMobileMenu"
            onClick={() => setNavigationOpen(true)}
            ref={navigationTriggerRef}
            size="icon"
            variant="ghost"
          >
            <Menu />
          </Button>
          {organizationId ? (
            <Link
              aria-label={tt('Developer Center home')}
              params={{ organizationId }}
              to="/organizations/$organizationId/overview"
            >
              <RealmrootWordmark context={tt(productName)} />
            </Link>
          ) : (
            <Link aria-label={tt('Account Center home')} to="/">
              <span className="accountBreadcrumb">
                {tt('Account Center')} <span aria-hidden="true">›</span>{' '}
                {tt(
                  accountNavigation.find(
                    (item) =>
                      item.section ===
                      (section === 'security' ? 'profile' : section === 'connections' ? 'applications' : section),
                  )?.label ?? 'Developer Center',
                )}
              </span>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            aria-label={tt('Help & documentation')}
            className="hidden sm:inline-flex"
            size="icon"
            variant="ghost"
          >
            <a href="https://github.com/realmroot/realmroot/tree/main/docs" rel="noreferrer" target="_blank">
              <HelpCircle />
            </a>
          </Button>
          <ProductAccountMenu
            onSignOut={() => void signOutFromAccount()}
            primaryAction={
              access.platformOperator ? { icon: LayoutDashboard, label: 'Console', to: '/console' } : undefined
            }
            profile={profile}
          />
        </div>
      </header>
      <div className="accountShellLayout">
        {organizationId ? (
          <OrganizationWorkspaceNavigation organizationId={organizationId} pathname={pathname} />
        ) : (
          <AccountSidebar
            access={access}
            externalLinks={config?.navigation?.externalLinks ?? []}
            profile={profile}
            section={section}
          />
        )}
        <section
          className={cn(
            'accountContent',
            (section === 'profile' || section === 'security' || section === 'data-privacy') && 'is-settings',
            organizationId && 'is-workspace',
          )}
          id="account-content"
          tabIndex={-1}
        >
          {children}
        </section>
      </div>
      <Sheet onOpenChange={changeNavigation} open={navigationOpen}>
        <SheetContent
          className="accountMobileNavSheet w-72 p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            navigationTriggerRef.current?.focus()
          }}
          side="left"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{tt(productName)}</SheetTitle>
            <SheetDescription className="sr-only">
              {tt(organizationId ? 'Navigate Developer Center pages.' : 'Navigate Account Center pages.')}
            </SheetDescription>
          </SheetHeader>
          {organizationId ? (
            <OrganizationWorkspaceNavigation
              onNavigate={() => setNavigationOpen(false)}
              organizationId={organizationId}
              pathname={pathname}
            />
          ) : (
            <AccountSidebar
              access={access}
              externalLinks={config?.navigation?.externalLinks ?? []}
              onNavigate={() => setNavigationOpen(false)}
              profile={profile}
              section={section}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  )
}

export function AccountPageLoading({ config }: { config: Parameters<typeof brandingStyle>[0] }) {
  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <header className="accountProductTopbar">
        <RealmrootWordmark context={tt('Account Center')} />
      </header>
      <section className="accountStandaloneState">
        <Status>
          <LoaderCircle className="spin" size={18} />
          {tt('Loading account center')}
        </Status>
      </section>
    </main>
  )
}

export function AccountPageError({
  config,
  message,
}: {
  config: Parameters<typeof brandingStyle>[0]
  message: string
}) {
  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <header className="accountProductTopbar">
        <RealmrootWordmark context={tt('Account Center')} />
      </header>
      <section className="accountStandaloneState">
        <Status tone="error">{message}</Status>
      </section>
    </main>
  )
}

const externalLinkIcons = { wallet: Wallet, app: AppWindow, link: Link2, book: BookOpen, folder: Folder }

function AccountSidebar({
  access,
  externalLinks,
  onNavigate,
  profile,
  section,
}: {
  access: DeveloperConsoleAccessResponse
  externalLinks: SiteNavigation['externalLinks']
  onNavigate?: () => void
  profile: UserProfile
  section: AccountCenterSection
}) {
  void profile
  const activeSection = section === 'security' ? 'profile' : section === 'connections' ? 'applications' : section
  const organizationId = access.consoleOrganizations[0]?.organizationId
  return (
    <aside className="accountSidebar">
      <Link className="accountSidebarBrand" aria-label={tt('Account Center home')} to="/">
        <RealmrootWordmark />
      </Link>
      <nav aria-label={tt('Account Center')} className="accountNav">
        {accountNavigation.map((item) => (
          <Link
            key={item.section}
            to={item.href}
            onClick={onNavigate}
            aria-current={activeSection === item.section ? 'page' : undefined}
            className={cn('accountNavItem', activeSection === item.section && 'is-active')}
          >
            <item.icon aria-hidden="true" />
            <span>{tt(item.label)}</span>
          </Link>
        ))}
        {externalLinks.length > 0 ? (
          <div className="accountNavGroup">
            <p>{tt('More services')}</p>
            {externalLinks.map((link) => {
              const Icon = externalLinkIcons[link.icon]
              return (
                <a className="accountNavItem" href={link.url} key={link.id} onClick={onNavigate}>
                  <Icon aria-hidden="true" />
                  <span>{link.label}</span>
                  <ArrowUpRight aria-hidden="true" className="ml-auto size-3" />
                </a>
              )
            })}
          </div>
        ) : null}
      </nav>
      {access.showOrganizations || access.canCreateOrganization ? (
        <div className="accountDeveloperEntry">
          {organizationId ? (
            <Link
              className="accountNavItem"
              onClick={onNavigate}
              to="/organizations/$organizationId/overview"
              params={{ organizationId }}
            >
              <Building2 />
              <span>{tt('Developer Center')}</span>
            </Link>
          ) : (
            <Link className="accountNavItem" onClick={onNavigate} to="/organizations">
              <Building2 />
              <span>{tt('Developer Center')}</span>
            </Link>
          )}
        </div>
      ) : null}
    </aside>
  )
}
