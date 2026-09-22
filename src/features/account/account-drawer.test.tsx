import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './account-drawer'

afterEach(cleanup)

it('honors caller-owned focus without overriding the requested close destination', async () => {
  const opened = vi.fn()
  function Example() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <button type="button">Next task</button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            onOpenAutoFocus={opened}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              screen.getByRole('button', { name: 'Next task' }).focus()
            }}
          >
            <DialogTitle>Details</DialogTitle>
            <DialogDescription>Review account details.</DialogDescription>
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </DialogContent>
        </Dialog>
      </>
    )
  }
  render(<Example />)
  screen.getByRole('button', { name: 'Open' }).focus()
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(opened).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next task' })))
})

it('closes safely when a mutation removes the element that opened the drawer', async () => {
  const closed = vi.fn()
  function Example() {
    const [open, setOpen] = useState(false)
    const [exists, setExists] = useState(true)
    return (
      <>
        {exists ? (
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
        ) : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent onCloseAutoFocus={closed}>
            <DialogTitle>Details</DialogTitle>
            <DialogDescription>Review account details.</DialogDescription>
            <button type="button" onClick={() => setExists(false)}>
              Remove opener
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </DialogContent>
        </Dialog>
      </>
    )
  }
  render(<Example />)
  screen.getByRole('button', { name: 'Open' }).focus()
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove opener' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(closed).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
})
