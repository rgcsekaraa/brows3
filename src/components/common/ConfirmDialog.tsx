'use client';

import React from 'react';
import { Button, Typography, Box, CircularProgress } from '@mui/material';
import { BaseDialog } from './BaseDialog';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  isLoading = false,
}) => {
  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      actions={
        <>
          <Button 
            onClick={onClose} 
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="contained"
            color={isDestructive ? 'error' : 'primary'}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? <CircularProgress size={20} color="inherit" /> : confirmLabel}
          </Button>
        </>
      }
    >
      <Box sx={{ py: 1 }}>
        <Typography variant="body1" sx={{ fontWeight: 500, lineHeight: 1.6 }}>
          {message}
        </Typography>
      </Box>
    </BaseDialog>
  );
};
