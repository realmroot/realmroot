import type { ApplicationResponse } from '@shared/api/applications'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsTableContent } from '@/features/applications/management/application-detail-sections'
import { application, renderWithQuery } from './console.test-utils'

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

describe('ApplicationsTableContent', () => {
  it('renders applications and toggles disabled state', async () => {
    const onToggleDisabled = vi.fn()
    renderWithQuery(
      <ApplicationsTableContent
        applications={[app]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications
        onToggleDisabled={onToggleDisabled}
        organizations={[]}
      />,
    )
    fireEvent.pointerDown(await screen.findByLabelText(`Actions for ${app.name}`), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByText('Disable'))
    expect(onToggleDisabled).toHaveBeenCalledWith(app)
  })

  it('renders the enable action for a disabled application', async () => {
    const onToggleDisabled = vi.fn()
    renderWithQuery(
      <ApplicationsTableContent
        applications={[{ ...app, disabled: true }]}
        emptyDescription="No matches"
        emptyTitle="No matching apps"
        hasApplications
        onToggleDisabled={onToggleDisabled}
        organizations={[]}
      />,
    )
    expect(await screen.findByText('0 Resource Servers')).toBeTruthy()
    fireEvent.pointerDown(screen.getByLabelText(`Actions for ${app.name}`), { button: 0, ctrlKey: false })
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
        organizations={[]}
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
        organizations={[]}
      />,
    )
    expect(screen.getByText('No applications yet')).toBeTruthy()
  })
})
