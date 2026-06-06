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
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { Row, Table } from '@tanstack/react-table'
import { RefreshCcw } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { TablePaginationCustom } from '@/components/minimal-ui/table-pagination-custom'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui-custom/alert-dialog'

import TooltipButton from '../button/tooltip-button'

const MINIMAL_GREY_500_CHANNEL = '145 158 171'
const MINIMAL_GREY_900_CHANNEL = '20 26 33'
const MINIMAL_PRIMARY_CHANNEL = '0 167 111'

export interface MultipleHandler<TData> {
  title: (rows: Row<TData>[]) => string
  description: (rows: Row<TData>[]) => React.ReactNode
  handleSubmit: (rows: Row<TData>[]) => void
  icon: React.ReactNode
  isDanger?: boolean
}

interface DataTablePaginationProps<TData> {
  updatedAt: string
  refetch: () => void
  table: Table<TData>
  multipleHandlers?: MultipleHandler<TData>[]
  totalCount?: number
  surface?: 'card' | 'inline'
}

export function DataTablePagination<TData>({
  updatedAt,
  refetch,
  table,
  multipleHandlers,
  totalCount,
  surface = 'card',
}: DataTablePaginationProps<TData>) {
  const { t } = useTranslation()
  const isInline = surface === 'inline'
  const pagination = table.getState().pagination
  const selectedRows = table.getFilteredSelectedRowModel().rows
  const filteredRowsCount = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const fallbackManualCount = pageCount > -1 ? pageCount * pagination.pageSize : -1
  const count =
    totalCount ?? (table.options.manualPagination ? fallbackManualCount : filteredRowsCount)
  const rowsPerPageLabel = t('dataTablePagination.itemsPerPage', { count: 0 })
    .replace('0', '')
    .trim()

  return (
    <Box
      sx={{
        p: isInline ? { xs: 1, md: 1.25 } : 2,
        gap: isInline ? 1.25 : 2,
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { xs: 'stretch', md: 'center' },
        justifyContent: 'space-between',
        border: '1px solid',
        borderColor: isInline
          ? varAlpha(MINIMAL_GREY_500_CHANNEL, 0.08)
          : varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16),
        borderRadius: isInline ? 2.5 : 2,
        bgcolor: isInline ? varAlpha(MINIMAL_GREY_500_CHANNEL, 0.035) : 'background.paper',
        boxShadow: isInline
          ? 'none'
          : `0 0 2px 0 ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16)}, 0 16px 32px -24px ${varAlpha(MINIMAL_GREY_900_CHANNEL, 0.22)}`,
      }}
    >
      <Box
        sx={{
          gap: 1,
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {selectedRows.length > 0 &&
          multipleHandlers &&
          multipleHandlers.length > 0 &&
          multipleHandlers.map((multipleHandler, index) => (
            <AlertDialog key={index}>
              <AlertDialogTrigger asChild>
                <TooltipButton
                  variant="outline"
                  size="icon"
                  className="size-9"
                  tooltipContent={multipleHandler.title(selectedRows)}
                >
                  {multipleHandler.icon}
                </TooltipButton>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{multipleHandler.title(selectedRows)}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {multipleHandler.description(selectedRows)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('dataTablePagination.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      variant={multipleHandler.isDanger ? 'destructive' : 'default'}
                      onClick={() => {
                        multipleHandler.handleSubmit(selectedRows)
                        table.resetRowSelection()
                      }}
                    >
                      {t('dataTablePagination.confirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              </AlertDialogContent>
            </AlertDialog>
          ))}

        <Tooltip title={t('dataTablePagination.refresh')}>
          <IconButton
            size="small"
            onClick={refetch}
            sx={{
              width: 36,
              height: 36,
              color: 'text.secondary',
              bgcolor: varAlpha(MINIMAL_GREY_500_CHANNEL, 0.08),
              '&:hover': {
                color: 'primary.dark',
                bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.08),
              },
            }}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </IconButton>
        </Tooltip>

        <Box
          component="p"
          sx={{
            m: 0,
            minWidth: 0,
            typography: 'caption',
            color: 'text.secondary',
            fontWeight: 600,
          }}
        >
          {t('dataTablePagination.updatedAt', { time: updatedAt })}
          {', '}
          {selectedRows.length === 0
            ? t('dataTablePagination.totalItems', { count: totalCount ?? filteredRowsCount })
            : t('dataTablePagination.selectedItems', {
                selected: selectedRows.length,
                total: totalCount ?? filteredRowsCount,
              })}
        </Box>
      </Box>

      <TablePaginationCustom
        page={pagination.pageIndex}
        count={count}
        rowsPerPage={pagination.pageSize}
        onPageChange={(_, page) => table.setPageIndex(page)}
        onRowsPerPageChange={(event) => {
          table.setPageSize(Number(event.target.value))
          table.setPageIndex(0)
        }}
        labelRowsPerPage={rowsPerPageLabel}
        labelDisplayedRows={({ from, to, count: total }) =>
          total === -1 ? `${from}-${to}` : `${from}-${to} / ${total}`
        }
      />
    </Box>
  )
}
