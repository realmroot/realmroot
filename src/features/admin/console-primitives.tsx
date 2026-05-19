import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function ConsoleToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('consoleToolbar flex flex-wrap items-center justify-between gap-3', className)} {...props} />
  )
}

export function ConsoleDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('consoleDetailStack grid', className)} {...props} />
}

export function ConsoleActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('stickyActionBar', className)} {...props} />
}
