import { AppWindow, Bot, KeyRound, Link2, Wallet } from 'lucide-react'
import { ProviderIcon } from '@/components/provider-icon'
import { Button } from '@/components/ui/button'
import {
  createAccountConnection,
  linkAccount,
  retireAgent,
  revokeAccountConnection,
  revokeApplicationConsent,
  unlinkAccount,
  unlinkWalletAddress,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import {
  DestructiveConfirmationDialog,
  ItemList,
  PanelTitle,
  SubsectionTitle,
  useDestructiveConfirmation,
} from './primitives'
import {
  accountQueryKeys,
  useAccountAgents,
  useAccountConfig,
  useAccountConnections,
  useAccountMutation,
  useAccountProfile,
  useConsentedApplications,
  useExternalApiResources,
  useLinkedAccounts,
} from './queries'
import { defaultAccountCenterSettings } from './settings'
import type {
  ConfirmDestructiveHandler,
  ConsentedApplication,
  IdentityProvider,
  LinkedAccount,
  MutationHandler,
  Web3WalletProvider,
} from './types'
import { enrollWallet, formatDate, readRedirectUrl } from './utils'

export function AccountConnectionsPage() {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const config = configQuery.data ?? null
  const accountCenter = config?.accountCenter ?? defaultAccountCenterSettings
  const linkedAccountsQuery = useLinkedAccounts(accountCenter.connectedAccountsEnabled)
  const applicationsQuery = useConsentedApplications(accountCenter.connectedAccountsEnabled)
  const agentsQuery = useAccountAgents()
  const externalResourcesQuery = useExternalApiResources()
  const accountConnectionsQuery = useAccountConnections()
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const queries = [
    configQuery,
    profileQuery,
    linkedAccountsQuery,
    applicationsQuery,
    agentsQuery,
    externalResourcesQuery,
    accountConnectionsQuery,
  ]
  const error = queries.find((query) => query.error)?.error
  if (queries.some((query) => query.isLoading)) return <AccountPageLoading config={config} />
  if (error)
    return <AccountPageError config={config} message={error instanceof Error ? error.message : tt('Unable to load.')} />
  const profile = profileQuery.data?.user ?? null
  if (!profile) return <AccountPageError config={config} message={tt('Unable to load account center.')} />
  return (
    <AccountPageShell accountCenter={accountCenter} config={config} profile={profile} section="connections">
      <div className="accountSectionStackFlat">
        <ConnectionsPanel
          accounts={linkedAccountsQuery.data?.accounts ?? []}
          confirm={setConfirmation}
          mutate={mutate}
          providers={config?.identityProviders ?? []}
          walletProvider={config?.builtInProviders.web3Wallet}
        />
        <ResourceConnectionsPanel
          connections={accountConnectionsQuery.data?.items ?? []}
          confirm={setConfirmation}
          mutate={mutate}
          resources={externalResourcesQuery.data?.items ?? []}
        />
        <ApplicationsPanel
          applications={applicationsQuery.data?.applications ?? []}
          confirm={setConfirmation}
          mutate={mutate}
        />
        <AgentIdentitiesPanel identities={agentsQuery.data?.items ?? []} confirm={setConfirmation} mutate={mutate} />
      </div>
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </AccountPageShell>
  )
}

function ResourceConnectionsPanel({
  resources,
  connections,
  confirm,
  mutate,
}: {
  resources: import('@shared/api/agent-api').ConnectableApiResourcesResponse['items']
  connections: import('@shared/api/agent-api').AccountConnection[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
  async function connect(resourceId: string) {
    const intent = await mutate('Redirecting to the external platform.', () =>
      createAccountConnection({ apiResourceId: resourceId, owner: { type: 'user' } }),
    )
    if (intent?.authorizationUrl) window.location.assign(intent.authorizationUrl)
  }

  return (
    <section className="accountPanelGroup" aria-label={tt('API resource accounts')}>
      <div className="accountPanelHeader">
        <PanelTitle
          description={tt('Accounts used to authorize direct Agent access to external APIs.')}
          icon={<KeyRound size={18} />}
          title={tt('API resource accounts')}
        />
      </div>
      <section className="settingsPanel">
        <SubsectionTitle
          title={tt('Connected resource accounts')}
          description={tt('Connecting an account grants no Agent access until you approve an exact request.')}
        />
        <ItemList
          empty={tt('No external API resources are available.')}
          emptyDescription={tt('An administrator must configure an external API Resource first.')}
          items={resources.flatMap((resource) => {
            const matches = connections.filter(
              (connection) => connection.apiResourceId === resource.id && connection.status === 'active',
            )
            if (matches.length === 0) {
              return [
                {
                  id: resource.id,
                  icon: <KeyRound size={16} />,
                  title: resource.name,
                  meta: `${resource.resourceUrl} · ${resource.scopes.map((scope) => scope.value).join(', ')}`,
                  status: tt('Not connected'),
                  action: <Button onClick={() => void connect(resource.id)}>{tt('Connect')}</Button>,
                },
              ]
            }
            return matches.map((connection) => ({
              id: connection.id,
              icon: <KeyRound size={16} />,
              title: `${resource.name} · ${connection.displayName}`,
              meta: connection.scopes.join(', '),
              status: tt('Connected'),
              action: (
                <Button
                  onClick={() =>
                    confirm({
                      title: tt('Disconnect resource account'),
                      description: tt('Active Agent grants and token leases for this account will be revoked.'),
                      actionLabel: tt('Disconnect'),
                      onConfirm: () =>
                        mutate('Resource account disconnected.', () => revokeAccountConnection(connection.id), {
                          invalidate: [accountQueryKeys.accountConnections],
                        }),
                    })
                  }
                  variant="ghost"
                >
                  {tt('Disconnect')}
                </Button>
              ),
            }))
          })}
        />
      </section>
    </section>
  )
}

function AgentIdentitiesPanel({
  identities,
  confirm,
  mutate,
}: {
  identities: import('@shared/api/agent-api').Agent[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
  return (
    <section className="accountPanelGroup" aria-label={tt('Agent identities')}>
      <div className="accountPanelHeader">
        <PanelTitle
          description={tt('Stable Agent identities owned by your personal space.')}
          icon={<Bot size={18} />}
          title={tt('Agent identities')}
        />
      </div>
      <section className="settingsPanel">
        <SubsectionTitle
          title={tt('Stable identities')}
          description={tt('Issuer and subject remain stable when hosts change.')}
        />
        <ItemList
          empty={tt('No Agent identities yet.')}
          items={identities.map((identity) => ({
            id: identity.id,
            icon: <Bot size={16} />,
            title: identity.name,
            meta: `${identity.issuer} · ${identity.subject}`,
            status: identity.status,
            action:
              identity.status === 'retired' ? undefined : (
                <Button
                  onClick={() =>
                    confirm({
                      title: tt('Retire Agent identity'),
                      description: tt('This subject will remain reserved and can never be reused.'),
                      actionLabel: tt('Retire identity'),
                      onConfirm: () =>
                        mutate('Agent retired.', () => retireAgent(identity.id), {
                          invalidate: [accountQueryKeys.agents],
                        }),
                    })
                  }
                  type="button"
                  variant="ghost"
                >
                  {tt('Retire')}
                </Button>
              ),
          }))}
        />
      </section>
    </section>
  )
}

function ConnectionsPanel({
  accounts,
  confirm,
  mutate,
  providers,
  walletProvider,
}: {
  accounts: LinkedAccount[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  providers: IdentityProvider[]
  walletProvider?: Web3WalletProvider
}) {
  return (
    <section className="accountPanelGroup" aria-label={tt('Linked accounts')}>
      <div className="accountPanelHeader">
        <PanelTitle
          description={tt('External sign-in identities connected to this account.')}
          icon={<Link2 size={18} />}
          title={tt('Linked accounts')}
        />
      </div>
      <ConnectionsSection
        accounts={accounts}
        confirm={confirm}
        mutate={mutate}
        providers={providers}
        walletProvider={walletProvider}
      />
    </section>
  )
}

function ConnectionsSection({
  accounts,
  confirm,
  mutate,
  providers,
  walletProvider,
}: {
  accounts: LinkedAccount[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  providers: IdentityProvider[]
  walletProvider?: Web3WalletProvider
}) {
  const externalAccounts = accounts.filter((account) => account.providerId !== 'credential')
  const accountByProvider = new Map(externalAccounts.map((account) => [account.providerId, account]))
  const walletAccounts = externalAccounts.filter((account) => account.providerId === 'siwe')
  const walletEnabled = Boolean(walletProvider?.enabled)
  async function connectProvider(provider: IdentityProvider) {
    const result = await mutate(tt('Redirecting to {{providerName}}.', { providerName: provider.displayName }), () =>
      linkAccount({
        providerType: provider.providerType === 'generic_oauth' ? 'generic_oauth' : 'social',
        providerId: provider.providerId,
        callbackURL: `${window.location.origin}/linked-accounts`,
        errorCallbackURL: `${window.location.origin}/profile`,
      }),
    )
    const redirectUrl = readRedirectUrl(result)
    if (redirectUrl) window.location.assign(redirectUrl)
  }
  async function connectWallet() {
    await mutate('Wallet linked.', () => enrollWallet(walletProvider?.chains ?? [1]), {
      invalidate: [accountQueryKeys.linkedAccounts],
    })
  }
  return (
    <section className="settingsPanel">
      <SubsectionTitle
        title={tt('Linked accounts')}
        description={tt('External sign-in identities connected to this account.')}
      />
      <ItemList
        empty={tt('No sign-in connectors are available.')}
        emptyDescription={tt('Enable a social or OAuth connector before users can link one here.')}
        items={[
          ...providers.map((provider) =>
            linkedProviderItem(provider, accountByProvider.get(provider.providerId), confirm, mutate, connectProvider),
          ),
          ...(walletEnabled
            ? [walletProviderItem(walletAccounts, walletProvider, confirm, mutate, connectWallet)]
            : []),
        ]}
      />
    </section>
  )
}

function linkedProviderItem(
  provider: IdentityProvider,
  account: LinkedAccount | undefined,
  confirm: ConfirmDestructiveHandler,
  mutate: MutationHandler,
  connectProvider: (provider: IdentityProvider) => void,
) {
  return {
    id: provider.slug,
    icon: <ProviderIcon className="providerIcon providerIconLarge" provider={provider} />,
    title: provider.displayName,
    meta: account ? tt('Linked {{date}}', { date: formatDate(account.createdAt) }) : tt('Not linked to this account.'),
    status: account ? tt('Linked') : tt('Available'),
    action: account ? (
      <Button
        onClick={() =>
          confirm({
            title: tt('Unlink account'),
            description: tt('{{providerName}} will no longer be connected to your account.', {
              providerName: provider.displayName,
            }),
            actionLabel: tt('Unlink account'),
            onConfirm: () =>
              mutate('Linked account removed.', () => unlinkAccount(provider.providerId, account.accountId), {
                invalidate: [accountQueryKeys.linkedAccounts],
              }),
          })
        }
        type="button"
        variant="ghost"
      >
        {tt('Unlink')}
      </Button>
    ) : (
      <Button onClick={() => void connectProvider(provider)} type="button" variant="secondary">
        {tt('Connect')}
      </Button>
    ),
  }
}

function walletProviderItem(
  walletAccounts: LinkedAccount[],
  walletProvider: Web3WalletProvider | undefined,
  confirm: ConfirmDestructiveHandler,
  mutate: MutationHandler,
  connectWallet: () => void,
) {
  return {
    id: 'web3-wallet',
    icon: <Wallet size={16} />,
    title: tt('Web3 wallet'),
    meta: walletAccounts.length
      ? tt('{{count}} wallet linked.', { count: walletAccounts.length })
      : tt('Link a wallet after signing in with an email-based account.'),
    status: walletAccounts.length ? tt('Linked') : tt('Available'),
    action: walletAccounts.length ? (
      <Button
        onClick={() =>
          confirm({
            title: tt('Unlink wallet'),
            description: tt('This wallet will no longer sign in to your account.'),
            actionLabel: tt('Unlink wallet'),
            onConfirm: () =>
              mutate('Wallet removed.', () => unlinkWalletAddress(walletAccounts[0].accountId), {
                invalidate: [accountQueryKeys.linkedAccounts],
              }),
          })
        }
        type="button"
        variant="ghost"
      >
        {tt('Unlink')}
      </Button>
    ) : (
      <Button
        disabled={!walletProvider?.enabled}
        onClick={() => void connectWallet()}
        type="button"
        variant="secondary"
      >
        {tt('Connect')}
      </Button>
    ),
  }
}

function ApplicationsPanel({
  applications,
  confirm,
  mutate,
}: {
  applications: ConsentedApplication[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
  return (
    <section className="accountPanelGroup" aria-label={tt('Authorized apps')}>
      <div className="accountPanelHeader">
        <PanelTitle
          description={tt('Applications with consent to access this account.')}
          icon={<AppWindow size={18} />}
          title={tt('Authorized apps')}
        />
      </div>
      <section className="settingsPanel">
        <SubsectionTitle
          title={tt('Authorized apps')}
          description={tt('Applications with consent to access this account.')}
        />
        <ItemList
          empty={tt('No authorized applications yet.')}
          items={applications.map((application) => ({
            id: application.id,
            icon: <Link2 size={16} />,
            title: application.applicationName,
            meta: `${tt('Scopes:')} ${application.scopes.join(', ')} ${tt('/ Granted {{date}}', { date: formatDate(application.grantedAt) })}`,
            action: (
              <Button
                onClick={() =>
                  confirm({
                    title: tt('Revoke application access'),
                    description: tt(
                      '{{applicationName}} will lose access to this account until you approve it again.',
                      { applicationName: application.applicationName },
                    ),
                    actionLabel: tt('Revoke access'),
                    onConfirm: () =>
                      mutate('Application access revoked.', () => revokeApplicationConsent(application.id), {
                        invalidate: [accountQueryKeys.applications],
                      }),
                  })
                }
                type="button"
                variant="ghost"
              >
                {tt('Revoke')}
              </Button>
            ),
          }))}
        />
      </section>
    </section>
  )
}
