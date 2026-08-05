import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TextInput } from '@/components/product-form'
import { ConsoleActionBar, ConsoleDetailStack, ConsoleToolbar } from '@/features/management/primitives'

describe('console primitives', () => {
  it('renders toolbar, detail stack, and sticky action structure', () => {
    render(
      <>
        <ConsoleToolbar className="border-b">
          <button type="button">Filter</button>
          <TextInput aria-label="Search" />
        </ConsoleToolbar>
        <ConsoleDetailStack>
          <section>Details</section>
        </ConsoleDetailStack>
        <ConsoleActionBar>
          <button type="button">Save</button>
        </ConsoleActionBar>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Filter' }).parentElement?.className).toContain('consoleToolbar')
    expect(screen.getByLabelText('Search').getAttribute('data-slot')).toBe('input')
    expect(screen.getByText('Details').parentElement?.className).toContain('consoleDetailStack')
    expect(screen.getByRole('button', { name: 'Save' }).parentElement?.className).toContain('stickyActionBar')
  })
})
