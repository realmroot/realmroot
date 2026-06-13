import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '@/components/ui/empty-state'

describe('EmptyState', () => {
  it('renders a compact dashed card with configurable action and icon', () => {
    render(
      <EmptyState
        action={<button type="button">Add item</button>}
        description="Create an item to populate this page."
        icon={<span data-testid="empty-icon" />}
        title="No items"
      />,
    )

    expect(screen.getByText('No items').className).toContain('text-sm')
    expect(screen.getByText('Create an item to populate this page.').className).toContain('leading-5')
    expect(screen.getByTestId('empty-icon').parentElement?.className).toContain('size-8')
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy()
  })
})
