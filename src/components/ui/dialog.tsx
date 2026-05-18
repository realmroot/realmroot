import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type DialogProps = {
  children: ReactNode
  open: boolean
}

export function Dialog({ children, open }: DialogProps) {
  if (!open) return null
  return <>{children}</>
}

export function DialogContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
      <div
        aria-modal="true"
        className={cn(
          'max-h-[90dvh] w-full max-w-xl overflow-auto rounded-lg border border-border bg-background shadow-lg',
          className,
        )}
        role="dialog"
        {...props}
      />
    </div>
  )
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 border-b border-border p-4', className)} {...props} />
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold leading-none tracking-normal', className)} {...props} />
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-5 text-muted-foreground', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex justify-end gap-2 border-t border-border p-4', className)} {...props} />
}

export function DialogClose(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} />
}
