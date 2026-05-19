import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useId } from 'react'
import { cn } from '@/lib/utils'

type TabsContextValue = {
  idBase: string
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

type TabsProps = HTMLAttributes<HTMLDivElement> & Omit<TabsContextValue, 'idBase'>

export function Tabs({ value, setValue, ...props }: TabsProps) {
  const generatedId = useId()
  return (
    <TabsContext.Provider value={{ idBase: generatedId, value, setValue }}>
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
  const triggerId = `${tabs.idBase}-tab-${value}`
  const panelId = `${tabs.idBase}-panel-${value}`
  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground',
        active && 'bg-background text-foreground shadow-sm',
        className,
      )}
      id={triggerId}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tablist = event.currentTarget.closest('[role="tablist"]')
        const triggers = Array.from(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []).filter(
          (trigger) => !trigger.disabled,
        )
        const currentIndex = triggers.indexOf(event.currentTarget)
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? triggers.length - 1
              : event.key === 'ArrowRight'
                ? (currentIndex + 1) % triggers.length
                : (currentIndex - 1 + triggers.length) % triggers.length
        const nextTrigger = triggers[nextIndex]
        if (!nextTrigger) return
        event.preventDefault()
        nextTrigger.focus()
        nextTrigger.click()
      }}
      onClick={() => tabs.setValue(value)}
      role="tab"
      tabIndex={active ? 0 : -1}
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
  return (
    <div
      aria-labelledby={`${tabs.idBase}-tab-${value}`}
      id={`${tabs.idBase}-panel-${value}`}
      role="tabpanel"
      {...props}
    />
  )
}

function useTabs() {
  const tabs = useContext(TabsContext)
  if (!tabs) throw new Error('Tabs components must be rendered inside Tabs.')
  return tabs
}
