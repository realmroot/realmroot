import { consoleQueryKeys, createApplication, listApplications, updateApplication } from '@/lib/api/management'
import {
  Button,
  Plus,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
  tt,
  useQuery,
  useQueryClient,
  useState,
} from '../../console-shared'
import { CreateApplicationDialog } from '../../helpers/helpers-create'
import { MutationError } from '../../helpers/helpers-dialogs'
import { ListToolbar, ResourcePage } from '../../helpers/helpers-resource'
import { useAdminMutation } from '../../helpers/helpers-utils'
import { ApplicationsTableContent } from './application-detail-sections'

export function ApplicationsPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.applications,
    queryFn: listApplications,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'my-apps' | 'third-party'>('my-apps')
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.readiness,
        }),
      ])
    },
  })
  const toggleMutation = useAdminMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => updateApplication(id, { disabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.applications }),
  })
  const applications = query.data?.applications ?? []
  const visibleApplications = applications.filter((application) => {
    const matchesTab = selectedTab === 'my-apps' ? application.firstParty : !application.firstParty
    const matchesSearch =
      search.trim().length === 0 ||
      [application.name, application.clientId, application.slug].some((value) =>
        value.toLowerCase().includes(search.trim().toLowerCase()),
      )
    return matchesTab && matchesSearch
  })
  return (
    <ResourcePage
      title={tt('Applications')}
      description={tt('Manage OIDC clients, redirect URIs, grant types, and client security posture.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New application')}{' '}
        </Button>
      }
      auxiliary={
        <CreateApplicationDialog
          createdApplication={createMutation.data ?? null}
          error={createMutation.errorMessage}
          onClose={() => {
            setDialogOpen(false)
            createMutation.reset()
          }}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error}
      empty={applications.length === 0}
      emptyDescription="Create your first OIDC client to connect an application to hosted authentication."
      emptyTitle="No applications yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Tabs setValue={(value) => setSelectedTab(value as 'my-apps' | 'third-party')} value={selectedTab}>
        <ListToolbar>
          <TabsList aria-label={tt('Application lists')}>
            <TabsTrigger value="my-apps">{tt('My apps')}</TabsTrigger>
            <TabsTrigger value="third-party">{tt('Third-party apps')}</TabsTrigger>
          </TabsList>
          <TextInput
            aria-label={tt('Search applications')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search applications')}
            value={search}
          />
        </ListToolbar>
        <MutationError error={toggleMutation.error} />
        <TabsContent value="my-apps">
          <ApplicationsTableContent
            applications={visibleApplications}
            emptyDescription={
              search
                ? 'No applications match the current search in this tab.'
                : 'Applications created by external publishers will appear here when available.'
            }
            emptyTitle={search ? 'No applications found' : 'No applications in this tab'}
            hasApplications={applications.length > 0}
            onToggleDisabled={(application) =>
              toggleMutation.mutate({ id: application.id, disabled: !application.disabled })
            }
          />
        </TabsContent>
        <TabsContent value="third-party">
          <ApplicationsTableContent
            applications={visibleApplications}
            emptyDescription={
              search
                ? 'No applications match the current search in this tab.'
                : 'Applications created by external publishers will appear here when available.'
            }
            emptyTitle={search ? 'No applications found' : 'No applications in this tab'}
            hasApplications={applications.length > 0}
            onToggleDisabled={(application) =>
              toggleMutation.mutate({ id: application.id, disabled: !application.disabled })
            }
          />
        </TabsContent>
      </Tabs>
    </ResourcePage>
  )
}
