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
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import { Table } from '@tanstack/react-table'
import { SearchIcon, XIcon } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import { useTranslation } from 'react-i18next'

import { DataTableFacetedFilter, DataTableFacetedFilterOption } from './faceted-filter'
import { DataTableViewOptions } from './view-options'

const MINIMAL_GREY_500_CHANNEL = '145 158 171'
const MINIMAL_GREY_900_CHANNEL = '20 26 33'
const MINIMAL_PRIMARY_CHANNEL = '0 167 111'

export type DataTableToolbarConfig = {
  filterOptions: readonly {
    key: string
    title: string
    option?: DataTableFacetedFilterOption[]
    defaultValues?: string[]
  }[]
  getHeader: (key: string) => string
} & (
  | {
      filterInput: { placeholder: string; key: string }
      globalSearch?: undefined
    }
  | {
      filterInput?: undefined
      globalSearch: { enabled: boolean; placeholder?: string }
    }
)

interface DataTableToolbarProps<TData> extends React.HTMLAttributes<HTMLDivElement> {
  table: Table<TData>
  config: DataTableToolbarConfig
  isLoading: boolean
  surface?: 'card' | 'inline'
}

export function DataTableToolbar<TData>({
  table,
  config: { filterInput, filterOptions, getHeader, globalSearch },
  isLoading,
  children,
  surface = 'card',
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation()
  const isInline = surface === 'inline'
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    (globalSearch?.enabled && Boolean(table.getState().globalFilter))

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
        bgcolor: 'background.paper',
        backgroundImage: isInline
          ? `linear-gradient(135deg, ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.05)}, ${varAlpha(
              MINIMAL_GREY_500_CHANNEL,
              0.04
            )})`
          : 'none',
        boxShadow: isInline
          ? 'none'
          : `0 0 2px 0 ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16)}, 0 16px 32px -24px ${varAlpha(MINIMAL_GREY_900_CHANNEL, 0.22)}`,
      }}
    >
      <Box
        sx={{
          gap: isInline ? 1 : 2,
          width: 1,
          minWidth: 0,
          display: 'flex',
          flexGrow: 1,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {children}
        {(globalSearch?.enabled || filterInput) && (
          <Box sx={{ width: { xs: 1, sm: 'auto' }, minWidth: 0 }}>
            {globalSearch?.enabled && (
              <TextField
                hiddenLabel
                size="small"
                placeholder={
                  globalSearch.placeholder ?? t('dataTableToolbar.globalSearchPlaceholder')
                }
                value={table.getState().globalFilter || ''}
                onChange={(event) => table.setGlobalFilter(event.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon className="text-muted-foreground size-4" />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{
                  width: { xs: '100%', sm: 150, lg: 250 },
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 999,
                    bgcolor: varAlpha(MINIMAL_GREY_500_CHANNEL, 0.04),
                    transition: (theme) =>
                      theme.transitions.create(['background-color', 'box-shadow'], {
                        duration: theme.transitions.duration.shorter,
                      }),
                    '& fieldset': {
                      borderColor: varAlpha(MINIMAL_GREY_500_CHANNEL, 0.14),
                    },
                    '&:hover fieldset': {
                      borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.32),
                    },
                    '&.Mui-focused': {
                      bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.06),
                      boxShadow: `0 0 0 3px ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.1)}`,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.48),
                    },
                  },
                  '& .MuiInputBase-input': {
                    fontSize: 13,
                    fontWeight: 650,
                  },
                }}
              />
            )}
            {filterInput && (
              <TextField
                hiddenLabel
                size="small"
                placeholder={filterInput.placeholder}
                value={(table.getColumn(filterInput.key)?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn(filterInput.key)?.setFilterValue(event.target.value)
                }
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon className="text-muted-foreground size-4" />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{
                  width: { xs: '100%', sm: 150, lg: 250 },
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 999,
                    bgcolor: varAlpha(MINIMAL_GREY_500_CHANNEL, 0.04),
                    transition: (theme) =>
                      theme.transitions.create(['background-color', 'box-shadow'], {
                        duration: theme.transitions.duration.shorter,
                      }),
                    '& fieldset': {
                      borderColor: varAlpha(MINIMAL_GREY_500_CHANNEL, 0.14),
                    },
                    '&:hover fieldset': {
                      borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.32),
                    },
                    '&.Mui-focused': {
                      bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.06),
                      boxShadow: `0 0 0 3px ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.1)}`,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.48),
                    },
                  },
                  '& .MuiInputBase-input': {
                    fontSize: 13,
                    fontWeight: 650,
                  },
                }}
              />
            )}
          </Box>
        )}
        {filterOptions.map(
          (filterOption) =>
            table.getColumn(filterOption.key) && (
              <DataTableFacetedFilter
                key={filterOption.key}
                column={table.getColumn(filterOption.key)}
                title={filterOption.title}
                options={filterOption.option}
                defaultValues={filterOption.defaultValues}
              />
            )
        )}
        {isFiltered && !isLoading && (
          <Tooltip title={t('dataTableToolbar.clearFiltersButtonTitle')}>
            <IconButton
              size="small"
              type="button"
              onClick={() => {
                table.resetColumnFilters()
                if (globalSearch?.enabled) {
                  table.setGlobalFilter('')
                }
              }}
              sx={{
                width: 36,
                height: 36,
                color: 'primary.dark',
                bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.08),
                '&:hover': {
                  bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.14),
                },
              }}
            >
              <XIcon className="size-4" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, alignSelf: { xs: 'flex-end', md: 'center' } }}>
        <DataTableViewOptions table={table} getHeader={getHeader} />
      </Box>
    </Box>
  )
}
