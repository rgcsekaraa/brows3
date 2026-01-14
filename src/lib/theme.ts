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
        transition: 'none',
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        transition: 'none',
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        transition: 'none',
      },
    },
  },
  MuiListItem: {
    styleOverrides: {
      root: {
        transition: 'none',
      },
    },
  },
  MuiButtonBase: {
    defaultProps: {
      disableRipple: false,
    },
  },
};

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    ...brandColors,
    primary: {
      ...brandColors.primary,
      main: '#EA8D00', // Darker Orange for better contrast on white
    },
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    action: {
      selectedOpacity: 0.16,
      hoverOpacity: 0.08,
    },
    text: {
      primary: '#111827',
      secondary: '#374151',
      disabled: '#6B7280',
    },
    divider: '#E5E7EB',
  },
  transitions: {
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em' },
    h2: { fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.025em' },
    h3: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.025em' },
    h4: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontSize: '0.875rem', fontWeight: 700, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600, letterSpacing: '-0.01em' },
    body1: { fontSize: '0.925rem', lineHeight: 1.6 },
    body2: { fontSize: '0.85rem', fontWeight: 500 },
    button: { fontWeight: 700, letterSpacing: '-0.01em' },
  },
  shape: {
    borderRadius: 6,
  },
  components: {
    ...baseComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #E5E7EB',
          backgroundColor: '#FFFFFF',
          color: '#111827',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#FFFFFF',
          borderRight: '1px solid #E5E7EB',
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
      default: '#0B0F19',
      paper: '#111827',
    },
    text: {
      primary: '#F9FAFB',
      secondary: '#9CA3AF',
    },
    divider: '#1F2937',
  },
  transitions: {
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em' },
    h2: { fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.025em' },
    h3: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.025em' },
    h4: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontSize: '0.875rem', fontWeight: 700, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600, letterSpacing: '-0.01em' },
    body1: { fontSize: '0.925rem', lineHeight: 1.6 },
    body2: { fontSize: '0.85rem', fontWeight: 500 },
    button: { fontWeight: 700, letterSpacing: '-0.01em' },
  },
  shape: {
    borderRadius: 6,
  },
  components: {
    ...baseComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid #1F2937',
          backgroundColor: '#111827',
          color: '#F9FAFB',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#111827',
          borderRight: '1px solid #1F2937',
        },
      },
    },
  },
});
