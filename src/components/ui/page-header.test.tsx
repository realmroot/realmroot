import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('renders compact console page header structure', () => {
    render(
      <PageHeader
        action={<button type="button">Create</button>}
        breadcrumb={['Console', 'Applications']}
        description="Manage OIDC clients."
        eyebrow="Console"
        title="Applications"
      />,
    )

    const heading = screen.getByRole('heading', { level: 1, name: 'Applications' })
    expect(heading.className).toContain('text-xl')
    expect(screen.getByText('Manage OIDC clients.').className).toContain('leading-5')
    expect(screen.getAllByText('Console')[0].parentElement?.parentElement?.className).toContain('text-xs')
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
  })
})
