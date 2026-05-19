import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'
import { cn } from '@/lib/utils'

type DropdownContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const DropdownContext = createContext<DropdownContextValue | null>(null)

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">{children}</div>
    </DropdownContext.Provider>
  )
}

export function DropdownMenuTrigger({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const menu = useDropdownMenu()
  return (
    <button
      className={cn(
        'inline-flex min-h-8 items-center justify-center rounded-md border border-border px-2.5 text-sm font-medium',
        className,
      )}
      onClick={() => menu.setOpen(!menu.open)}
      type="button"
      {...props}
    />
  )
}

export function DropdownMenuContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const menu = useDropdownMenu()
  if (!menu.open) return null
  return (
    <div
      className={cn(
        'absolute right-0 top-full z-20 mt-2 min-w-44 rounded-md border border-border bg-background p-1 shadow-md',
        className,
      )}
      role="menu"
      {...props}
    />
  )
}

export function DropdownMenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />
}

export function DropdownMenuItem({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const menu = useDropdownMenu()
  return (
    <button
      className={cn('flex min-h-8 w-full items-center rounded-sm px-2 text-left text-sm hover:bg-muted', className)}
      onClick={(event) => {
        props.onClick?.(event)
        menu.setOpen(false)
      }}
      role="menuitem"
      type="button"
      {...props}
    />
  )
}

function useDropdownMenu() {
  const menu = useContext(DropdownContext)
  if (!menu) throw new Error('DropdownMenu components must be rendered inside DropdownMenu.')
  return menu
}
