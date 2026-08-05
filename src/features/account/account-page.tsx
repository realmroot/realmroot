import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export function AccountPageHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode
  description: string
  title: string
}) {
  return (
    <header className="accountPageHeader">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  )
}

export function AccountTabs({
  children,
  onValueChange,
  tabs,
  value,
}: {
  children: ReactNode
  onValueChange: (value: string) => void
  tabs: Array<{ label: string; value: string }>
  value: string
}) {
  return (
    <Tabs className="accountTabs" onValueChange={onValueChange} value={value}>
      <TabsList className="w-full" variant="navigation">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}

export function AccountTabContent({
  children,
  surface = false,
  value,
}: {
  children: ReactNode
  surface?: boolean
  value: string
}) {
  return (
    <TabsContent className={cn('mt-3', surface && 'accountTabPanel')} value={value}>
      {children}
    </TabsContent>
  )
}

export function AccountRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('accountRows', className)}>{children}</div>
}

export function AccountRow({
  action,
  description,
  label,
  value,
}: {
  action?: ReactNode
  description?: string
  label: ReactNode
  value?: ReactNode
}) {
  return (
    <div className="accountRow">
      <div className="accountRowLabel">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="accountRowValue">{value}</div>
      <div className="accountRowAction">{action}</div>
    </div>
  )
}

export function AccountObjectSection({
  children,
  description,
  surface = false,
  title,
}: {
  children: ReactNode
  description?: string
  surface?: boolean
  title: string
}) {
  return (
    <section className={cn('accountObjectSection', surface && 'is-surface')}>
      <header>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  )
}

export function AccountEmptyState({
  description,
  icon = <Inbox />,
  title,
}: {
  description?: string
  icon?: ReactNode
  title: string
}) {
  return (
    <div className="accountEmptyState">
      <span className="accountEmptyStateIcon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
    </div>
  )
}
