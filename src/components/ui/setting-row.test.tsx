import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingRow } from './setting-row'

describe('SettingRow', () => {
  it('renders dense label and wrapped value cells', () => {
    render(<SettingRow label="Issuer" value={<code>https://auth.example.com/api/auth</code>} />)

    expect(screen.getByText('Issuer').className).toContain('leading-5')
    expect(screen.getByText('https://auth.example.com/api/auth').parentElement?.className).toContain('break-words')
  })
})
