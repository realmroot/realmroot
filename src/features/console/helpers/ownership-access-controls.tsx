import type { ApplicationAudienceMode } from '@shared/api/applications'
import type { ApiResourceEligibilityMode, OrganizationResponse } from '@shared/api/authorization'
import type { ManagementUserResponse } from '@shared/api/management'
import { ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { Field, SelectInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { tt } from '@/lib/i18n'

export type SelectableIdentity = {
  description?: string
  id: string
  label: string
}

export function organizationOptions(organizations: OrganizationResponse[]): SelectableIdentity[] {
  return organizations.map((organization) => ({
    id: organization.id,
    label: organization.displayName ?? organization.name,
    description: organization.slug,
  }))
}

export function userOptions(users: ManagementUserResponse[]): SelectableIdentity[] {
  return users.map((user) => ({
    id: user.id,
    label: user.displayName ?? user.name ?? user.email ?? user.id,
    description: user.email,
  }))
}

export function ownerLabel(ownerOrganizationId: string, organizations: OrganizationResponse[]) {
  const organization = organizations.find((candidate) => candidate.id === ownerOrganizationId)
  return organization?.displayName ?? organization?.name ?? ownerOrganizationId
}

export function applicationAudienceLabel(mode: ApplicationAudienceMode) {
  return {
    realm: tt('All Realm users'),
    organizations: tt('Selected Organizations'),
    users: tt('Assigned users'),
    public: tt('Anyone who can register'),
  }[mode]
}

export function resourceEligibilityLabel(mode: ApiResourceEligibilityMode) {
  return {
    owner_organization: tt('Owning Organization'),
    organizations: tt('Selected Organizations'),
    realm: tt('All Realm actors'),
  }[mode]
}

export function selectionSummary(ids: string[], options: SelectableIdentity[]) {
  const selected = ids.map((id) => options.find((option) => option.id === id)?.label ?? id)
  if (selected.length === 0) return tt('None selected')
  if (selected.length <= 2) return selected.join(', ')
  return tt('{{first}}, {{second}} +{{count}} more', {
    first: selected[0],
    second: selected[1],
    count: selected.length - 2,
  })
}

export function OrganizationOwnerField({
  onChange,
  organizations,
  value,
}: {
  onChange: (id: string) => void
  organizations: OrganizationResponse[]
  value: string
}) {
  return (
    <Field help={tt('The Organization responsible for configuration and lifecycle.')} label={tt('Owner')}>
      <SelectInput name="ownerOrganizationId" onChange={(event) => onChange(event.target.value)} required value={value}>
        <option disabled value="">
          {tt('Select an Organization')}
        </option>
        {organizationOptions(organizations).map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.label}
          </option>
        ))}
      </SelectInput>
    </Field>
  )
}

export function IdentityMultiSelect({
  emptyLabel,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  emptyLabel: string
  label: string
  onChange: (ids: string[]) => void
  options: SelectableIdentity[]
  placeholder: string
  value: string[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Field help={value.length ? tt('{{count}} selected', { count: value.length }) : undefined} label={label}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={label}
            aria-expanded={open}
            className="h-auto min-h-9 w-full justify-between whitespace-normal text-left font-normal"
            role="combobox"
            variant="outline"
          >
            <span className={value.length ? '' : 'text-muted-foreground'}>
              {value.length ? selectionSummary(value, options) : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder={tt('Search…')} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = value.includes(option.id)
                  return (
                    <CommandItem
                      data-checked={checked}
                      key={option.id}
                      onSelect={() =>
                        onChange(checked ? value.filter((id) => id !== option.id) : [...value, option.id])
                      }
                      value={`${option.label} ${option.description ?? ''} ${option.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  )
}
