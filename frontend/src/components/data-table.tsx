'use client'

import * as React from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowData,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

// Розширюємо типи колонок TanStack: дозволяємо задавати вирівнювання
// і додаткові класи для th/td прямо у визначенні колонки (column.meta)
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    // Вирівнювання вмісту колонки (заголовок + комірки)
    align?: 'left' | 'right' | 'center'
    // Додаткові класи на <th> (зазвичай ширина: 'w-32')
    headClassName?: string
    // Додаткові класи на <td>
    cellClassName?: string
  }
}

// TData обмежено { id } — використовуємо його як стабільний ключ рядка
interface DataTableProps<TData extends { id: number | string }> {
  columns: ColumnDef<TData>[]
  data: TData[]
  // Текст пошуку (global filter). Керується ззовні — у тулбарі сторінки
  globalFilter?: string
  // Що показати, коли рядків нема (нема даних / нічого не знайдено)
  emptyMessage: React.ReactNode
  // Початкове сортування (опц.), напр. [{ id: 'name', desc: false }]
  initialSorting?: SortingState
}

export function DataTable<TData extends { id: number | string }>({
  columns, data, globalFilter = '', emptyMessage, initialSorting = [],
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Перший клік по будь-якій колонці — сортує за зростанням (за замовч. числові
    // колонки TanStack починає з спадання, що неінтуїтивно)
    sortDescFirst: false,
    // includesString — підрядковий пошук по строковому представленню значень колонок
    globalFilterFn: 'includesString',
    // Стабільний ключ рядка — id сутності (а не індекс)
    getRowId: (row) => String(row.id),
  })

  const colSpan = table.getVisibleLeafColumns().length

  return (
    <Table>
      <TableHeader className="sticky top-0 bg-background z-10">
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((header) => {
              const { align = 'left', headClassName } = header.column.columnDef.meta ?? {}
              const canSort = header.column.getCanSort()
              const sorted = header.column.getIsSorted()
              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    align === 'right' && 'text-right',
                    align === 'center' && 'text-center',
                    headClassName,
                  )}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'flex w-full items-center gap-1 select-none hover:text-foreground transition-colors',
                        align === 'right' && 'justify-end',
                        align === 'center' && 'justify-center',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc'
                        ? <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                        : sorted === 'desc'
                          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          : <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-muted/50">
              {row.getVisibleCells().map((cell) => {
                const { align = 'left', cellClassName } = cell.column.columnDef.meta ?? {}
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      cellClassName,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                )
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
