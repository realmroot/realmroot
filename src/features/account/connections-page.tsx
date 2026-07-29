import { AppWindow, Bot, Link2, Wallet } from 'lucide-react'
import { ProviderIcon } from '@/components/provider-icon'
import { Button } from '@/components/ui/button'
import {
  linkAccount,
  retirePersonalAgentIdentity,
  revokeAccountAgent,
  revokeAccountAgentCapabilityGrant,
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
  useAccountMutation,
  useAccountProfile,
  useAgentIdentities,
  useConsentedApplications,
  useLinkedAccounts,
} from './queries'
import { defaultAccountCenterSettings } from './settings'
import type {
  AccountAgent,
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
  const agentIdentitiesQuery = useAgentIdentities()
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const queries = [configQuery, profileQuery, linkedAccountsQuery, applicationsQuery, agentsQuery, agentIdentitiesQuery]
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
        <ApplicationsPanel
          applications={applicationsQuery.data?.applications ?? []}
          confirm={setConfirmation}
          mutate={mutate}
        />
        <AgentsPanel agents={agentsQuery.data?.agents ?? []} confirm={setConfirmation} mutate={mutate} />
        <AgentIdentitiesPanel
          identities={agentIdentitiesQuery.data?.identities ?? []}
          confirm={setConfirmation}
          mutate={mutate}
        />
      </div>
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </AccountPageShell>
  )
}

function AgentIdentitiesPanel({
  identities,
  confirm,
  mutate,
}: {
  identities: import('@shared/api/agents').AgentIdentity[]
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
            meta: `${identity.issuer} · ${identity.subject} · ${identity.bindings.length} ${tt('hosts')}`,
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
                        mutate('Agent identity retired.', () => retirePersonalAgentIdentity(identity.id), {
                          invalidate: [accountQueryKeys.agentIdentities],
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

function AgentsPanel({
  agents,
  confirm,
  mutate,
}: {
  agents: AccountAgent[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
  return (
    <section className="accountPanelGroup" aria-label={tt('Delegated agents')}>
      <div className="accountPanelHeader">
        <PanelTitle
          description={tt('Agents approved to access this account.')}
          icon={<Bot size={18} />}
          title={tt('Delegated agents')}
        />
      </div>
      <section className="settingsPanel">
        <SubsectionTitle title={tt('Delegated agents')} description={tt('Agents approved to access this account.')} />
        <ItemList
          empty={tt('No delegated agents yet.')}
          items={agents.map((agent) => agentItem(agent, confirm, mutate))}
        />
      </section>
    </section>
  )
}

function agentItem(agent: AccountAgent, confirm: ConfirmDestructiveHandler, mutate: MutationHandler) {
  return {
    id: agent.id,
    icon: <Bot size={16} />,
    title: agent.name,
    meta: `${tt('Host:')} ${agent.host.name ?? agent.host.id} ${tt('/ Status:')} ${agent.status} ${tt('/ Capabilities:')} ${agent.capabilityGrants.map((grant) => grant.capability).join(', ') || tt('None')}`,
    action: (
      <Button
        onClick={() =>
          confirm({
            title: tt('Revoke agent access'),
            description: tt('{{agentName}} will lose delegated access to this account.', { agentName: agent.name }),
            actionLabel: tt('Revoke access'),
            onConfirm: () =>
              mutate('Agent access revoked.', () => revokeAccountAgent(agent.id), {
                invalidate: [accountQueryKeys.agents],
              }),
          })
        }
        type="button"
        variant="ghost"
      >
        {tt('Revoke')}
      </Button>
    ),
    children: agent.capabilityGrants.length ? (
      <div className="mt-3 grid gap-2">
        {agent.capabilityGrants.map((grant) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2"
            key={grant.id}
          >
            <span className="font-mono text-xs text-foreground">{grant.capability}</span>
            <Button
              onClick={() =>
                confirm({
                  title: tt('Revoke capability grant'),
                  description: tt('{{capability}} will no longer be available to this agent.', {
                    capability: grant.capability,
                  }),
                  actionLabel: tt('Revoke grant'),
                  onConfirm: () =>
                    mutate('Capability grant revoked.', () => revokeAccountAgentCapabilityGrant(grant.id), {
                      invalidate: [accountQueryKeys.agents],
                    }),
                })
              }
              type="button"
              variant="ghost"
            >
              {tt('Revoke')}
            </Button>
          </div>
        ))}
      </div>
    ) : null,
  }
}
