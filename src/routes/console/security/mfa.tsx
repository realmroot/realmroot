import { createFileRoute } from '@tanstack/react-router'
import { SecurityPoliciesPage } from '@/features/console/extracted/security-settings'

export const Route = createFileRoute('/console/security/mfa')({ component: SecurityMfaRoute })

function SecurityMfaRoute() {
  return <SecurityPoliciesPage section="mfa" />
}
