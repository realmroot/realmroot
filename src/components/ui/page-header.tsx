import type { ReactNode } from 'react'

type PageHeaderProps = {
  action?: ReactNode
  breadcrumb?: string[]
  description: string
  eyebrow: string
  title: string
}

export function PageHeader({ action, breadcrumb, description, eyebrow, title }: PageHeaderProps) {
  const breadcrumbCounts = new Map<string, number>()

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((crumb, index) => {
              const occurrence = breadcrumbCounts.get(crumb) ?? 0
              breadcrumbCounts.set(crumb, occurrence + 1)
              return (
                <span className="inline-flex items-center gap-1" key={`${crumb}-${occurrence}`}>
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  <span>{crumb}</span>
                </span>
              )
            })}
          </div>
        ) : null}
        <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">{eyebrow}</p>
        <h1 className="text-xl font-semibold leading-7 tracking-normal">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
