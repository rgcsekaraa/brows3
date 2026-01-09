'use client';

import { createTheme, ThemeOptions } from '@mui/material/styles';

// Custom color palette inspired by S3/AWS branding
const brandColors = {
  primary: {
    main: '#FF9900', // AWS Orange
    light: '#FFB84D',
    dark: '#CC7A00',
    contrastText: '#000000',
  },
  secondary: {
    main: '#232F3E', // AWS Dark Blue
    light: '#37475A',
    dark: '#161E2D',
    contrastText: '#FFFFFF',
  },
  success: {
    main: '#2E7D32',
    light: '#4CAF50',
    dark: '#1B5E20',
  },
  error: {
    main: '#D32F2F',
    light: '#EF5350',
    dark: '#C62828',
  },
  warning: {
    main: '#ED6C02',
    light: '#FF9800',
    dark: '#E65100',
  },
  info: {
    main: '#0288D1',
    light: '#03A9F4',
    dark: '#01579B',
  },
};

const baseComponents: ThemeOptions['components'] = {
  MuiButton: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 500,
        borderRadius: 8,
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 12,
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 6,
      },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
    },
  },
  MuiTextField: {
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': {
          borderRadius: 8,
        },
      },
    },
  },
};

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    ...brandColors,
    background: {
      default: '#F5F5F5',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#111111',
      secondary: '#444444',
      disabled: '#777777',
    },
    divider: '#D0D0D0',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 700 },
    h2: { fontSize: '2rem', fontWeight: 600 },
    h3: { fontSize: '1.5rem', fontWeight: 600 },
    h4: { fontSize: '1.25rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.875rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem' },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    ...baseComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #E0E0E0',
          backgroundColor: '#FFFFFF',
          color: '#1A1A1A',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#FFFFFF',
          borderRight: '1px solid #E0E0E0',
        },
      },
    },
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    ...brandColors,
    background: {
      default: '#0A0E14',
      paper: '#161E2D',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#B0B0B0',
    },
    divider: '#37475A',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 700 },
    h2: { fontSize: '2rem', fontWeight: 600 },
    h3: { fontSize: '1.5rem', fontWeight: 600 },
    h4: { fontSize: '1.25rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.875rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem' },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    ...baseComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #37475A',
          backgroundColor: '#161E2D',
          color: '#FFFFFF',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#161E2D',
          borderRight: '1px solid #37475A',
        },
      },
    },
  },
});
