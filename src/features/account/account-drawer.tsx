import { type ComponentProps, useRef } from 'react'
import { SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// All account detail flows share the same right-side surface and keyboard behavior.
export {
  Sheet as Dialog,
  SheetDescription as DialogDescription,
  SheetFooter as DialogFooter,
  SheetHeader as DialogHeader,
  SheetTitle as DialogTitle,
} from '@/components/ui/sheet'

export function DialogContent({
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof SheetContent>) {
  const opener = useRef<HTMLElement | null>(null)
  return (
    <SheetContent
      {...props}
      className={cn('accountDetailDrawer', className)}
      side="right"
      onOpenAutoFocus={(event) => {
        opener.current = document.activeElement as HTMLElement
        onOpenAutoFocus?.(event)
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        if (!event.defaultPrevented && opener.current?.isConnected) {
          event.preventDefault()
          opener.current.focus()
        }
      }}
    />
  )
}
