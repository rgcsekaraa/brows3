'use client';

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  Button,
  SxProps,
  Theme,
  alpha,
  useTheme,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

export interface BaseDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  PaperProps?: any;
}

export const BaseDialog: React.FC<BaseDialogProps> = ({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  sx,
  PaperProps,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      TransitionProps={{ unmountOnExit: true }}
      PaperProps={{
        ...PaperProps,
        sx: {
          borderRadius: 1,
          backgroundImage: 'none',
          bgcolor: isDark ? alpha(theme.palette.background.paper, 0.8) : '#fff',
          backdropFilter: 'blur(12px)',
          border: '1px solid',
          borderColor: isDark ? alpha('#fff', 0.1) : alpha('#000', 0.1),
          boxShadow: isDark 
            ? '0 24px 48px -12px rgba(0, 0, 0, 0.5)' 
            : '0 24px 48px -12px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          ...PaperProps?.sx,
        },
      }}
      sx={{
        '& .MuiBackdrop-root': {
          bgcolor: isDark ? alpha('#000', 0.7) : alpha('#000', 0.4),
          backdropFilter: 'blur(4px)',
        },
        ...sx,
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <DialogTitle component="div" sx={{ 
          m: 0, 
          p: 2.5, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: isDark ? alpha('#fff', 0.05) : alpha('#000', 0.05),
        }}>
          <Typography variant="h6" sx={{ 
            fontSize: '1.1rem', 
            fontWeight: 800,
            letterSpacing: '-0.02em',
            background: isDark 
              ? 'linear-gradient(45deg, #fff 30%, rgba(255,255,255,0.7) 90%)' 
              : 'linear-gradient(45deg, #000 30%, rgba(0,0,0,0.7) 90%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {title}
          </Typography>
          <IconButton
            aria-label="close"
            onClick={onClose}
            sx={{
              color: (theme) => theme.palette.grey[500],
              '&:hover': {
                bgcolor: alpha(theme.palette.grey[500], 0.1),
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
      </Box>

      <DialogContent sx={{ p: 3, pt: 4 }}>
        {children}
      </DialogContent>

      {actions && (
        <DialogActions sx={{ 
          p: 3, 
          pt: 1, 
          gap: 1.5,
          borderTop: '1px solid',
          borderColor: isDark ? alpha('#fff', 0.05) : alpha('#000', 0.05),
          bgcolor: isDark ? alpha('#000', 0.2) : alpha('#000', 0.02),
        }}>
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
};
