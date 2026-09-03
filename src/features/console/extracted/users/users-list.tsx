import { Link } from '@tanstack/react-router'
import { CreateUserDialog } from '@/features/management/create-dialogs'
import { StatusBadge } from '@/features/management/dialogs'
import { ListToolbar, ResourcePage } from '@/features/management/resource-components'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Plus,
  SelectInput,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  tt,
  useQuery,
  useQueryClient,
  useState,
} from '@/features/management/shared'
import { formatDate, useAdminMutation, userDisplayName } from '@/features/management/utils'
import { consoleQueryKeys, createUser, listUsers, requestUserPasswordReset } from '@/lib/api/management'

export function UsersPage() {
  const [search, setSearch] = useState('')
  const [banned, setBanned] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: [
      ...consoleQueryKeys.users,
      {
        search,
        banned,
        page,
      },
    ],
    queryFn: () =>
      listUsers({
        ...(search
          ? {
              search,
            }
          : {}),
        ...(banned
          ? {
              banned: banned === 'true',
            }
          : {}),
        page,
        pageSize: 10,
      }),
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.users,
      })
    },
  })
  const users = query.data?.items ?? []
  return (
    <ResourcePage
      title={tt('Users')}
      description={tt('Manage the human identities that sign in, join Organizations, and delegate authority.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New user')}{' '}
        </Button>
      }
      auxiliary={
        <CreateUserDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error}
      empty={users.length === 0}
      emptyDescription={
        search ? 'No users match the current search.' : 'Create a user to verify sign-in and account-center behavior.'
      }
      emptyTitle={search ? 'No users found' : 'No users yet'}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      tableToolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search users')}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder={tt('Search users')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter status')}
            onChange={(event) => {
              setBanned(event.target.value)
              setPage(1)
            }}
            value={banned}
          >
            <option value="">{tt('Any status')}</option>
            <option value="false">{tt('Active')}</option>
            <option value="true">{tt('Banned')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <div className="grid gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('User')}</TableHead>
              <TableHead>{tt('Email')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Created')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length ? (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      params={{ userId: user.id }}
                      to="/console/users/$userId"
                    >
                      {userDisplayName(user)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{user.id}</div>
                  </TableCell>
                  <TableCell>
                    <div>{user.email ?? 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge active={!user.banned} activeLabel="Active" inactiveLabel="Banned" />
                  </TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label={`Actions for ${user.email ?? user.id}`} size="icon-sm" variant="ghost">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuGroup>
                          {user.email ? (
                            <DropdownMenuItem onClick={() => requestUserPasswordReset(user.id)}>
                              {' '}
                              {tt('Send reset link')}{' '}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                description={
                  search
                    ? tt('No users match the current search.')
                    : tt('Create a user to verify sign-in and account-center behavior.')
                }
                title={search ? tt('No users found') : tt('No users yet')}
              />
            )}
          </TableBody>
        </Table>
        {query.data && query.data.items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-sm text-muted-foreground">
            <span>
              {' '}
              {tt('Showing')} {(query.data.pagination.page - 1) * query.data.pagination.pageSize + 1}-
              {Math.min(query.data.pagination.page * query.data.pagination.pageSize, query.data.pagination.totalItems)}{' '}
              of {query.data.pagination.totalItems}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={page === 1}
                onClick={() => setPage(Math.max(1, page - 1))}
                type="button"
                variant="secondary"
              >
                {' '}
                {tt('Previous')}{' '}
              </Button>
              <Button
                disabled={query.data.pagination.page >= query.data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
                type="button"
                variant="secondary"
              >
                {' '}
                {tt('Next')}{' '}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </ResourcePage>
  )
}
