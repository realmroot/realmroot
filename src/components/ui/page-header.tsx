import type { ReactNode } from 'react'

type PageHeaderProps = {
  action?: ReactNode
  description: string
  title: string
}

export function PageHeader({ action, description, title }: PageHeaderProps) {
  return (
    <header className="consolePageHeader flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.035em]">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground text-pretty">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}
