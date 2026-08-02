import { createFileRoute } from '@tanstack/react-router'
import { SecurityPoliciesPage } from '@/features/console/extracted/security-settings'

export const Route = createFileRoute('/console/security/abuse')({ component: SecurityAbuseRoute })

function SecurityAbuseRoute() {
  return <SecurityPoliciesPage section="abuse" />
}
