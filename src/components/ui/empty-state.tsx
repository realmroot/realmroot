import { ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent } from './card'

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
  const content = (
    <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  )

  if (!framed) return content

  return (
    <Card className="border-dashed">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  )
}
