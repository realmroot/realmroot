import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

type TabsProps = HTMLAttributes<HTMLDivElement> & TabsContextValue

export function Tabs({ value, setValue, ...props }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div {...props} />
    </TabsContext.Provider>
  )
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex rounded-lg bg-muted p-1', className)} role="tablist" {...props} />
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string
}

export function TabsTrigger({ className, value, ...props }: TabsTriggerProps) {
  const tabs = useTabs()
  const active = tabs.value === value
  return (
    <button
      aria-selected={active}
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground',
        active && 'bg-background text-foreground shadow-sm',
        className,
      )}
      onClick={() => tabs.setValue(value)}
      role="tab"
      type="button"
      {...props}
    />
  )
}

type TabsContentProps = HTMLAttributes<HTMLDivElement> & {
  value: string
  children: ReactNode
}

export function TabsContent({ value, ...props }: TabsContentProps) {
  const tabs = useTabs()
  if (tabs.value !== value) return null
  return <div role="tabpanel" {...props} />
}

function useTabs() {
  const tabs = useContext(TabsContext)
  if (!tabs) throw new Error('Tabs components must be rendered inside Tabs.')
  return tabs
}
