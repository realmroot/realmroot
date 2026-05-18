import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider, redirect } from '@tanstack/react-router'
import { AdminShell } from '@/components/layout/admin-shell'
import {
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourcesPage,
  ApplicationsPage,
  BrandingPage,
  ConnectorsPage,
  DeploymentSettingsPage,
  OrganizationsPage,
  RolesPage,
  SecurityPage,
  SignInSettingsPage,
  UsersPage,
} from '@/features/admin/admin-console'
import { ApiRequestError } from '@/lib/api'
import { adminQueryKeys, getSignInSettings } from '@/lib/api/management'
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
  component: AccountRoute,
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: async ({ location }) => {
    try {
      await queryClient.fetchQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
    } catch (error) {
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

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: UsersPage,
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

const adminApiResourcesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/api-resources',
  component: ApiResourcesPage,
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
  accountRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminApplicationsRoute,
    adminUsersRoute,
    adminConnectorsRoute,
    adminSignInRoute,
    adminSecurityRoute,
    adminOrganizationsRoute,
    adminRolesRoute,
    adminApiResourcesRoute,
    adminBrandingRoute,
    adminDeploymentRoute,
    adminOnboardingRoute,
  ]),
])

export const router = createRouter({ routeTree })

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
