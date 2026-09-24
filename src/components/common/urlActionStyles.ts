import type { Theme } from '@mui/material/styles';

/** Local contrast treatment for URL workflows, without changing the app theme. */
export const urlActionStyles = (theme: Theme) => ({
  borderRadius: '999px',
  '&.MuiButton-text:not(.Mui-disabled)': {
    color: theme.palette.mode === 'light' ? '#995700' : theme.palette.primary.main,
  },
});
