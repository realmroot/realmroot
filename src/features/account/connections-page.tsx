import type { AccountProviderConnection, AccountProviderConnector } from '@shared/api/account'
import { Check, Link2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ProviderIcon } from '@/components/provider-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createProviderConnectionIntent, disconnectAccountProviderConnection, linkAccount } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountEmptyState, AccountObjectSection, AccountPageHeader, AccountRow, AccountRows } from './account-page'
import { AccountSurface } from './account-surface'
import { DestructiveConfirmationDialog, useDestructiveConfirmation } from './primitives'
import {
  accountQueryKeys,
  useAccountMutation,
  useAccountProviderConnections,
  useAccountProviderConnectors,
} from './queries'
import { formatDate, readRedirectUrl } from './utils'

export function AccountConnectionsPage() {
  const connectorsQuery = useAccountProviderConnectors()
  const connectionsQuery = useAccountProviderConnections()
  const mutate = useAccountMutation()
  const [selected, setSelected] = useState<AccountProviderConnection | null>(null)
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const connections = connectionsQuery.data?.items ?? []
  const connectors = connectorsQuery.data?.items ?? []
  const connectedConnectorIds = new Set(connections.map((connection) => connection.connector.id))
  const available = connectors.filter((connector) => !connectedConnectorIds.has(connector.id))
  const loading = connectorsQuery.isLoading || connectionsQuery.isLoading
  const error = connectorsQuery.error ?? connectionsQuery.error

  async function authorizeProvider(connector: AccountProviderConnector) {
    const intent = await mutate(tt('Redirecting to {{providerName}}.', { providerName: connector.displayName }), () =>
      createProviderConnectionIntent(connector.id),
    )
    if (intent) window.location.assign(intent.authorizationUrl)
  }

  async function connect(connector: AccountProviderConnector) {
    if (connector.capabilities.connection.method === 'provider_authorization') {
      await authorizeProvider(connector)
      return
    }
    if (connector.capabilities.connection.method !== 'sign_in') return
    const result = await mutate(tt('Redirecting to {{providerName}}.', { providerName: connector.displayName }), () =>
      linkAccount({
        providerType: connector.providerType === 'generic_oauth' ? 'generic_oauth' : 'social',
        providerId: connector.providerId,
        callbackURL: `${window.location.origin}/connections`,
        errorCallbackURL: `${window.location.origin}/connections`,
      }),
    )
    const redirectUrl = readRedirectUrl(result)
    if (redirectUrl) window.location.assign(redirectUrl)
  }

  function disconnect(connection: AccountProviderConnection) {
    setConfirmation({
      title: tt('Disconnect {{providerName}}?', { providerName: connection.connector.displayName }),
      description: tt(
        'This removes the Provider from sign-in and revokes its active Agent Resource authorizations and token leases.',
      ),
      actionLabel: tt('Disconnect'),
      onConfirm: async () => {
        let failed = false
        await mutate(
          tt('{{providerName}} disconnected.', { providerName: connection.connector.displayName }),
          () => disconnectAccountProviderConnection(connection.id),
          {
            invalidate: [accountQueryKeys.providerConnections, accountQueryKeys.linkedAccounts],
            onError: () => {
              failed = true
            },
          },
        )
        if (!failed) setSelected(null)
      },
    })
  }

  return (
    <AccountSurface section="connections">
      {() => (
        <>
          <AccountPageHeader
            description={tt('Connect external accounts once for sign-in and delegated Agent access.')}
            title={tt('Connections')}
          />
          {loading ? <p className="text-sm text-muted-foreground">{tt('Loading Provider Connections…')}</p> : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error instanceof Error ? error.message : tt('Unable to load Provider Connections.')}
            </p>
          ) : null}
          {!loading && !error ? (
            <div className="accountSectionStackFlat">
              <AccountObjectSection
                description={tt('External Provider accounts connected to your Realmroot identity.')}
                surface
                title={tt('Connected')}
              >
                <AccountRows>
                  {connections.map((connection) => (
                    <AccountRow
                      action={
                        <Button onClick={() => setSelected(connection)} variant="outline">
                          {tt('Manage')}
                        </Button>
                      }
                      key={connection.id}
                      label={
                        <ProviderLabel
                          connector={connection.connector}
                          details={[
                            tt('{{displayName}} · Connected {{date}}', {
                              displayName: connection.displayName,
                              date: formatDate(connection.createdAt),
                            }),
                          ]}
                        />
                      }
                      value={<CapabilityBadges connection={connection} />}
                    />
                  ))}
                  {!connections.length ? (
                    <AccountEmptyState
                      description={tt('Connect an available Provider or approve an Agent Resource request.')}
                      icon={<Link2 />}
                      title={tt('No Provider Connections')}
                    />
                  ) : null}
                </AccountRows>
              </AccountObjectSection>
              <AccountObjectSection
                description={tt('Providers made available by your Realm administrator.')}
                surface
                title={tt('Available')}
              >
                <AccountRows>
                  {available.map((connector) => (
                    <AccountRow
                      action={
                        connector.capabilities.connection.method ? (
                          <Button onClick={() => void connect(connector)} variant="outline">
                            {tt('Connect')}
                          </Button>
                        ) : undefined
                      }
                      key={connector.id}
                      label={<ProviderLabel connector={connector} details={[capabilityDescription(connector)]} />}
                      value={undefined}
                    />
                  ))}
                  {!available.length ? (
                    <AccountEmptyState
                      description={tt('Every available Provider is already connected.')}
                      icon={<Check />}
                      title={tt('All Providers connected')}
                    />
                  ) : null}
                </AccountRows>
              </AccountObjectSection>
            </div>
          ) : null}
          <ConnectionSheet
            connection={selected}
            onClose={() => setSelected(null)}
            onDisconnect={disconnect}
            onReauthorize={(connection) => authorizeProvider(connection.connector)}
          />
          <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
        </>
      )}
    </AccountSurface>
  )
}

function ProviderLabel({ connector, details = [] }: { connector: AccountProviderConnector; details?: string[] }) {
  return (
    <span className="providerLabel">
      <ProviderIcon
        className="providerIcon providerIconLarge"
        provider={{ displayName: connector.displayName, icon: connector.providerId, providerId: connector.providerId }}
      />
      <span className="providerLabelText">
        <span className="providerLabelName">{connector.displayName}</span>
        {details.map((detail) => (
          <span className="providerLabelDetail" key={detail}>
            {detail}
          </span>
        ))}
      </span>
    </span>
  )
}

function CapabilityBadges({ connection }: { connection: AccountProviderConnection }) {
  return (
    <span className="flex flex-wrap justify-end gap-2">
      {connection.capabilities.signIn.active ? <Badge variant="secondary">{tt('Sign-in')}</Badge> : null}
      {connection.capabilities.agentAccess.active ? (
        <Badge variant="secondary">{tt('Agent resource access')}</Badge>
      ) : null}
      {!connection.capabilities.signIn.active && !connection.capabilities.agentAccess.active ? (
        <Badge variant="outline">{tt('Needs attention')}</Badge>
      ) : null}
    </span>
  )
}

function ConnectionSheet({
  connection,
  onClose,
  onDisconnect,
  onReauthorize,
}: {
  connection: AccountProviderConnection | null
  onClose: () => void
  onDisconnect: (connection: AccountProviderConnection) => void
  onReauthorize: (connection: AccountProviderConnection) => Promise<void>
}) {
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={connection !== null}>
      <SheetContent className="flex h-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{connection?.connector.displayName ?? tt('Provider Connection')}</SheetTitle>
          <SheetDescription>
            {connection
              ? tt('{{displayName}} · Connected {{date}}', {
                  displayName: connection.displayName,
                  date: formatDate(connection.createdAt),
                })
              : ''}
          </SheetDescription>
        </SheetHeader>
        {connection ? (
          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
            <AccountObjectSection description={connection.externalSubject} title={tt('Provider account')}>
              <AccountRows>
                <AccountRow label={tt('Account')} value={connection.displayName} />
                <AccountRow label={tt('Provider subject')} value={<code>{connection.externalSubject}</code>} />
              </AccountRows>
            </AccountObjectSection>
            <AccountObjectSection title={tt('Capabilities')}>
              <AccountRows>
                <AccountRow
                  description={tt('Use this Provider identity to authenticate to Realmroot.')}
                  label={tt('Sign-in')}
                  value={connection.capabilities.signIn.active ? tt('Enabled') : tt('Not enabled')}
                />
                <AccountRow
                  description={tt('Authorize Agents to access external Resources through this Provider.')}
                  label={tt('Agent resource access')}
                  value={connection.capabilities.agentAccess.active ? tt('Enabled') : tt('Not enabled')}
                />
              </AccountRows>
            </AccountObjectSection>
            <AccountObjectSection title={tt('Used by')}>
              {connection.capabilities.agentAccess.resourceNames.length ? (
                <AccountRows>
                  {connection.capabilities.agentAccess.resourceNames.map((name) => (
                    <AccountRow key={name} label={name} value={tt('Agent Resource access')} />
                  ))}
                </AccountRows>
              ) : (
                <AccountEmptyState
                  description={tt('Agent Resource authorizations will appear here.')}
                  icon={<ShieldCheck />}
                  title={tt('No Agent resource access')}
                />
              )}
            </AccountObjectSection>
          </div>
        ) : null}
        <SheetFooter className="border-t sm:justify-between">
          {connection ? (
            <Button onClick={() => onDisconnect(connection)} variant="destructive">
              {tt('Disconnect Provider')}
            </Button>
          ) : null}
          <div className="flex gap-2">
            {connection?.connector.capabilities.connection.method === 'provider_authorization' ? (
              <Button onClick={() => void onReauthorize(connection)}>{tt('Update authorization')}</Button>
            ) : null}
            <Button onClick={onClose} variant="outline">
              {tt('Close')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function capabilityDescription(connector: AccountProviderConnector) {
  if (connector.capabilities.signIn.available && connector.capabilities.agentAccess.available) {
    return tt('Sign-in and Agent resource access')
  }
  if (connector.capabilities.signIn.available) return tt('Sign-in only')
  if (connector.capabilities.agentAccess.available) return tt('Agent resource access only')
  return tt('No available capabilities')
}
