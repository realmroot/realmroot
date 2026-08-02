import type { ReactNode } from 'react'

export function SettingRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-16 gap-2 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(150px,0.8fr)_minmax(0,1.4fr)] sm:items-start sm:gap-6">
      <span className="text-sm font-semibold leading-6">{label}</span>
      <span className="min-w-0 break-words text-sm leading-6 text-muted-foreground">{value}</span>
    </div>
  )
}
