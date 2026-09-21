import type { SxProps, Theme } from '@mui/material';

// All columns share the available space; no fixed pixel widths or hidden columns.
export const transferColumnWidths = ['19%', '14%', '7%', '11%', '9%', '11%', '11%', '9%', '9%'];

export const transferTableSx: SxProps<Theme> = {
  tableLayout: 'fixed',
  width: '100%',
  '& .MuiTableCell-root': {
    px: { xs: 0.5, lg: 1 },
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    fontSize: '0.75rem',
  },
  '& .MuiChip-root': { maxWidth: '100%', height: 'auto', minHeight: 24, fontSize: '0.75rem' },
  '& .MuiChip-label': { px: 0.5, py: 0.25, whiteSpace: 'normal', overflowWrap: 'anywhere' },
  '& .MuiChip-icon': { flexShrink: 0, ml: 0.5, mr: 0 },
  '@container (max-width: 850px)': {
    '& .MuiChip-root svg': { display: 'none' },
  },
};
