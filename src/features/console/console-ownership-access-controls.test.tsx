import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applicationAudienceLabel,
  IdentityMultiSelect,
  OrganizationOwnerField,
  organizationOptions,
  ownerLabel,
  resourceEligibilityLabel,
  selectionSummary,
  userOptions,
} from '@/features/console/helpers/ownership-access-controls'
import { organization, user } from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ownership and access controls', () => {
  it('derives stable labels and summaries for every ownership and access mode', () => {
    const nameOnly = { ...organization, id: 'org-2', displayName: null, name: 'Northwind' }
    expect(organizationOptions([organization, nameOnly])).toEqual([
      { id: 'org-1', label: 'Acme Inc.', description: 'acme' },
      { id: 'org-2', label: 'Northwind', description: 'acme' },
    ])
    expect(
      userOptions([
        { ...user, displayName: 'Jane Display' },
        { ...user, id: 'user-2', displayName: undefined, name: 'Named user' },
        { ...user, id: 'user-3', displayName: undefined, name: undefined, email: 'mail@example.com' },
        { ...user, id: 'user-4', displayName: undefined, name: undefined, email: undefined },
      ]),
    ).toEqual([
      { id: 'user-1', label: 'Jane Display', description: 'jane@example.com' },
      { id: 'user-2', label: 'Named user', description: 'jane@example.com' },
      { id: 'user-3', label: 'mail@example.com', description: 'mail@example.com' },
      { id: 'user-4', label: 'user-4', description: undefined },
    ])
    expect(ownerLabel('org-1', [organization, nameOnly])).toBe('Acme Inc.')
    expect(ownerLabel('org-2', [organization, nameOnly])).toBe('Northwind')
    expect(ownerLabel('org-missing', [organization])).toBe('org-missing')
    expect(applicationAudienceLabel('realm')).toBe('All Realm users')
    expect(applicationAudienceLabel('organizations')).toBe('Selected Organizations')
    expect(applicationAudienceLabel('users')).toBe('Assigned users')
    expect(applicationAudienceLabel('public')).toBe('Anyone who can register')
    expect(resourceEligibilityLabel('owner_organization')).toBe('Owning Organization')
    expect(resourceEligibilityLabel('organizations')).toBe('Selected Organizations')
    expect(resourceEligibilityLabel('realm')).toBe('All Realm actors')

    const options = [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
      { id: 'three', label: 'Three' },
    ]
    expect(selectionSummary([], options)).toBe('None selected')
    expect(selectionSummary(['one'], options)).toBe('One')
    expect(selectionSummary(['one', 'missing'], options)).toBe('One, missing')
    expect(selectionSummary(['one', 'two', 'three'], options)).toBe('One, Two +1 more')
  })

  it('changes the owner and adds and removes identities from the searchable picker', async () => {
    const ownerChange = vi.fn()
    const selectionChange = vi.fn()
    const { rerender } = render(
      <>
        <OrganizationOwnerField onChange={ownerChange} organizations={[organization]} value="" />
        <IdentityMultiSelect
          emptyLabel="No identities found"
          label="Allowed identities"
          onChange={selectionChange}
          options={[
            { id: 'one', label: 'One', description: 'first@example.com' },
            { id: 'two', label: 'Two' },
          ]}
          placeholder="Select identities"
          value={[]}
        />
      </>,
    )

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'org-1' } })
    expect(ownerChange).toHaveBeenCalledWith('org-1')
    fireEvent.click(screen.getByRole('combobox', { name: 'Allowed identities' }))
    expect(await screen.findByText('first@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /One/ }))
    expect(selectionChange).toHaveBeenLastCalledWith(['one'])

    rerender(
      <IdentityMultiSelect
        emptyLabel="No identities found"
        label="Allowed identities"
        onChange={selectionChange}
        options={[
          { id: 'one', label: 'One', description: 'first@example.com' },
          { id: 'two', label: 'Two' },
        ]}
        placeholder="Select identities"
        value={['one']}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Allowed identities' }))
    fireEvent.click(await screen.findByRole('option', { name: /One/ }))
    expect(selectionChange).toHaveBeenLastCalledWith([])
  })
})
