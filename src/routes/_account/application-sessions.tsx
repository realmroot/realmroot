import { createFileRoute } from '@tanstack/react-router'
import { ApplicationSessionsPage } from '@/features/account/application-sessions-page'

export const Route = createFileRoute('/_account/application-sessions')({
  validateSearch: (search: Record<string, unknown>) => ({
    client_id: typeof search.client_id === 'string' ? search.client_id : '',
  }),
  component: Page,
})

function Page() {
  const { client_id } = Route.useSearch()
  return <ApplicationSessionsPage clientId={client_id} key={client_id} />
}
