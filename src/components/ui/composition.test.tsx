import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkButton } from '@/components/link-button'
import { Field, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Status } from '@/components/ui/status'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

afterEach(() => {
  cleanup()
})

describe('composed UI primitives', () => {
  it('keeps the checked switch thumb distinct from the page background', () => {
    render(<Switch aria-label="Enabled" defaultChecked />)

    const control = screen.getByRole('switch', { name: 'Enabled' })
    const thumb = control.querySelector('[data-slot="switch-thumb"]')
    expect(control.getAttribute('data-state')).toBe('checked')
    expect(thumb?.className).toContain('data-checked:bg-accent')
    expect(thumb?.className).toContain('ring-foreground/15')
  })

  it('applies compact button size classes across button and link variants', () => {
    render(
      <>
        <Button>Default action</Button>
        <Button size="sm" variant="secondary">
          Small action
        </Button>
        <Button aria-label="Icon action" size="icon" />
        <LinkButton href="/settings" size="sm" variant="ghost">
          Link action
        </LinkButton>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Default action' }).getAttribute('data-size')).toBe('default')
    expect(screen.getByRole('button', { name: 'Small action' }).getAttribute('data-size')).toBe('sm')
    expect(screen.getByRole('button', { name: 'Icon action' }).getAttribute('data-size')).toBe('icon')
    expect(screen.getByRole('link', { name: 'Link action' }).getAttribute('href')).toBe('/settings')
  })

  it('renders card and dialog subcomponents with supplied content', () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description</CardDescription>
          </CardHeader>
          <CardContent>Card content</CardContent>
          <CardFooter>Card footer</CardFooter>
        </Card>
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog title</DialogTitle>
              <DialogDescription>Dialog description</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose>Close</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>,
    )

    expect(screen.getByText('Card footer')).toBeTruthy()
    expect(screen.getByText('Card title').closest('[data-slot="card"]')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Dialog description')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })

  it('keeps normal page sections as single shared card surfaces', () => {
    render(
      <main className="consoleMain">
        <div className="consoleContent">
          <section aria-label="Normal section">
            <Card>
              <CardHeader>
                <CardTitle>Normal section</CardTitle>
                <CardDescription>Uses one bordered surface for console content.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="consoleToolbar">
                  <Button size="sm" variant="secondary">
                    Search
                  </Button>
                  <Button size="sm">Create</Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>,
    )

    const section = screen.getByRole('region', { name: 'Normal section' })
    expect(section.querySelectorAll('[data-slot="card"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Search' }).parentElement?.className).toContain('consoleToolbar')
  })

  it('renders status regions and responsive tables with shared semantics', () => {
    render(
      <>
        <Status>Saved</Status>
        <Status tone="error">Request failed</Status>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Customer portal</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    )

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('status').className).toContain('status-info')
    expect(screen.getByRole('alert').hasAttribute('aria-live')).toBe(false)
    expect(screen.getByRole('alert').className).toContain('status-error')
    expect(screen.getByRole('table').parentElement?.className).toContain('overflow-x-auto')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Customer portal' })).toBeTruthy()
  })

  it('renders compact table empty rows inside table bodies', () => {
    render(
      <Table>
        <TableBody>
          <TableEmptyRow colSpan={3} description="No rows match this filter." title="No rows" />
        </TableBody>
      </Table>,
    )

    expect(screen.getByRole('cell').getAttribute('colspan')).toBe('3')
    expect(screen.getByRole('heading', { name: 'No rows' }).className).toContain('text-sm')
    expect(screen.getByText('No rows match this filter.').className).toContain('leading-5')
  })

  it('opens dropdown menus and closes them after item selection', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    expect(screen.queryByRole('menu')).toBeNull()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('requires dropdown parts to be rendered inside a menu', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<DropdownMenuTrigger>Actions</DropdownMenuTrigger>)).toThrow(
      '`DropdownMenuTrigger` must be used within `DropdownMenu`',
    )

    consoleError.mockRestore()
  })

  it('wires fields to valid controls and plain content', () => {
    render(
      <>
        <Field help="Shown to reviewers" label="Named field">
          <TextInput id="custom-id" />
        </Field>
        <Field label="Plain field">
          <span>Plain content</span>
        </Field>
      </>,
    )

    expect(screen.getByLabelText('Named field').id).toBe('custom-id')
    expect(screen.getByLabelText('Named field').getAttribute('data-slot')).toBe('input')
    expect(screen.getByText('Shown to reviewers')).toBeTruthy()
    expect(screen.getByText('Plain content')).toBeTruthy()
  })

  it('requires fields to receive a single element child', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Field label="Literal field">Literal content</Field>)).toThrow(
      'React.Children.only expected to receive a single React element child.',
    )

    consoleError.mockRestore()
  })

  it('renders active tabs and requires tab parts to be inside tabs', () => {
    const setValue = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <Tabs onValueChange={setValue} value="profile">
        <TabsList variant="navigation">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">Profile panel</TabsContent>
        <TabsContent value="security">Security panel</TabsContent>
      </Tabs>,
    )

    const profileTab = screen.getByRole('tab', { name: 'Profile' })
    const securityTab = screen.getByRole('tab', { name: 'Security' })
    const tabList = screen.getByRole('tablist')
    const panel = screen.getByRole('tabpanel')
    expect(tabList.getAttribute('data-variant')).toBe('navigation')
    expect(tabList.className).toContain('gap-6')
    expect(tabList.className).toContain('overflow-y-hidden')
    expect(profileTab.className).toContain('group-data-[variant=navigation]/tabs-list:flex-none')
    expect(profileTab.className).toContain('group-data-[variant=navigation]/tabs-list:after:hidden')
    expect(panel.textContent).toBe('Profile panel')
    expect(profileTab.getAttribute('aria-selected')).toBe('true')
    expect(profileTab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(profileTab.id)
    expect(screen.queryByText('Security panel')).toBeNull()
    fireEvent.mouseDown(securityTab, { button: 0, ctrlKey: false })
    expect(setValue).toHaveBeenCalledWith('security')
    expect(() => render(<TabsTrigger value="orphan">Orphan</TabsTrigger>)).toThrow(
      '`TabsTrigger` must be used within `Tabs`',
    )

    consoleError.mockRestore()
  })
})
