import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider, redirect } from '@tanstack/react-router'
import { AdminShell } from '@/components/layout/admin-shell'
import {
  AccountCenterSettingsPage,
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourceDetailPage,
  ApiResourcesPage,
  ApplicationDetailPage,
  ApplicationsPage,
  BrandingPage,
  ConnectorsPage,
  ContentSettingsPage,
  CustomizeJwtPage,
  DeploymentSettingsPage,
  MfaPage,
  OrganizationDetailPage,
  OrganizationsPage,
  OrganizationTemplatePage,
  PasswordlessConnectorsPage,
  RoleDetailPage,
  RolesPage,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityGeneralPage,
  SecurityPasswordPolicyPage,
  SignInSettingsPage,
  UserDetailPage,
  UsersPage,
  WebhooksPage,
} from '@/features/admin/admin-console'
import { ApiRequestError, getConfigz } from '@/lib/api'
import { getAccountProfile } from '@/lib/api/account'
import { adminQueryKeys, getAdminReadiness, getSignInSettings } from '@/lib/api/management'
import { AccountRoute } from '@/routes/account'
import { AuthCallbackRoute } from '@/routes/auth-callback'
import { EmailVerificationRoute } from '@/routes/email-verification'
import { ForgotPasswordRoute } from '@/routes/forgot-password'
import { OAuthConsentRoute } from '@/routes/oauth/consent'
import { OidcCallbackRoute, OidcStartRoute } from '@/routes/oidc-callback'
import { OnboardingRoute } from '@/routes/onboarding'
import { SignInRoute } from '@/routes/sign-in'
import { SignUpRoute } from '@/routes/sign-up'

export const queryClient = new QueryClient()

const rootRoute = createRootRoute({
  beforeLoad: async ({ location }) => {
    const config = await queryClient.fetchQuery({ queryKey: ['configz'], queryFn: getConfigz })
    if (config.onboarding.required && location.pathname !== '/onboarding') {
      throw redirect({ to: '/onboarding' })
    }
    if (!config.onboarding.required && location.pathname === '/onboarding') {
      throw redirect({ to: '/console/onboarding' })
    }
  },
  component: () => <Outlet />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    await loadAccountAccess()
    throw redirect({ to: '/profile' })
  },
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInRoute,
})

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: SignUpRoute,
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordRoute,
})

const emailVerificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/email-verification',
  component: EmailVerificationRoute,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackRoute,
})

const oauthConsentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/consent',
  component: OAuthConsentRoute,
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingRoute,
})

const oidcCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oidc/callback',
  component: OidcCallbackRoute,
})

const oidcStartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oidc/start',
  component: OidcStartRoute,
})

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
  component: () => <Outlet />,
})

const accountIndexRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/',
  component: AccountRoute,
})

const accountProfileRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/profile',
})

const accountSecurityRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/security',
})

const accountLinkedAccountsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/linked-accounts',
})

const accountSessionsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/sessions',
})

const accountAuthorizedAppsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/authorized-apps',
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  beforeLoad: async ({ location }) => loadAccountAccess(location.href),
  component: AccountRoute,
})

const profileSecurityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile/security',
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})

const profileLinkedAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile/linked-accounts',
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})

const profileSessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile/sessions',
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})

const profileAuthorizedAppsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile/authorized-apps',
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console',
  beforeLoad: ({ location }) => loadConsoleAccess(location),
  component: () => (
    <AdminShell>
      <Outlet />
    </AdminShell>
  ),
})

const consoleIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/',
  component: AdminDashboardPage,
})

const consoleDashboardRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: 'dashboard',
  component: AdminDashboardPage,
})

const consoleApplicationsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/applications',
  component: ApplicationsPage,
})

const consoleApplicationDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/applications/{$applicationId}',
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/applications/${params.applicationId}/settings` })
  },
})

const consoleApplicationDetailSettingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/applications/{$applicationId}/settings',
  component: () => {
    const params = consoleApplicationDetailSettingsRoute.useParams()
    return <ApplicationDetailPage applicationId={params.applicationId} section="settings" />
  },
})

const consoleApplicationDetailBrandingRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/applications/{$applicationId}/branding',
  component: () => {
    const params = consoleApplicationDetailBrandingRoute.useParams()
    return <ApplicationDetailPage applicationId={params.applicationId} section="branding" />
  },
})

const consoleUsersRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users',
  component: UsersPage,
})

const consoleUserDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}',
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/users/${params.userId}/profile` })
  },
})

const consoleUserDetailProfileRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/profile',
  component: () => {
    const params = consoleUserDetailProfileRoute.useParams()
    return <UserDetailPage userId={params.userId} section="profile" />
  },
})

const consoleUserDetailSecurityRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/security',
  component: () => {
    const params = consoleUserDetailSecurityRoute.useParams()
    return <UserDetailPage userId={params.userId} section="security" />
  },
})

const consoleUserDetailSessionsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/sessions',
  component: () => {
    const params = consoleUserDetailSessionsRoute.useParams()
    return <UserDetailPage userId={params.userId} section="sessions" />
  },
})

const consoleUserDetailLinkedAccountsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/linked-accounts',
  component: () => {
    const params = consoleUserDetailLinkedAccountsRoute.useParams()
    return <UserDetailPage userId={params.userId} section="linked-accounts" />
  },
})

const consoleUserDetailApplicationsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/applications',
  component: () => {
    const params = consoleUserDetailApplicationsRoute.useParams()
    return <UserDetailPage userId={params.userId} section="applications" />
  },
})

const consoleUserDetailOperationsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/users/{$userId}/operations',
  component: () => {
    const params = consoleUserDetailOperationsRoute.useParams()
    return <UserDetailPage userId={params.userId} section="operations" />
  },
})

const consoleConnectorsIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/connectors',
  beforeLoad: () => {
    throw redirect({ to: '/console/connectors/passwordless' })
  },
})

const consoleConnectorsPasswordlessRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/connectors/passwordless',
  component: PasswordlessConnectorsPage,
})

const consoleConnectorsSocialRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/connectors/social',
  component: ConnectorsPage,
})

const consoleSignInExperienceIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience',
  beforeLoad: () => {
    throw redirect({ to: '/console/sign-in-experience/sign-up-and-sign-in' })
  },
})

const consoleSignInSignUpAndSignInRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/sign-up-and-sign-in',
  component: SignInSettingsPage,
})

const consoleSignInExperienceDesktopCompatibilityRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/desktop',
  beforeLoad: () => {
    throw redirect({ to: '/console/sign-in-experience/sign-up-and-sign-in' })
  },
})

const consoleSignInExperienceMobileCompatibilityRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/mobile',
  beforeLoad: () => {
    throw redirect({ to: '/console/sign-in-experience/sign-up-and-sign-in' })
  },
})

const consoleSignInBrandingRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/branding',
  component: BrandingPage,
})

const consoleSignInCollectUserProfileRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/collect-user-profile',
  beforeLoad: () => {
    throw redirect({ to: '/console/sign-in-experience/sign-up-and-sign-in' })
  },
})

const consoleSignInAccountCenterRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/account-center',
  component: AccountCenterSettingsPage,
})

const consoleSignInContentRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/sign-in-experience/content',
  component: ContentSettingsPage,
})

const consoleMultiFactorAuthRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/mfa',
  component: MfaPage,
})

const consoleSecurityIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/security',
  beforeLoad: () => {
    throw redirect({ to: '/console/security/password-policy' })
  },
})

const consoleSecurityPasswordPolicyRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/security/password-policy',
  component: SecurityPasswordPolicyPage,
})

const consoleSecurityCaptchaRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/security/captcha',
  component: SecurityCaptchaPage,
})

const consoleSecurityBlocklistRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/security/blocklist',
  component: SecurityBlocklistPage,
})

const consoleSecurityGeneralRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/security/general',
  component: SecurityGeneralPage,
})

const consoleOrganizationsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organizations',
  component: OrganizationsPage,
})

const consoleOrganizationDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organizations/{$organizationId}',
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/organizations/${params.organizationId}/settings` })
  },
})

const consoleOrganizationDetailSettingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organizations/{$organizationId}/settings',
  component: () => {
    const params = consoleOrganizationDetailSettingsRoute.useParams()
    return <OrganizationDetailPage organizationId={params.organizationId} section="settings" />
  },
})

const consoleOrganizationDetailAuthorizationRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organizations/{$organizationId}/authorization',
  component: () => {
    const params = consoleOrganizationDetailAuthorizationRoute.useParams()
    return <OrganizationDetailPage organizationId={params.organizationId} section="authorization" />
  },
})

const consoleRolesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/roles',
  component: RolesPage,
})

const consoleRoleDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/roles/{$roleId}',
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/roles/${params.roleId}/settings` })
  },
})

const consoleRoleDetailSettingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/roles/{$roleId}/settings',
  component: () => {
    const params = consoleRoleDetailSettingsRoute.useParams()
    return <RoleDetailPage roleId={params.roleId} section="settings" />
  },
})

const consoleRoleDetailPermissionsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/roles/{$roleId}/permissions',
  component: () => {
    const params = consoleRoleDetailPermissionsRoute.useParams()
    return <RoleDetailPage roleId={params.roleId} section="permissions" />
  },
})

const consoleRoleDetailAssignmentsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/roles/{$roleId}/assignments',
  component: () => {
    const params = consoleRoleDetailAssignmentsRoute.useParams()
    return <RoleDetailPage roleId={params.roleId} section="assignments" />
  },
})

const consoleApiResourcesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/api-resources',
  component: ApiResourcesPage,
})

const consoleApiResourceDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/api-resources/{$resourceId}',
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/console/api-resources/${params.resourceId}/settings` })
  },
})

const consoleApiResourceDetailSettingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/api-resources/{$resourceId}/settings',
  component: () => {
    const params = consoleApiResourceDetailSettingsRoute.useParams()
    return <ApiResourceDetailPage resourceId={params.resourceId} section="settings" />
  },
})

const consoleApiResourceDetailScopesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/api-resources/{$resourceId}/scopes',
  component: () => {
    const params = consoleApiResourceDetailScopesRoute.useParams()
    return <ApiResourceDetailPage resourceId={params.resourceId} section="scopes" />
  },
})

const consoleApiResourceDetailPermissionsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/api-resources/{$resourceId}/permissions',
  component: () => {
    const params = consoleApiResourceDetailPermissionsRoute.useParams()
    return <ApiResourceDetailPage resourceId={params.resourceId} section="permissions" />
  },
})

const consoleOrganizationTemplateIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organization-template',
  beforeLoad: () => {
    throw redirect({ to: '/console/organization-template/organization-roles' })
  },
})

const consoleOrganizationTemplateRolesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organization-template/organization-roles',
  component: () => <OrganizationTemplatePage section="organization-roles" />,
})

const consoleOrganizationTemplatePermissionsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/organization-template/organization-permissions',
  component: () => <OrganizationTemplatePage section="organization-permissions" />,
})

const consoleCustomJwtRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/customize-jwt',
  component: CustomizeJwtPage,
})

const consoleWebhooksRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/webhooks',
  beforeLoad: () => {
    throw redirect({ href: '/console/webhooks/endpoints' })
  },
})

const consoleWebhooksEndpointsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/webhooks/endpoints',
  component: () => <WebhooksPage section="endpoints" />,
})

const consoleWebhooksRequestsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/webhooks/requests',
  component: () => <WebhooksPage section="requests" />,
})

const consoleTenantSettingsIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/tenant-settings',
  beforeLoad: () => {
    throw redirect({ to: '/console/tenant-settings/oidc-configs' })
  },
})

const consoleTenantSettingsOidcRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/tenant-settings/oidc-configs',
  component: DeploymentSettingsPage,
})

const consoleOnboardingRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/onboarding',
  beforeLoad: async () => {
    const readiness = await loadAdminReadiness()
    if (!readiness.admin.setupRequired) {
      throw redirect({ to: '/console' })
    }
  },
  component: AdminOnboardingPage,
})

const adminCompatibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: ({ location }) => {
    throw redirect({ href: consoleHrefForAdminLocation(location) })
  },
})

const adminCompatibilityIndexRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/',
})

const adminCompatibilityApplicationsRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/applications',
})

const adminCompatibilityApplicationDetailRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/applications/{$applicationId}',
})

const adminCompatibilityUsersRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/users',
})

const adminCompatibilityUserDetailRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/users/{$userId}',
})

const adminCompatibilityConnectorsRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/connectors',
})

const adminCompatibilitySignInRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/sign-in',
})

const adminCompatibilitySecurityRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/security',
})

const adminCompatibilityOrganizationsRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/organizations',
})

const adminCompatibilityRolesRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/roles',
})

const adminCompatibilityRoleDetailRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/roles/{$roleId}',
})

const adminCompatibilityApiResourcesRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/api-resources',
})

const adminCompatibilityApiResourceDetailRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/api-resources/{$resourceId}',
})

const adminCompatibilityBrandingRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/branding',
})

const adminCompatibilityDeploymentRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/deployment',
})

const adminCompatibilityOnboardingRoute = createRoute({
  getParentRoute: () => adminCompatibilityRoute,
  path: '/onboarding',
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  oidcStartRoute,
  oidcCallbackRoute,
  signInRoute,
  signUpRoute,
  forgotPasswordRoute,
  emailVerificationRoute,
  authCallbackRoute,
  oauthConsentRoute,
  profileRoute,
  profileSecurityRoute,
  profileLinkedAccountsRoute,
  profileSessionsRoute,
  profileAuthorizedAppsRoute,
  accountRoute.addChildren([
    accountIndexRoute,
    accountProfileRoute,
    accountSecurityRoute,
    accountLinkedAccountsRoute,
    accountSessionsRoute,
    accountAuthorizedAppsRoute,
  ]),
  consoleRoute.addChildren([
    consoleIndexRoute,
    consoleDashboardRoute,
    consoleApplicationsRoute,
    consoleApplicationDetailRoute,
    consoleApplicationDetailSettingsRoute,
    consoleApplicationDetailBrandingRoute,
    consoleUsersRoute,
    consoleUserDetailRoute,
    consoleUserDetailProfileRoute,
    consoleUserDetailSecurityRoute,
    consoleUserDetailSessionsRoute,
    consoleUserDetailLinkedAccountsRoute,
    consoleUserDetailApplicationsRoute,
    consoleUserDetailOperationsRoute,
    consoleConnectorsIndexRoute,
    consoleConnectorsPasswordlessRoute,
    consoleConnectorsSocialRoute,
    consoleSignInExperienceIndexRoute,
    consoleSignInSignUpAndSignInRoute,
    consoleSignInExperienceDesktopCompatibilityRoute,
    consoleSignInExperienceMobileCompatibilityRoute,
    consoleSignInBrandingRoute,
    consoleSignInCollectUserProfileRoute,
    consoleSignInAccountCenterRoute,
    consoleSignInContentRoute,
    consoleMultiFactorAuthRoute,
    consoleSecurityIndexRoute,
    consoleSecurityPasswordPolicyRoute,
    consoleSecurityCaptchaRoute,
    consoleSecurityBlocklistRoute,
    consoleSecurityGeneralRoute,
    consoleOrganizationsRoute,
    consoleOrganizationDetailRoute,
    consoleOrganizationDetailSettingsRoute,
    consoleOrganizationDetailAuthorizationRoute,
    consoleRolesRoute,
    consoleRoleDetailRoute,
    consoleRoleDetailSettingsRoute,
    consoleRoleDetailPermissionsRoute,
    consoleRoleDetailAssignmentsRoute,
    consoleApiResourcesRoute,
    consoleApiResourceDetailRoute,
    consoleApiResourceDetailSettingsRoute,
    consoleApiResourceDetailScopesRoute,
    consoleApiResourceDetailPermissionsRoute,
    consoleOrganizationTemplateIndexRoute,
    consoleOrganizationTemplateRolesRoute,
    consoleOrganizationTemplatePermissionsRoute,
    consoleCustomJwtRoute,
    consoleWebhooksRoute,
    consoleWebhooksEndpointsRoute,
    consoleWebhooksRequestsRoute,
    consoleTenantSettingsIndexRoute,
    consoleTenantSettingsOidcRoute,
    consoleOnboardingRoute,
  ]),
  adminCompatibilityRoute.addChildren([
    adminCompatibilityIndexRoute,
    adminCompatibilityApplicationsRoute,
    adminCompatibilityApplicationDetailRoute,
    adminCompatibilityUsersRoute,
    adminCompatibilityUserDetailRoute,
    adminCompatibilityConnectorsRoute,
    adminCompatibilitySignInRoute,
    adminCompatibilitySecurityRoute,
    adminCompatibilityOrganizationsRoute,
    adminCompatibilityRolesRoute,
    adminCompatibilityRoleDetailRoute,
    adminCompatibilityApiResourcesRoute,
    adminCompatibilityApiResourceDetailRoute,
    adminCompatibilityBrandingRoute,
    adminCompatibilityDeploymentRoute,
    adminCompatibilityOnboardingRoute,
  ]),
])

export const router = createRouter({ routeTree })

function isRedirect(error: unknown) {
  return typeof error === 'object' && error !== null && 'headers' in error && 'status' in error
}

async function loadAccountAccess(returnTo?: string) {
  try {
    await queryClient.fetchQuery({ queryKey: ['account', 'profile'], queryFn: getAccountProfile })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      if (returnTo) throw redirect({ to: '/sign-in', search: { return_to: returnTo } })
      throw redirect({ to: '/sign-in' })
    }
    throw error
  }
}

export async function loadConsoleAccess(location: { href: string; pathname: string }) {
  const profile = await loadConsoleAccount(location.href)

  if (profile.user.role !== 'admin') {
    throw redirect({ to: '/sign-in', search: { return_to: location.href } })
  }

  try {
    await queryClient.fetchQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
    const readiness = await loadAdminReadiness()
    if (readiness.admin.setupRequired && location.pathname !== '/console/onboarding') {
      throw redirect({ to: '/console/onboarding' })
    }
  } catch (error) {
    if (isRedirect(error)) throw error
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      throw redirect({ to: '/sign-in', search: { return_to: location.href } })
    }
    throw error
  }
}

async function loadConsoleAccount(returnTo: string) {
  try {
    return await queryClient.fetchQuery({ queryKey: ['account', 'profile'], queryFn: getAccountProfile })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw redirect({ to: '/sign-in', search: { return_to: returnTo } })
    }
    throw error
  }
}

async function loadAdminReadiness() {
  const readiness = await getAdminReadiness()
  queryClient.setQueryData(adminQueryKeys.readiness, readiness)
  return readiness
}

function consoleHrefForAdminLocation(location: { hash: string; pathname: string; searchStr: string }) {
  return `${consolePathForAdminPath(location.pathname)}${location.searchStr}${location.hash ? `#${location.hash}` : ''}`
}

function consolePathForAdminPath(pathname: string) {
  if (pathname === '/admin') return '/console'
  if (pathname === '/admin/sign-in') return '/console/sign-in-experience/sign-up-and-sign-in'
  if (pathname === '/admin/branding') return '/console/sign-in-experience/branding'
  if (pathname === '/admin/connectors') return '/console/connectors/passwordless'
  if (pathname === '/admin/security') return '/console/security/password-policy'
  if (pathname === '/admin/deployment') return '/console/tenant-settings/oidc-configs'
  return `/console${pathname.slice('/admin'.length)}`
}

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
