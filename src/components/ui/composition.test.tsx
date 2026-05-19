import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, LinkButton } from './button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Field, TextInput } from './field'
import { Status } from './status'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(() => {
  cleanup()
})

describe('composed UI primitives', () => {
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

    expect(screen.getByRole('button', { name: 'Default action' }).className).toContain('uiButton-default')
    expect(screen.getByRole('button', { name: 'Small action' }).className).toContain('uiButton-sm')
    expect(screen.getByRole('button', { name: 'Icon action' }).className).toContain('uiButton-icon')
    expect(screen.getByRole('link', { name: 'Link action' }).className).toContain('uiButton-sm')
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
        <Dialog open={false}>Hidden dialog</Dialog>
      </>,
    )

    expect(screen.getByText('Card footer')).toBeTruthy()
    expect(screen.getByText('Card title').parentElement?.className).toContain('p-5')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('dialog').parentElement?.className).toContain('overscroll-contain')
    expect(screen.getByText('Dialog title').parentElement?.className).toContain('p-5')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.queryByText('Hidden dialog')).toBeNull()
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
    expect(screen.getByRole('table').className).toContain('min-w-[48rem]')
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).toContain('h-11')
    expect(screen.getByRole('cell', { name: 'Customer portal' }).className).toContain('h-[52px]')
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
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actions' }).className).toContain('min-h-8')
    expect(screen.getByRole('menuitem', { name: 'Archive' }).className).toContain('min-h-8')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('requires dropdown parts to be rendered inside a menu', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<DropdownMenuTrigger>Actions</DropdownMenuTrigger>)).toThrow(
      'DropdownMenu components must be rendered inside DropdownMenu.',
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
    expect(screen.getByLabelText('Named field').className).toContain('textInput')
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
      <Tabs setValue={setValue} value="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">Profile panel</TabsContent>
        <TabsContent value="security">Security panel</TabsContent>
      </Tabs>,
    )

    const profileTab = screen.getByRole('tab', { name: 'Profile' })
    const securityTab = screen.getByRole('tab', { name: 'Security' })
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toBe('Profile panel')
    expect(profileTab.parentElement?.className).toContain('h-9')
    expect(profileTab.className).toContain('h-8')
    expect(profileTab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(profileTab.id)
    expect(screen.queryByText('Security panel')).toBeNull()
    fireEvent.keyDown(profileTab, { key: 'ArrowRight' })
    expect(setValue).toHaveBeenCalledWith('security')
    fireEvent.click(securityTab)
    expect(setValue).toHaveBeenCalledWith('security')
    expect(() => render(<TabsTrigger value="orphan">Orphan</TabsTrigger>)).toThrow(
      'Tabs components must be rendered inside Tabs.',
    )

    consoleError.mockRestore()
  })
})
