import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'

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
    expect(screen.getByText('Secondary').className).toContain('bg-secondary')
    expect(screen.getByText('Outline').className).toContain('border-border')
    expect(screen.getByText('Destructive').className).toContain('bg-destructive')
  })
})
