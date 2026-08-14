import { createFileRoute } from '@tanstack/react-router'
import { DeviceAuthorizationPage } from '@/features/auth/device-authorization-page'

export const Route = createFileRoute('/auth/_protected/device')({
  validateSearch: (search: Record<string, unknown>) => ({
    user_code: typeof search.user_code === 'string' ? search.user_code : '',
  }),
  component: DeviceAuthorizationRoute,
})

function DeviceAuthorizationRoute() {
  return <DeviceAuthorizationPage userCode={Route.useSearch().user_code} />
}
