export {
  HostedAuthPreview,
  hostedAuthMode,
  localizedHostedCopy,
  PreviewBrandMark,
  passwordSignupEnabled,
  previewSignInAction,
} from './hosted-auth-preview'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type ReactNode,
  RefreshCw,
  Save,
  SettingRow,
  TableCell,
  TableRow,
  Trash2,
  tt,
  Undo2,
  type WebhookEndpoint,
  type WebhookRequest,
} from '../console-shared'
import { CopyButton, SwitchRow } from './helpers-dialogs'
import { ResourcePage, RoutedSettingsTabs } from './helpers-resource'

export function WebhookEndpointRow({
  endpoint,
  onDelete,
  onRotate,
  onToggle,
}: {
  endpoint: WebhookEndpoint
  onDelete: (id: string) => void
  onRotate: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{endpoint.url}</div>
        <div className="text-xs text-muted-foreground">{endpoint.id}</div>
      </TableCell>
      <TableCell>{endpoint.events.join(', ')}</TableCell>
      <TableCell>
        <SwitchRow
          checked={endpoint.enabled}
          label={endpoint.enabled ? tt('Enabled') : tt('Disabled')}
          onCheckedChange={(checked) => onToggle(endpoint.id, checked)}
        />
      </TableCell>
      <TableCell>{endpoint.secretPrefix}…</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onRotate(endpoint.id)} type="button" variant="secondary">
            <RefreshCw data-icon="inline-start" /> {tt('Rotate secret')}{' '}
          </Button>
          <Button onClick={() => onDelete(endpoint.id)} type="button" variant="destructive">
            <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
export function WebhookSecretDisclosureDialog({ onClose, secret }: { onClose: () => void; secret: string | null }) {
  return (
    <Dialog open={Boolean(secret)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Signing secret')}</DialogTitle>
          <DialogDescription>{tt('Copy this secret now. It is shown only once.')}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="grid gap-3 p-4">
            <code className="break-all rounded-md border border-border bg-muted p-3 text-sm">{secret}</code>
            <CopyButton label={tt('Copy secret')} value={secret} />
          </div>
        ) : null}
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Done')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function WebhookRequestDialog({ onClose, request }: { onClose: () => void; request: WebhookRequest | null }) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={Boolean(request)}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tt('Webhook request')}</DialogTitle>
          <DialogDescription>{request?.id}</DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-3">
              <SettingRow label={tt('Endpoint')} value={request.endpointUrl} />
              <SettingRow label={tt('Event')} value={request.event} />
              <SettingRow label={tt('Status')} value={request.status} />
              <SettingRow label={tt('Attempts')} value={String(request.attemptCount)} />
              <SettingRow
                label={tt('HTTP status')}
                value={request.httpStatus ? String(request.httpStatus) : 'Pending'}
              />
              {request.error ? <SettingRow label={tt('Error')} value={request.error} /> : null}
              {request.requestBody ? <PayloadBlock label={tt('Request body')} value={request.requestBody} /> : null}
              {request.responseBody ? <PayloadBlock label={tt('Response body')} value={request.responseBody} /> : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="m-0 shrink-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Close')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function PayloadBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{value}</pre>
    </div>
  )
}
export function TokenCustomizationCard({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <SettingsSection title={title} description={tt('Claim controls reflect the persisted authorization contract.')}>
      <div className="grid gap-3">
        {rows.map(([label, value]) => (
          <SettingRow key={label} label={label} value={value} />
        ))}
      </div>
    </SettingsSection>
  )
}
export type SignInExperienceTab = {
  href: string
  label: string
  value: string
}
const signInExperienceTabs: SignInExperienceTab[] = [
  {
    value: 'branding',
    label: 'Branding',
    href: '/console/sign-in-experience/branding',
  },
  {
    value: 'sign-up-and-sign-in',
    label: 'Sign-up and sign-in',
    href: '/console/sign-in-experience/sign-up-and-sign-in',
  },
  {
    value: 'account-center',
    label: 'Account Center',
    href: '/console/sign-in-experience/account-center',
  },
  {
    value: 'content',
    label: 'Content',
    href: '/console/sign-in-experience/content',
  },
]
export function SignInExperiencePage({
  activeTab,
  action,
  children,
  description,
  error,
  loading,
  onRetry,
  title,
}: {
  activeTab: string
  action?: ReactNode
  children: ReactNode
  description: string
  error?: Error | null
  loading?: boolean
  onRetry?: () => void
  title: string
}) {
  return (
    <ResourcePage
      action={action}
      description={description}
      error={error}
      framed={false}
      loading={loading}
      onRetry={onRetry}
      title={title}
      toolbar={
        <RoutedSettingsTabs
          active={activeTab}
          ariaLabel="Sign-in and account settings"
          tabs={signInExperienceTabs.map((tab) => [tab.value, tab.label, tab.href] as const)}
        />
      }
    >
      {children}
    </ResourcePage>
  )
}
export function SignInExperienceEditorLayout({ settings }: { settings: ReactNode }) {
  return <div className="signInExperienceSettings">{settings}</div>
}
export function SignInExperiencePreviewPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="signInExperiencePreviewPanel" aria-label={tt('Hosted authentication preview')}>
      {children}
    </aside>
  )
}
export function SettingsSections({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>
}
export function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-background p-5 md:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-muted-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
export function ChangesSection({
  description,
  error,
  extraAction,
  onDiscard,
  pending,
  saveLabel,
  visible,
}: {
  description: string
  error?: ReactNode
  extraAction?: ReactNode
  onDiscard: () => void
  pending: boolean
  saveLabel: string
  visible: boolean
}) {
  if (!visible) return null
  return (
    <section aria-label={tt('Unsaved changes')} className="changesSheet">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-muted-foreground">
          {tt('Changes')}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="changesSheetControls">
        {error}
        <div className="changesSheetActions">
          {extraAction}
          <Button onClick={onDiscard} type="button" variant="ghost">
            <Undo2 data-icon="inline-start" /> {tt('Discard')}{' '}
          </Button>
          <Button disabled={pending} type="submit">
            <Save data-icon="inline-start" />
            {saveLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}
