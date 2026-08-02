import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function RealmrootMark({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span aria-hidden="true" className={cn('realmrootMark', className)} {...props}>
      <i />
      <i />
      <i />
    </span>
  )
}

export function RealmrootWordmark({ className, context }: { className?: string; context?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <RealmrootMark />
      <strong className="truncate text-[15px] font-semibold tracking-[-0.02em]">realmroot</strong>
      {context ? (
        <>
          <span aria-hidden="true" className="realmrootWordmarkContext h-4 w-px bg-border" />
          <span className="realmrootWordmarkContext truncate text-sm font-medium text-muted-foreground">{context}</span>
        </>
      ) : null}
    </span>
  )
}
