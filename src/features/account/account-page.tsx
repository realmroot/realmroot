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

export function AccountTabContent({ children, value }: { children: ReactNode; value: string }) {
  return (
    <TabsContent className="mt-5" value={value}>
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
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="accountObjectSection">
      <header>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  )
}
