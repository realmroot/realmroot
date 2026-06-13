import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DestructiveConfirmationDialog,
  ItemList,
  PanelTitle,
  SettingsAction,
  StatusPill,
  SubsectionTitle,
  UnavailableSection,
  useDestructiveConfirmation,
} from './primitives'

afterEach(cleanup)

describe('presentational primitives', () => {
  it('renders panel title with action and settings action with optional fields', () => {
    render(
      <PanelTitle
        action={<button type="button">Act</button>}
        title="Panel"
        description="Panel description"
        icon={<svg aria-label="icon" />}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Panel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy()

    render(
      <SettingsAction
        action={<button type="button">Edit</button>}
        icon={<svg />}
        meta="meta text"
        status="status text"
        title="Setting"
        value="value text"
      />,
    )
    expect(screen.getByRole('heading', { name: 'Setting' })).toBeTruthy()
    expect(screen.getByText('value text')).toBeTruthy()
    expect(screen.getByText('status text')).toBeTruthy()
  })

  it('omits optional value and status when not provided', () => {
    render(<SettingsAction icon={<svg />} meta="just meta" title="Bare" />)
    expect(screen.getByText('just meta')).toBeTruthy()
    expect(screen.queryByText('status text')).toBeNull()
  })

  it('renders status pill and subsection title', () => {
    render(<StatusPill label="Sessions" value="3" />)
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('Sessions')).toBeTruthy()

    render(<SubsectionTitle title="Sub" description="Sub description" />)
    expect(screen.getByRole('heading', { name: 'Sub' })).toBeTruthy()
  })

  it('renders an empty item list with default and custom descriptions', () => {
    const { rerender } = render(<ItemList empty="Nothing here" items={[]} />)
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.getByText('Nothing needs attention here.')).toBeTruthy()

    rerender(<ItemList empty="Empty" emptyDescription="Custom empty" items={[]} />)
    expect(screen.getByText('Custom empty')).toBeTruthy()
  })

  it('renders populated item rows with all optional slots', () => {
    render(
      <ItemList
        empty="Empty"
        items={[
          {
            id: '1',
            icon: <svg aria-label="row-icon" />,
            title: 'Row One',
            meta: 'meta one',
            status: 'Active',
            action: <button type="button">Remove</button>,
            children: <div>extra child</div>,
          },
          { id: '2', title: 'Row Two', meta: 'meta two' },
        ]}
      />,
    )
    expect(screen.getByText('Row One')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('extra child')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(screen.getByText('Row Two')).toBeTruthy()
  })

  it('renders an unavailable section message', () => {
    render(<UnavailableSection message="Feature disabled" />)
    expect(screen.getByRole('heading', { name: 'Feature disabled' })).toBeTruthy()
  })
})

describe('DestructiveConfirmationDialog', () => {
  it('renders nothing when there is no confirmation', () => {
    const { container } = render(<DestructiveConfirmationDialog confirmation={null} onClose={() => {}} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('confirms and closes, invoking onConfirm', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <DestructiveConfirmationDialog
        confirmation={{
          title: 'Remove item',
          description: 'This cannot be undone.',
          actionLabel: 'Remove',
          onConfirm,
        }}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Remove item')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cancels without invoking onConfirm', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <DestructiveConfirmationDialog
        confirmation={{ title: 'Remove', description: 'desc', actionLabel: 'Remove', onConfirm }}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('useDestructiveConfirmation', () => {
  it('provides confirmation state', () => {
    const { result } = renderHook(() => useDestructiveConfirmation())
    expect(result.current[0]).toBeNull()
  })
})
