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
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import MenuItem from '@mui/material/MenuItem'
import Select, { SelectChangeEvent } from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import { Column } from '@tanstack/react-table'
import { varAlpha } from 'minimal-shared/utils'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const MINIMAL_GREY_500_CHANNEL = '145 158 171'
const MINIMAL_GREY_900_CHANNEL = '20 26 33'
const MINIMAL_PRIMARY_CHANNEL = '0 167 111'
const CLEAR_FILTER_VALUE = '__clear_filter__'

export interface DataTableFacetedFilterOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title?: string
  options?: DataTableFacetedFilterOption[]
  defaultValues?: string[]
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options: rawOptions,
  defaultValues,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const facets = column?.getFacetedUniqueValues()
  const selectedValues = new Set(column?.getFilterValue() as string[])
  const selectedArray = Array.from(selectedValues)
  const selectId = `filter-${column?.id ?? title ?? 'table'}-select`
  const hasSelection = selectedArray.length > 0

  // set default filter option
  useEffect(() => {
    if (defaultValues) {
      column?.setFilterValue(defaultValues)
    }
  }, [defaultValues, column])

  const options = useMemo(() => {
    // 如果没有 Options，则从 facets 中生成
    if (!rawOptions || rawOptions.length === 0) {
      return facets
        ? Array.from(facets.keys())
            .filter((value) => !!value)
            .map(
              (value) =>
                ({
                  label: value,
                  value,
                }) as DataTableFacetedFilterOption
            )
        : []
    }
    return rawOptions
  }, [facets, rawOptions])

  const visibleOptions = facets
    ? options.filter((option) => 0 < (facets.get(option.value) || 0))
    : options

  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value
    const nextValues = typeof value === 'string' ? value.split(',') : value

    if (nextValues.includes(CLEAR_FILTER_VALUE)) {
      column?.setFilterValue(undefined)
      return
    }

    column?.setFilterValue(nextValues.length ? nextValues : undefined)
  }

  return (
    <FormControl
      disabled={!column}
      size="small"
      sx={{
        flexShrink: 0,
        width: { xs: 1, sm: 184 },
      }}
    >
      <Select
        multiple
        displayEmpty
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        value={selectedArray}
        onChange={handleChange}
        renderValue={(selected) => {
          const labels = selected
            .map((value) => options.find((option) => option.value === value)?.label)
            .filter(Boolean)
          const displayText = labels.length === 0 ? title : labels[0]
          const extraCount = Math.max(labels.length - 1, 0)

          return (
            <Box
              sx={{
                gap: 0.75,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Box
                component="span"
                sx={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: hasSelection ? 'text.primary' : 'text.secondary',
                }}
              >
                {displayText}
              </Box>
              {extraCount > 0 && (
                <Box
                  component="span"
                  sx={{
                    minWidth: 20,
                    px: 0.625,
                    py: 0.125,
                    borderRadius: 999,
                    textAlign: 'center',
                    typography: 'caption',
                    fontWeight: 800,
                    color: 'primary.dark',
                    bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.12),
                  }}
                >
                  +{extraCount}
                </Box>
              )}
            </Box>
          )
        }}
        inputProps={{ id: selectId, 'aria-label': title }}
        sx={{
          minHeight: 38,
          borderRadius: 999,
          color: hasSelection || open ? 'primary.dark' : 'text.secondary',
          background:
            hasSelection || open
              ? `linear-gradient(135deg, ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.14)}, ${varAlpha(
                  MINIMAL_PRIMARY_CHANNEL,
                  0.06
                )})`
              : varAlpha(MINIMAL_GREY_500_CHANNEL, 0.04),
          transition: (theme) =>
            theme.transitions.create(['background-color', 'box-shadow', 'color', 'transform'], {
              duration: theme.transitions.duration.shorter,
            }),
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: `0 8px 18px -14px ${varAlpha(MINIMAL_GREY_900_CHANNEL, 0.36)}`,
          },
          '& .MuiSelect-select': {
            minHeight: 'unset',
            display: 'flex',
            alignItems: 'center',
            py: 1,
            pr: 4,
            pl: 1.5,
            fontSize: 13,
            fontWeight: 700,
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor:
              hasSelection || open
                ? varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.3)
                : varAlpha(MINIMAL_GREY_500_CHANNEL, 0.16),
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.4),
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.52),
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.12)}`,
          },
          '& .MuiSelect-icon': {
            right: 12,
            color: hasSelection || open ? 'primary.dark' : 'text.disabled',
            transition: (theme) =>
              theme.transitions.create(['color', 'transform'], {
                duration: theme.transitions.duration.shorter,
              }),
          },
          '& .MuiSelect-iconOpen': {
            transform: 'rotate(180deg)',
          },
        }}
        MenuProps={{
          anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
          transformOrigin: { vertical: 'top', horizontal: 'left' },
          slotProps: {
            paper: {
              sx: {
                mt: 1,
                minWidth: 220,
                maxHeight: 320,
                borderRadius: 2,
                border: `1px solid ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.12)}`,
                boxShadow: `0 0 2px 0 ${varAlpha(
                  MINIMAL_GREY_500_CHANNEL,
                  0.16
                )}, 0 18px 36px -18px ${varAlpha(MINIMAL_GREY_900_CHANNEL, 0.28)}`,
              },
            },
          },
        }}
      >
        {hasSelection && (
          <>
            <MenuItem value={CLEAR_FILTER_VALUE}>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.dark' }}>
                {t('dataTableFacetedFilter.clearFilter')}
              </Typography>
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
          </>
        )}

        {visibleOptions.length === 0 && (
          <MenuItem disabled>
            <Typography variant="body2" color="text.disabled">
              {t('dataTableFacetedFilter.noResults')}
            </Typography>
          </MenuItem>
        )}

        {visibleOptions.map((option) => {
          const isSelected = selectedValues.has(option.value)
          const count = facets?.get(option.value)

          return (
            <MenuItem
              key={option.value}
              value={option.value}
              selected={isSelected}
              sx={{
                '&.Mui-selected': {
                  color: 'primary.dark',
                  bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.08),
                },
              }}
            >
              <Checkbox disableRipple size="small" checked={isSelected} />
              {option.icon && <option.icon className="text-muted-foreground size-4" />}
              <Box
                component="span"
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.label}
              </Box>
              {count && (
                <Box
                  component="span"
                  sx={{
                    ml: 1,
                    minWidth: 28,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 999,
                    textAlign: 'center',
                    typography: 'caption',
                    fontWeight: 700,
                    color: isSelected ? 'primary.dark' : 'text.disabled',
                    bgcolor: isSelected
                      ? varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.1)
                      : varAlpha(MINIMAL_GREY_500_CHANNEL, 0.08),
                  }}
                >
                  {count}
                </Box>
              )}
            </MenuItem>
          )
        })}
      </Select>
    </FormControl>
  )
}
