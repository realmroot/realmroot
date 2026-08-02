import { createFileRoute } from '@tanstack/react-router'
import { SecurityPoliciesPage } from '@/features/console/extracted/security-settings'

export const Route = createFileRoute('/console/security/sign-in')({ component: SecuritySignInRoute })

function SecuritySignInRoute() {
  return <SecurityPoliciesPage section="sign-in" />
}
