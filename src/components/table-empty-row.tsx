import { TableCell, TableRow } from '@/components/ui/table'

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
        <div className="flex min-h-28 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
          <p className="max-w-xl text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </TableCell>
    </TableRow>
  )
}
