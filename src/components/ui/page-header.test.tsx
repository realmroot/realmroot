import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '@/components/ui/page-header'

describe('PageHeader', () => {
  it('renders compact console page header structure', () => {
    render(
      <PageHeader
        action={<button type="button">Create</button>}
        description="Manage OIDC clients."
        title="Applications"
      />,
    )

    const heading = screen.getByRole('heading', { level: 1, name: 'Applications' })
    expect(heading.tagName).toBe('H1')
    expect(heading.className).toContain('text-2xl')
    const description = screen.getByText('Manage OIDC clients.')
    expect(description.tagName).toBe('P')
    expect(description.className).toContain('mt-1')
    expect(screen.queryByText('Console')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
  })
})
