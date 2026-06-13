import type { ManagementReadinessItem } from '@shared/api/management'
import type { WebhookEndpoint, WebhookRequest } from '@shared/api/webhooks'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { Table, TableBody } from '@/components/ui/table'
import { ConfirmDialog, FormDialog, SimpleCreateDialog } from '@/features/console/helpers/helpers-create'
import {
  BanUserDialog,
  CopyButton,
  DangerConfirmDialog,
  DeleteApplicationDialog,
  ErrorState,
  LoadingState,
  MutationError,
  PolicyCard,
  SecretDisclosureDialog,
  StatusBadge,
  SummaryRow,
  SwitchRow,
} from '@/features/console/helpers/helpers-dialogs'
import {
  AssetUploadControl,
  AssetUploadPreview,
  AuthorizationForm,
  AuthorizationRows,
} from '@/features/console/helpers/helpers-forms'
import {
  ChangesSection,
  PayloadBlock,
  SettingsSection,
  SettingsSections,
  TokenCustomizationCard,
  WebhookEndpointRow,
  WebhookRequestDialog,
  WebhookSecretDisclosureDialog,
} from '@/features/console/helpers/helpers-preview'
import {
  DetailTabs,
  lines,
  ObjectHeader,
  ResourcePage,
  RoutedSettingsTabs,
  SetupChecklist,
} from '@/features/console/helpers/helpers-resource'
import { HostedAuthPreview, PreviewBrandMark } from '@/features/console/helpers/hosted-auth-preview'
import {
  webhookEndpoint as webhookEndpointFixture,
  webhookRequest as webhookRequestFixture,
} from './console.test-utils'

const webhookEndpoint = webhookEndpointFixture as unknown as WebhookEndpoint
const webhookRequest = webhookRequestFixture as unknown as WebhookRequest

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('helpers-dialogs presentational pieces', () => {
  it('renders policy cards framed and unframed', () => {
    const { rerender } = render(<PolicyCard rows={[['Mode', 'required']]} title="Policy" />)
    expect(screen.getByText('Mode')).toBeTruthy()
    rerender(<PolicyCard framed={false} rows={[['Mode', 'optional']]} title="Policy" />)
    expect(screen.getByText('optional')).toBeTruthy()
  })

  it('renders a summary row with status node', () => {
    render(<SummaryRow meta="meta" status={<span>OK</span>} title="Title" />)
    expect(screen.getByText('Title')).toBeTruthy()
    expect(screen.getByText('OK')).toBeTruthy()
  })

  it('copies via CopyButton', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton label="Copy" value="payload" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('payload')
  })

  it('renders MutationError only when an error is present', () => {
    const { rerender, container } = render(<MutationError error={null} />)
    expect(container.firstChild).toBeNull()
    rerender(<MutationError error={new Error('boom')} />)
    expect(screen.getByText('boom')).toBeTruthy()
    rerender(<MutationError error={'plain'} />)
    expect(screen.getByText('Request failed.')).toBeTruthy()
  })

  it('renders the status badge in both states', () => {
    const { rerender } = render(<StatusBadge active activeLabel="On" inactiveLabel="Off" />)
    expect(screen.getByText('On')).toBeTruthy()
    rerender(<StatusBadge active={false} activeLabel="On" inactiveLabel="Off" />)
    expect(screen.getByText('Off')).toBeTruthy()
  })

  it('disables the switch row interaction when disabled', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(<SwitchRow checked={false} disabled label="Toggle" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
    rerender(<SwitchRow checked={false} label="Toggle" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('renders the secret disclosure dialog with present and null values', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    const onClose = vi.fn()
    render(<SecretDisclosureDialog clientId="cid" clientSecret="csecret" onClose={onClose} open />)
    expect(screen.getByText('cid')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    expect(writeText).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    cleanup()
    render(<SecretDisclosureDialog clientId={null} clientSecret={null} onClose={onClose} open />)
    expect(screen.getByText('Copy client secret')).toBeTruthy()
  })

  it('confirms destructive dialogs', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <DeleteApplicationDialog
        applicationName="App"
        error={new Error('delete failed')}
        onClose={onClose}
        onConfirm={onConfirm}
        open
        pending={false}
      />,
    )
    expect(screen.getByText('delete failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('captures a ban reason', () => {
    const onConfirm = vi.fn()
    render(<BanUserDialog error={null} onClose={vi.fn()} onConfirm={onConfirm} open pending={false} userName="Jane" />)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'spam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ban user' }))
    expect(onConfirm).toHaveBeenCalledWith('spam')
  })

  it('renders a danger confirm dialog', () => {
    const onConfirm = vi.fn()
    render(
      <DangerConfirmDialog
        actionLabel="Remove"
        description="Are you sure?"
        error={null}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        open
        pending={false}
        title="Remove thing"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('renders loading and error states with and without retry', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<LoadingState label="Loading things" />)
    expect(screen.getByText('Loading things')).toBeTruthy()
    rerender(<ErrorState error={new Error('failed')} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
    rerender(<ErrorState error={new Error('failed')} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('helpers-create dialogs', () => {
  it('submits the simple create dialog form', () => {
    const onSubmit = vi.fn()
    render(
      <SimpleCreateDialog
        error={null}
        fields={[
          ['name', 'Name'],
          ['description', 'Description'],
        ]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
        pending={false}
        title="Create thing"
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Widget' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('renders the confirm dialog pending state', () => {
    render(
      <ConfirmDialog
        description="Delete it"
        error="oops"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        open
        pending
        title="Confirm"
      />,
    )
    expect(screen.getByText('oops')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeTruthy()
  })

  it('renders the form dialog pending state with error', () => {
    render(
      <Dialog open>
        <FormDialog error="bad" onClose={vi.fn()} onSubmit={vi.fn()} pending title="Form">
          <div>body</div>
        </FormDialog>
      </Dialog>,
    )
    expect(screen.getByText('bad')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeTruthy()
  })
})

describe('helpers-forms', () => {
  it('submits an authorization form and surfaces validation errors', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <AuthorizationForm
        buttonLabel="Save"
        defaults={{ name: 'default' }}
        error={new Error('mutation failed')}
        fields={[
          ['name', 'Name'],
          ['resourceId', 'Resource'],
        ]}
        onSubmit={onSubmit}
        pending={false}
      />,
    )
    expect(screen.getByText('mutation failed')).toBeTruthy()
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    expect(onSubmit).toHaveBeenCalled()

    const throwing = vi.fn(() => {
      throw new Error('validation failed')
    })
    rerender(
      <AuthorizationForm
        buttonLabel="Save"
        defaults={{}}
        error={null}
        fields={[['name', 'Name']]}
        onSubmit={throwing}
        pending={false}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    expect(screen.getByText('validation failed')).toBeTruthy()
  })

  it('renders authorization rows, toggles edit, and saves edits', () => {
    const onDelete = vi.fn()
    const onEdit = vi.fn()
    const { rerender } = render(<AuthorizationRows empty="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeTruthy()

    rerender(
      <AuthorizationRows
        empty="Nothing here"
        rows={[
          {
            id: 'row-1',
            title: 'Row title',
            detail: 'Row detail',
            defaults: { name: 'value' },
            fields: [['name', 'Name']],
            onDelete,
            onEdit,
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    expect(onEdit).toHaveBeenCalled()
    // edit closes after save
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    // toggle edit open then closed
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('handles asset upload selection and preview fallback', () => {
    const onFile = vi.fn()
    render(<AssetUploadControl accept="image/*" label="Upload logo" onFile={onFile} previewUrl={null} />)
    const input = screen.getByLabelText('Upload logo') as HTMLInputElement
    // change with no file selected -> onFile is not called
    fireEvent.change(input, { target: { files: [] } })
    expect(onFile).not.toHaveBeenCalled()
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)

    cleanup()
    const { container } = render(<AssetUploadPreview previewUrl="https://cdn.example.com/logo.png" />)
    const img = container.querySelector('img')!
    expect(img).toBeTruthy()
    fireEvent.error(img)
    // after error the fallback icon renders (no img)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('helpers-resource', () => {
  it('renders the resource page in loading, error, empty, framed, and unframed states', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <ResourcePage description="desc" loading title="Things">
        <div>content</div>
      </ResourcePage>,
    )
    expect(screen.getByText('Loading things')).toBeTruthy()

    rerender(
      <ResourcePage description="desc" error={new Error('nope')} onRetry={onRetry} title="Things">
        <div>content</div>
      </ResourcePage>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()

    rerender(
      <ResourcePage description="desc" empty framed={false} title="Things">
        <div>content</div>
      </ResourcePage>,
    )
    expect(screen.getByText('No things yet')).toBeTruthy()

    rerender(
      <ResourcePage description="desc" title="Things">
        <div>framed content</div>
      </ResourcePage>,
    )
    expect(screen.getByText('framed content')).toBeTruthy()

    rerender(
      <ResourcePage
        description="desc"
        empty
        emptyDescription="custom desc"
        emptyTitle="custom title"
        framed={false}
        title="Things"
      >
        <div>content</div>
      </ResourcePage>,
    )
    expect(screen.getByText('custom title')).toBeTruthy()

    rerender(
      <ResourcePage description="desc" framed={false} title="Things" toolbar={<div>toolbar</div>}>
        <div>unframed content</div>
      </ResourcePage>,
    )
    expect(screen.getByText('toolbar')).toBeTruthy()
    expect(screen.getByText('unframed content')).toBeTruthy()
  })

  it('renders object header and detail tabs', () => {
    const onChange = vi.fn()
    render(<ObjectHeader badge="User" id="user-1" title="jane" />)
    expect(screen.getByText('user-1')).toBeTruthy()
    cleanup()
    render(
      <DetailTabs
        label="User detail"
        onChange={onChange}
        tabs={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('renders the setup checklist with complete and incomplete items', () => {
    const items: ManagementReadinessItem[] = [
      {
        id: 'oidc_application',
        label: 'Done',
        description: 'done desc',
        status: 'complete',
        href: '/a',
        action: 'Open',
      },
      {
        id: 'email_delivery',
        label: 'Todo',
        description: 'todo desc',
        status: 'action_needed',
        href: '/b',
        action: 'Fix',
      },
    ]
    render(<SetupChecklist title="Setup" items={items} />)
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('Todo')).toBeTruthy()
  })

  it('selects routed settings tabs and ignores modifier clicks', () => {
    // Stay outside /console/ so navigateConsoleTab short-circuits without a router.
    window.history.pushState(null, '', '/elsewhere')
    const onSelect = vi.fn()
    render(
      <RoutedSettingsTabs
        active="captcha"
        ariaLabel="Security settings"
        onSelect={onSelect}
        tabs={[
          ['captcha', 'CAPTCHA', '/console/security/captcha'],
          ['blocklist', 'Blocklist', '/console/security/blocklist'],
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Blocklist' }))
    expect(onSelect).toHaveBeenCalledWith('blocklist')
    // modifier-clicks are ignored (handler returns before onSelect)
    fireEvent.click(screen.getByRole('link', { name: 'CAPTCHA' }), { metaKey: true })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('splits lines and trims blanks', () => {
    expect(lines(' a \n\n b ')).toEqual(['a', 'b'])
  })
})

describe('helpers-preview presentational pieces', () => {
  it('renders a webhook endpoint row and triggers actions', () => {
    const onDelete = vi.fn()
    const onRotate = vi.fn()
    const onToggle = vi.fn()
    render(
      <Table>
        <TableBody>
          <WebhookEndpointRow endpoint={webhookEndpoint} onDelete={onDelete} onRotate={onRotate} onToggle={onToggle} />
        </TableBody>
      </Table>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    expect(onRotate).toHaveBeenCalledWith('wh_1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('wh_1')
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith('wh_1', false)
  })

  it('renders a disabled webhook endpoint row label', () => {
    render(
      <Table>
        <TableBody>
          <WebhookEndpointRow
            endpoint={{ ...webhookEndpoint, enabled: false }}
            onDelete={vi.fn()}
            onRotate={vi.fn()}
            onToggle={vi.fn()}
          />
        </TableBody>
      </Table>,
    )
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('renders the webhook secret disclosure dialog', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    const onClose = vi.fn()
    const { rerender } = render(<WebhookSecretDisclosureDialog onClose={onClose} secret="whsec_123" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    expect(writeText).toHaveBeenCalledWith('whsec_123')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    rerender(<WebhookSecretDisclosureDialog onClose={onClose} secret={null} />)
  })

  it('renders the webhook request dialog with payloads', () => {
    const { rerender } = render(<WebhookRequestDialog onClose={vi.fn()} request={webhookRequest} />)
    expect(screen.getByText('user.created')).toBeTruthy()
    expect(screen.getByText('Server error')).toBeTruthy()
    rerender(
      <WebhookRequestDialog
        onClose={vi.fn()}
        request={{ ...webhookRequest, error: null, httpStatus: null, requestBody: null, responseBody: null }}
      />,
    )
    expect(screen.getByText('Pending')).toBeTruthy()
    rerender(<WebhookRequestDialog onClose={vi.fn()} request={null} />)
  })

  it('renders payload block and token customization card', () => {
    render(<PayloadBlock label="Body" value="{}" />)
    expect(screen.getByText('Body')).toBeTruthy()
    cleanup()
    render(<TokenCustomizationCard rows={[['Audience', 'aud']]} title="Tokens" />)
    expect(screen.getByText('Audience')).toBeTruthy()
  })

  it('renders settings sections and changes section visibility', () => {
    const { rerender } = render(
      <SettingsSections>
        <SettingsSection description="desc" title="Section">
          <div>inner</div>
        </SettingsSection>
      </SettingsSections>,
    )
    expect(screen.getByText('Section')).toBeTruthy()

    const onDiscard = vi.fn()
    rerender(
      <ChangesSection
        description="You have changes"
        onDiscard={onDiscard}
        pending={false}
        saveLabel="Save"
        visible={false}
      />,
    )
    expect(screen.queryByText('You have changes')).toBeNull()

    rerender(
      <form>
        <ChangesSection
          description="You have changes"
          error={<span>err</span>}
          extraAction={<button type="button">Extra</button>}
          onDiscard={onDiscard}
          pending={false}
          saveLabel="Save"
          visible
        />
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalled()
    expect(screen.getByText('err')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Extra' })).toBeTruthy()
  })
})

describe('PreviewBrandMark', () => {
  it('renders a logo image and falls back to the initial on error', () => {
    const { container, rerender } = render(
      <PreviewBrandMark logoUrl="https://cdn.example.com/logo.png" productName="Acme" />,
    )
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByText('A')).toBeTruthy()
    rerender(<PreviewBrandMark logoUrl={null} productName="" />)
    expect(screen.getByText('F')).toBeTruthy()
  })
})

describe('HostedAuthPreview', () => {
  const basePreview = {
    description: 'Use your account to continue securely.',
    headline: 'Sign in to FlareAuth',
    productName: 'Acme',
    passwordEnabled: true,
    signupEnabled: true,
    emailOtpEnabled: true,
    phoneEnabled: true,
    passkeysEnabled: true,
    oneTapEnabled: true,
    web3WalletEnabled: true,
    usernameEnabled: true,
    socialLoginEnabled: true,
    socialProviders: [{ displayName: 'Google', icon: 'google', providerId: 'google', slug: 'google' }],
    termsUri: 'https://example.com/terms',
    privacyUri: 'https://example.com/privacy',
    supportEmail: 'support@example.com',
    primaryColor: '#111',
    backgroundColor: '#fff',
    customCss: '--auth-radius: 8px;',
    logoUrl: 'https://cdn.example.com/logo.png',
  }

  it('walks sign-in, email, and sign-up flows and edits the sign-up form', () => {
    render(<HostedAuthPreview preview={basePreview} />)
    expect(screen.getByText('Live preview')).toBeTruthy()

    // switch to mobile surface
    fireEvent.click(screen.getByRole('tab', { name: 'Mobile' }))

    // exercise the alternative sign-in method buttons (no-op preview handlers)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Phone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Passkey' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Web3 wallet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with OneTap' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    // enter the email OTP flow then go back to sign-in
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    expect(screen.getByText('Back to sign in')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))

    // open the sign-up flow and edit every form field
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Already have an account?')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jane' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    // the sign-up flow also renders a social provider button with a no-op handler
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    fireEvent.submit(screen.getAllByRole('button', { name: 'Create account' })[0].closest('form')!)
    // back to sign-in
    fireEvent.click(screen.getByRole('button', { name: 'Already have an account?' }))
  })

  it('renders the identifier-first password-only variant', () => {
    render(
      <HostedAuthPreview
        preview={{
          ...basePreview,
          identifierFirst: true,
          emailOtpEnabled: false,
          phoneEnabled: false,
          passkeysEnabled: false,
          oneTapEnabled: false,
          web3WalletEnabled: false,
          socialLoginEnabled: false,
          socialProviders: [],
        }}
      />,
    )
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  it('renders an OTP-only preview with no headline override', () => {
    render(
      <HostedAuthPreview
        preview={{
          description: 'Use your account to continue securely.',
          headline: 'Sign in to FlareAuth',
          productName: 'FlareAuth',
          passwordEnabled: false,
          emailOtpEnabled: true,
          signupEnabled: false,
        }}
      />,
    )
    expect(screen.getByText('Send code')).toBeTruthy()
  })

  it('opens the hosted sign-in window', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<HostedAuthPreview preview={basePreview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open hosted sign-in' }))
    expect(open).toHaveBeenCalledWith('/auth/sign-in', '_blank', 'noopener')
  })
})
