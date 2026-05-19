import type { ReactNode } from 'react'

export function SettingRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-sm font-medium leading-5">{label}</span>
      <span className="break-words text-sm leading-5 text-muted-foreground sm:max-w-[70%] sm:text-right">{value}</span>
    </div>
  )
}
