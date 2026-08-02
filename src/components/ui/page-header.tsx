import type { ReactNode } from 'react'

type PageHeaderProps = {
  action?: ReactNode
  description: string
  title: string
}

export function PageHeader({ action, description, title }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground text-pretty">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}
