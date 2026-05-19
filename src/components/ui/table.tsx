import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full min-w-[44rem] caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted/40', className)} {...props} />
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('h-9 px-3 text-left align-middle text-xs font-semibold uppercase text-muted-foreground', className)}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-11 px-3 py-1.5 align-middle', className)} {...props} />
}

export function TableEmptyRow({
  colSpan,
  description,
  title,
}: {
  colSpan: number
  description: string
  title: string
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan}>
        <div className="flex min-h-24 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
          <p className="max-w-xl text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </TableCell>
    </TableRow>
  )
}
