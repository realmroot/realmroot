import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider, redirect } from '@tanstack/react-router'
import { AdminShell } from '@/components/layout/admin-shell'
import {
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourceDetailPage,
  ApiResourcesPage,
  ApplicationDetailPage,
  ApplicationsPage,
  BrandingPage,
  ConnectorsPage,
  DeploymentSettingsPage,
  OrganizationsPage,
  RoleDetailPage,
  RolesPage,
  SecurityPage,
  SignInSettingsPage,
  UserDetailPage,
  UsersPage,
} from '@/features/admin/admin-console'
import { ApiRequestError, getConfigz } from '@/lib/api'
import { getAccountProfile } from '@/lib/api/account'
import { adminQueryKeys, getAdminReadiness, getSignInSettings } from '@/lib/api/management'
import { AccountRoute } from '@/routes/account'
import { App } from '@/routes/app'
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
      throw redirect({ to: '/admin/onboarding' })
    }
  },
  component: () => <Outlet />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
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
  beforeLoad: async ({ location }) => {
    try {
      await queryClient.fetchQuery({ queryKey: ['account', 'profile'], queryFn: getAccountProfile })
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        throw redirect({ to: '/sign-in', search: { return_to: location.href } })
      }
      throw error
    }
  },
  component: () => <Outlet />,
})

const accountIndexRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/account/profile' })
  },
})

const accountProfileRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/profile',
  component: () => <AccountRoute section="profile" />,
})

const accountSecurityRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/security',
  component: () => <AccountRoute section="security" />,
})

const accountLinkedAccountsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/linked-accounts',
  component: () => <AccountRoute section="linked-accounts" />,
})

const accountSessionsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/sessions',
  component: () => <AccountRoute section="sessions" />,
})

const accountAuthorizedAppsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/authorized-apps',
  component: () => <AccountRoute section="authorized-apps" />,
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: async ({ location }) => {
    try {
      await queryClient.fetchQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
      const readiness = await loadAdminReadiness()
      if (readiness.admin.setupRequired && location.pathname !== readiness.admin.setupHref) {
        throw redirect({ to: '/admin/onboarding' })
      }
    } catch (error) {
      if (isRedirect(error)) throw error
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        throw redirect({ to: '/sign-in', search: { return_to: location.href } })
      }
      throw error
    }
  },
  component: () => (
    <AdminShell>
      <Outlet />
    </AdminShell>
  ),
})

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminDashboardPage,
})

const adminApplicationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/applications',
  component: ApplicationsPage,
})

const adminApplicationDetailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/applications/{$applicationId}',
  component: () => {
    const params = adminApplicationDetailRoute.useParams()
    return <ApplicationDetailPage applicationId={params.applicationId} />
  },
})

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: UsersPage,
})

const adminUserDetailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users/{$userId}',
  component: () => {
    const params = adminUserDetailRoute.useParams()
    return <UserDetailPage userId={params.userId} />
  },
})

const adminConnectorsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/connectors',
  component: ConnectorsPage,
})

const adminSignInRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/sign-in',
  component: SignInSettingsPage,
})

const adminSecurityRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/security',
  component: SecurityPage,
})

const adminOrganizationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/organizations',
  component: OrganizationsPage,
})

const adminRolesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/roles',
  component: RolesPage,
})

const adminRoleDetailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/roles/{$roleId}',
  component: () => {
    const params = adminRoleDetailRoute.useParams()
    return <RoleDetailPage roleId={params.roleId} />
  },
})

const adminApiResourcesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/api-resources',
  component: ApiResourcesPage,
})

const adminApiResourceDetailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/api-resources/{$resourceId}',
  component: () => {
    const params = adminApiResourceDetailRoute.useParams()
    return <ApiResourceDetailPage resourceId={params.resourceId} />
  },
})

const adminBrandingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/branding',
  component: BrandingPage,
})

const adminDeploymentRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/deployment',
  component: DeploymentSettingsPage,
})

const adminOnboardingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/onboarding',
  beforeLoad: async () => {
    const readiness = await loadAdminReadiness()
    if (!readiness.admin.setupRequired) {
      throw redirect({ to: '/admin' })
    }
  },
  component: AdminOnboardingPage,
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
  accountRoute.addChildren([
    accountIndexRoute,
    accountProfileRoute,
    accountSecurityRoute,
    accountLinkedAccountsRoute,
    accountSessionsRoute,
    accountAuthorizedAppsRoute,
  ]),
  adminRoute.addChildren([
    adminIndexRoute,
    adminApplicationsRoute,
    adminApplicationDetailRoute,
    adminUsersRoute,
    adminUserDetailRoute,
    adminConnectorsRoute,
    adminSignInRoute,
    adminSecurityRoute,
    adminOrganizationsRoute,
    adminRolesRoute,
    adminRoleDetailRoute,
    adminApiResourcesRoute,
    adminApiResourceDetailRoute,
    adminBrandingRoute,
    adminDeploymentRoute,
    adminOnboardingRoute,
  ]),
])

export const router = createRouter({ routeTree })

function isRedirect(error: unknown) {
  return typeof error === 'object' && error !== null && 'headers' in error && 'status' in error
}

async function loadAdminReadiness() {
  const readiness = await getAdminReadiness()
  queryClient.setQueryData(adminQueryKeys.readiness, readiness)
  return readiness
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
