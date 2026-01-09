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
        fontWeight: 600,
        borderRadius: 6,
        padding: '5px 12px',
        boxShadow: 'none',
        fontSize: '0.8125rem',
        '&:hover': {
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }
      },
      contained: {
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        '&:hover': {
           boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }
      },
      outlined: {
        borderWidth: '1px',
        '&:hover': { borderWidth: '1px' }
      }
    },
  },
  MuiMenu: {
    styleOverrides: {
      paper: {
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        border: '1px solid rgba(255,255,255,0.08)',
        marginTop: 4,
        minWidth: 140,
      },
      list: {
        padding: 4,
      }
    }
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        padding: '8px 12px',
        fontSize: '0.8125rem',
        fontWeight: 500,
        borderRadius: 6,
        minHeight: 'auto',
        '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.06)',
        },
        '&.Mui-selected': {
            backgroundColor: 'rgba(255,255,255,0.1)',
            '&:hover': {
                 backgroundColor: 'rgba(255,255,255,0.12)',
            }
        }
      }
    }
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 12, // Match softer look (3)
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        borderRadius: 12, // Match softer look
        backgroundImage: 'none',
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 16, // Even rounder for dialogs
        boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        fontWeight: 600,
        borderRadius: 8,
      },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: 12,
        fontWeight: 500,
      },
      standardSuccess: {
        backgroundColor: '#E8F5E9',
        color: '#1B5E20',
      },
      standardInfo: {
        backgroundColor: '#E3F2FD',
        color: '#0D47A1',
      }
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 6,
      },
      input: {
        padding: '8px 12px',
      }
    },
  },
  MuiTextField: {
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': {
          borderRadius: 6,
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
      default: '#F8F9FA', // Slightly more stark white/grey
      paper: '#FFFFFF',
    },
    text: {
      primary: '#111827', // Cool grey 900
      secondary: '#4B5563', // Cool grey 600
      disabled: '#9CA3AF',
    },
    divider: '#E5E7EB',
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
    borderRadius: 8, // Global radius bump
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
      default: '#0B0F19', // Deep dark blue/grey
      paper: '#111827', // Cool dark grey
    },
    text: {
      primary: '#F9FAFB',
      secondary: '#9CA3AF',
    },
    divider: '#1F2937',
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
    borderRadius: 8,
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
