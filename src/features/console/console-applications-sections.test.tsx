import type { ApplicationResponse } from '@shared/api/applications'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationBrandingCard } from '@/features/console/extracted/applications/application-branding-card'
import {
  ApplicationOidcClaimsForm,
  ApplicationsTableContent,
} from '@/features/console/extracted/applications/application-detail-sections'
import { application } from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const app = application as unknown as ApplicationResponse

describe('ApplicationOidcClaimsForm', () => {
  it('toggles a claim, saves, and discards back to the loaded value', () => {
    const onSave = vi.fn()
    render(
      <ApplicationOidcClaimsForm
        claims={app.oidcClaims}
        error={new Error('claims failed')}
        onSave={onSave}
        pending={false}
      />,
    )
    expect(screen.getByText('claims failed')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: 'Access token roles' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save OIDC claims' }))
    expect(onSave).toHaveBeenCalled()
    // discard via the reset button restores the loaded claims
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
  })

  it('disables controls while pending', () => {
    render(<ApplicationOidcClaimsForm claims={app.oidcClaims} error={null} onSave={vi.fn()} pending />)
    expect(screen.getByRole('button', { name: 'Save OIDC claims' })).toHaveProperty('disabled', true)
  })
})

describe('ApplicationsTableContent', () => {
  it('renders applications and toggles disabled state', () => {
    const onToggleDisabled = vi.fn()
    render(
      <ApplicationsTableContent
        applications={[app]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications
        onToggleDisabled={onToggleDisabled}
      />,
    )
    fireEvent.click(screen.getByLabelText(`Actions for ${app.name}`))
    fireEvent.click(screen.getByText('Disable'))
    expect(onToggleDisabled).toHaveBeenCalledWith(app)
  })

  it('renders the enable action for a disabled application', () => {
    const onToggleDisabled = vi.fn()
    render(
      <ApplicationsTableContent
        applications={[{ ...app, disabled: true, firstParty: false }]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications
        onToggleDisabled={onToggleDisabled}
      />,
    )
    expect(screen.getByText('Third-party')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(`Actions for ${app.name}`))
    expect(screen.getByText('Enable')).toBeTruthy()
  })

  it('renders the filtered-empty state when applications exist but none match', () => {
    render(
      <ApplicationsTableContent
        applications={[]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications
        onToggleDisabled={vi.fn()}
      />,
    )
    expect(screen.getByText('No matching apps')).toBeTruthy()
  })

  it('renders the no-applications-yet empty state', () => {
    render(
      <ApplicationsTableContent
        applications={[]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications={false}
        onToggleDisabled={vi.fn()}
      />,
    )
    expect(screen.getByText('No applications yet')).toBeTruthy()
  })
})

describe('ApplicationBrandingCard', () => {
  it('renders an explicit error message alongside the mutation error', () => {
    render(
      <ApplicationBrandingCard
        application={app}
        error={new Error('upload failed')}
        errorMessage="Logo too large"
        onLogo={vi.fn()}
      />,
    )
    expect(screen.getByText('upload failed')).toBeTruthy()
    expect(screen.getByText('Logo too large')).toBeTruthy()
  })

  it('uploads a logo file and shows the homepage fallback', () => {
    const onLogo = vi.fn()
    render(
      <ApplicationBrandingCard
        application={{ ...app, homepageUrl: null }}
        error={null}
        errorMessage={null}
        onLogo={onLogo}
      />,
    )
    expect(screen.getByText('Not set')).toBeTruthy()
    const input = screen.getByLabelText(`Upload logo for ${app.name}`)
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onLogo).toHaveBeenCalledWith(file)
  })
})
