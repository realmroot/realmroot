import { ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'

export function EmptyState({
  action,
  description,
  framed = true,
  icon = <ListChecks aria-hidden="true" className="size-4" />,
  title,
}: {
  action?: ReactNode
  description: string
  framed?: boolean
  icon?: ReactNode
  title: string
}) {
  return (
    <Empty
      className={cn(
        'items-start gap-4 text-left sm:flex-row sm:items-center sm:justify-between',
        framed ? 'border p-4' : 'p-0',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <EmptyMedia className="mb-0" variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyHeader className="min-w-0 items-start gap-1">
          <EmptyTitle className="font-semibold leading-5">{title}</EmptyTitle>
          <EmptyDescription className="max-w-2xl leading-5 text-pretty">{description}</EmptyDescription>
        </EmptyHeader>
      </div>
      {action ? <EmptyContent className="w-auto shrink-0 items-stretch">{action}</EmptyContent> : null}
    </Empty>
  )
}
