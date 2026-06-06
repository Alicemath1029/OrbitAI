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
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Typography from '@mui/material/Typography'
import { Table } from '@tanstack/react-table'
import { Settings2Icon } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CustomPopover } from '@/components/minimal-ui/custom-popover'

const MINIMAL_PRIMARY_CHANNEL = '0 167 111'

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>
  getHeader: (key: string) => string
}

export function DataTableViewOptions<TData>({
  table,
  getHeader,
}: DataTableViewOptionsProps<TData>) {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const open = Boolean(anchorEl)

  const columns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide())

  return (
    <>
      <Button
        type="button"
        color="inherit"
        size="small"
        startIcon={<Settings2Icon size={16} />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{
          ml: 'auto',
          minHeight: 36,
          px: 1.25,
          color: open ? 'primary.dark' : 'text.secondary',
          bgcolor: open ? varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.08) : 'transparent',
          '&:hover': {
            color: 'primary.dark',
            bgcolor: varAlpha(MINIMAL_PRIMARY_CHANNEL, 0.08),
          },
          '& .MuiButton-startIcon': {
            mr: 0.5,
          },
        }}
      >
        <Typography component="span" sx={{ fontSize: 12, fontWeight: 700 }}>
          {t('dataTableViewOptions.viewButtonText')}
        </Typography>
      </Button>

      <CustomPopover
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          arrow: { placement: 'top-right' },
          paper: { sx: { width: 220 } },
        }}
      >
        <MenuList sx={{ p: 0.5 }}>
          <MenuItem disabled>
            <Typography variant="caption">{t('dataTableViewOptions.viewLabel')}</Typography>
          </MenuItem>
          <Divider sx={{ my: 0.5 }} />
          {columns.map((column) => {
            const visible = column.getIsVisible()

            return (
              <MenuItem
                key={column.id}
                selected={visible}
                onClick={() => column.toggleVisibility(!visible)}
              >
                <Checkbox disableRipple checked={visible} size="small" />
                <ListItemText
                  primary={getHeader(column.id)}
                  slotProps={{
                    primary: {
                      noWrap: true,
                      variant: 'body2',
                      sx: { textTransform: 'capitalize' },
                    },
                  }}
                />
              </MenuItem>
            )
          })}
        </MenuList>
      </CustomPopover>
    </>
  )
}
