import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

describe('badge', () => {
  it('renders supported visual variants', () => {
    render(
      <div>
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </div>,
    )

    expect(screen.getByText('Default').className).toContain('bg-primary')
    expect(screen.getByText('Default').className).toContain('min-h-6')
    expect(screen.getByText('Default').className).toContain('px-2')
    expect(screen.getByText('Default').className).toContain('text-xs')
    expect(screen.getByText('Secondary').className).toContain('bg-secondary')
    expect(screen.getByText('Outline').className).toContain('border-border')
    expect(screen.getByText('Destructive').className).toContain('bg-destructive')
  })
})
