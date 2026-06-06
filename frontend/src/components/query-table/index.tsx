/**
 * Copyright 2025 RAIDS Lab
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// i18n-processed-v1.1.0
// Modified code
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { UseQueryResult } from '@tanstack/react-query'
import {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  SortingState,
  Updater,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { GridIcon } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalStorage } from 'usehooks-ts'

import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import LoadingCircleIcon from '@/components/icon/loading-circle-icon'
import PageTitle from '@/components/layout/page-title'

import usePaginationWithStorage from '@/hooks/use-pagination-with-storage'

import { cn } from '@/lib/utils'

import { DataTablePagination, MultipleHandler } from './pagination'
import { DataTableToolbar, DataTableToolbarConfig } from './toolbar'

const MINIMAL_GREY_500_CHANNEL = '145 158 171'
const MINIMAL_GREY_900_CHANNEL = '20 26 33'
const MINIMAL_PRIMARY_CHANNEL = '0 167 111'

const resolveUpdater = <TState,>(updater: Updater<TState>, state: TState) => {
  return typeof updater === 'function' ? (updater as (state: TState) => TState)(state) : updater
}

interface DataTableProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
  info?: {
    title?: string
    description: string
  }
  storageKey: string
  query: UseQueryResult<TData[], Error>
  columns: ColumnDef<TData, TValue>[]
  toolbarConfig?: DataTableToolbarConfig
  multipleHandlers?: MultipleHandler<TData>[]
  briefChildren?: React.ReactNode
  withI18n?: boolean
  className?: string
  initialColumnVisibility?: VisibilityState
  surface?: 'default' | 'panel'
}

export function DataTable<TData, TValue>({
  info,
  storageKey,
  query,
  columns,
  toolbarConfig,
  multipleHandlers,
  children,
  briefChildren,
  withI18n = false,
  className,
  initialColumnVisibility = {},
  surface = 'default',
}: DataTableProps<TData, TValue>) {
  const theme = useTheme()
  const { t } = useTranslation()
  const isPanel = surface === 'panel'
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility)
  const [columnFilters, setColumnFilters] = useLocalStorage<ColumnFiltersState>(
    `${storageKey}-column-filters`,
    []
  )
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const { data: queryData, isLoading, dataUpdatedAt, refetch } = query
  const updatedAt = new Date(dataUpdatedAt).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const [pagination, setPagination] = usePaginationWithStorage(storageKey)

  const data = useMemo(() => {
    if (!queryData || isLoading) return []
    return queryData
  }, [queryData, isLoading])

  const columnsWithSelection = useMemo(() => {
    if (!multipleHandlers || !columns || multipleHandlers.length === 0) {
      return columns
    }
    return [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            hidden={table.getRowModel().rows.length === 0}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      ...columns,
    ]
  }, [columns, multipleHandlers])

  const resetPageIndex = React.useCallback(() => {
    setPagination((state) => ({ ...state, pageIndex: 0 }))
  }, [setPagination])

  const handleSortingChange = React.useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      setSorting((state) => resolveUpdater(updater, state))
      resetPageIndex()
    },
    [resetPageIndex]
  )

  const handleColumnFiltersChange = React.useCallback<OnChangeFn<ColumnFiltersState>>(
    (updater) => {
      setColumnFilters((state) => resolveUpdater(updater, state))
      resetPageIndex()
    },
    [resetPageIndex, setColumnFilters]
  )

  const handleGlobalFilterChange = React.useCallback<OnChangeFn<string>>(
    (updater) => {
      setGlobalFilter((state) => resolveUpdater(updater, state))
      resetPageIndex()
    },
    [resetPageIndex]
  )

  const table = useReactTable({
    data: data,
    columns: columnsWithSelection,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    enableRowSelection: true,
    autoResetPageIndex: false,
    onRowSelectionChange: setRowSelection,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onGlobalFilterChange: handleGlobalFilterChange,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const pageCount = table.getPageCount()
  React.useEffect(() => {
    const lastPageIndex = Math.max(pageCount - 1, 0)
    if (pagination.pageIndex > lastPageIndex) {
      setPagination((state) => ({ ...state, pageIndex: lastPageIndex }))
    }
  }, [pageCount, pagination.pageIndex, setPagination])

  const tableContent = (
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        '& [data-slot="table-container"]': {
          overflowX: 'auto',
        },
        '& [data-slot="table"]': {
          borderCollapse: 'separate',
          borderSpacing: 0,
        },
      }}
    >
      <Table>
        <TableHeader className="bg-transparent shadow-none [&_tr]:border-b-0">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent hover:shadow-none">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className="text-muted-foreground bg-muted/45 h-12 px-4 first:rounded-tl-[20px] first:pl-5 last:rounded-tr-[20px] last:pr-5"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                className="border-border/45 hover:bg-primary/4 data-[state=selected]:bg-primary/8 hover:shadow-none"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="h-13 px-4 first:pl-5 last:pr-5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <>
              {isLoading ? (
                <TableRow className="hover:bg-transparent hover:shadow-none">
                  <TableCell colSpan={table.getAllColumns().length} className="h-52">
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <LoadingCircleIcon />
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow className="hover:bg-transparent hover:shadow-none">
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    className="text-muted-foreground/85 h-44 text-center hover:bg-transparent"
                  >
                    <Box
                      sx={{
                        py: 5,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Box
                        sx={{
                          mb: 1.5,
                          width: 52,
                          height: 52,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 999,
                          color: 'primary.dark',
                          bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.1),
                          boxShadow: `inset 0 0 0 1px ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.14)}`,
                        }}
                      >
                        <GridIcon className="size-5" />
                      </Box>
                      <Box
                        component="p"
                        sx={{
                          m: 0,
                          typography: 'body2',
                          fontWeight: 700,
                          color: 'text.secondary',
                          userSelect: 'none',
                        }}
                      >
                        {withI18n ? t('dataTable.noData') : '暂无数据'}
                      </Box>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </>
          )}
        </TableBody>
      </Table>
    </Box>
  )

  const toolbar = toolbarConfig ? (
    <DataTableToolbar
      table={table}
      config={toolbarConfig}
      isLoading={query.isLoading}
      surface={isPanel ? 'inline' : 'card'}
    >
      {!info && <>{children}</>}
    </DataTableToolbar>
  ) : null

  const paginationContent = (
    <DataTablePagination
      table={table}
      refetch={() => void refetch()}
      updatedAt={updatedAt}
      multipleHandlers={multipleHandlers}
      surface={isPanel ? 'inline' : 'card'}
    />
  )

  if (isPanel) {
    return (
      <Card
        className={cn(className)}
        sx={{
          p: { xs: 2, md: 2.5 },
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 3,
          border: `1px solid ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.12)}`,
          bgcolor: 'background.paper',
          backgroundImage: `linear-gradient(180deg, ${varAlpha('255 255 255', 0.98)}, ${varAlpha(
            '255 255 255',
            0.92
          )})`,
          boxShadow: `0 0 2px 0 ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16)}, 0 24px 48px -30px ${varAlpha(
            MINIMAL_GREY_900_CHANNEL,
            0.3
          )}`,
          '&::before': {
            position: 'absolute',
            inset: 0,
            content: '""',
            pointerEvents: 'none',
            background: `radial-gradient(circle at 24px 0, ${varAlpha(
              MINIMAL_PRIMARY_CHANNEL,
              0.1
            )}, transparent 34%)`,
          },
        }}
      >
        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            gap: 2,
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          {info && (
            <Box sx={{ minWidth: 0 }}>
              {info.title && (
                <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.35 }}>
                  {info.title}
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                {info.description}
              </Typography>
            </Box>
          )}
          {children && (
            <Box
              sx={{
                gap: 1,
                display: 'flex',
                minWidth: 0,
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: { xs: 'flex-start', sm: 'flex-end' },
              }}
            >
              {children}
            </Box>
          )}
        </Box>
        {briefChildren && <Box sx={{ position: 'relative', zIndex: 1 }}>{briefChildren}</Box>}
        {toolbar}
        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            overflow: 'hidden',
            borderRadius: 2.5,
            border: `1px solid ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.1)}`,
            bgcolor: 'background.paper',
            boxShadow: `inset 0 0 0 1px ${varAlpha('255 255 255', 0.6)}`,
          }}
        >
          {tableContent}
        </Box>
        {paginationContent}
      </Card>
    )
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {info && (
        <PageTitle title={info.title} description={info.description}>
          {children}
        </PageTitle>
      )}
      {briefChildren && <>{briefChildren}</>}
      {toolbar}
      <Card
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 2.5,
          border: `1px solid ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.12)}`,
          bgcolor: 'background.paper',
          backgroundImage: `linear-gradient(180deg, ${varAlpha('255 255 255', 0.96)}, ${varAlpha(
            '255 255 255',
            0.9
          )})`,
          boxShadow: `0 0 2px 0 ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16)}, 0 18px 36px -24px ${varAlpha(
            MINIMAL_GREY_900_CHANNEL,
            0.26
          )}`,
          transition: theme.transitions.create(['border-color', 'box-shadow'], {
            duration: theme.transitions.duration.shorter,
          }),
          '&:hover': {
            borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.18),
            boxShadow: `0 0 2px 0 ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.12)}, 0 22px 42px -26px ${varAlpha(
              MINIMAL_GREY_900_CHANNEL,
              0.32
            )}`,
          },
        }}
      >
        {tableContent}
      </Card>
      {paginationContent}
    </div>
  )
}
