import Box from '@mui/material/Box'
import TablePagination, { TablePaginationProps } from '@mui/material/TablePagination'

type TablePaginationCustomProps = TablePaginationProps

export function TablePaginationCustom({
  rowsPerPageOptions = [10, 20, 50, 100, 200],
  sx,
  ...other
}: TablePaginationCustomProps) {
  return (
    <Box sx={{ position: 'relative' }}>
      <TablePagination
        component="div"
        rowsPerPageOptions={rowsPerPageOptions}
        sx={[
          {
            borderTopColor: 'transparent',
            '& .MuiTablePagination-toolbar': {
              minHeight: 40,
              px: 0,
            },
            '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
              my: 0,
              typography: 'body2',
              color: 'text.secondary',
            },
            '& .MuiTablePagination-select': {
              typography: 'subtitle2',
            },
            '& .MuiTablePagination-actions': {
              ml: 1,
            },
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      />
    </Box>
  )
}
