'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Alert,
  AlertTitle,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Slide,
  Stack,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useToastStore, Toast } from '@/store/toastStore';

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
  onShowDetails: () => void;
}

function ToastItem({ toast, onClose, onShowDetails }: ToastItemProps) {
  useEffect(() => {
    if (toast.autoHide) {
      const timer = setTimeout(() => {
        onClose();
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.autoHide, toast.duration, onClose]);

  const hasLongMessage = toast.message.length > 80 || !!toast.details;

  return (
    <Slide direction="left" in={true} mountOnEnter unmountOnExit>
      <Alert
        severity={toast.type}
        variant="filled"
        sx={{
          minWidth: 320,
          maxWidth: 420,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          borderRadius: 2,
          alignItems: 'flex-start',
          '.MuiAlert-message': { flex: 1 },
        }}
        action={
          <IconButton
            size="small"
            color="inherit"
            onClick={onClose}
            sx={{ mt: -0.5 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        <Box sx={{ pr: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
            {hasLongMessage ? `${toast.message.slice(0, 80)}...` : toast.message}
          </Typography>
          {hasLongMessage && (
            <Button
              size="small"
              color="inherit"
              endIcon={<ExpandMoreIcon />}
              onClick={onShowDetails}
              sx={{ mt: 0.5, p: 0, minWidth: 'auto', fontWeight: 600, textTransform: 'none' }}
            >
              Show Details
            </Button>
          )}
        </Box>
      </Alert>
    </Slide>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  const [detailsDialog, setDetailsDialog] = useState<{ open: boolean; toast: Toast | null }>({
    open: false,
    toast: null,
  });

  const handleShowDetails = (toast: Toast) => {
    setDetailsDialog({ open: true, toast });
  };

  const handleCloseDetails = () => {
    setDetailsDialog({ open: false, toast: null });
  };

  return (
    <>
      {/* Toast Stack - Fixed to bottom right */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: (theme) => theme.zIndex.snackbar,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 1,
          pointerEvents: 'none',
          '& > *': { pointerEvents: 'auto' },
        }}
      >
        <Stack spacing={1}>
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={() => removeToast(toast.id)}
              onShowDetails={() => handleShowDetails(toast)}
            />
          ))}
        </Stack>
      </Box>

      {/* Details Dialog */}
      <Dialog
        open={detailsDialog.open}
        onClose={handleCloseDetails}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {detailsDialog.toast?.type === 'error' && '❌ '}
          {detailsDialog.toast?.type === 'warning' && '⚠️ '}
          {detailsDialog.toast?.type === 'success' && '✅ '}
          {detailsDialog.toast?.type === 'info' && 'ℹ️ '}
          {detailsDialog.toast?.type === 'error' ? 'Error Details' : 'Details'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ mb: 2, fontWeight: 500 }}>
            {detailsDialog.toast?.message}
          </Typography>
          {detailsDialog.toast?.details && (
            <Box
              sx={{
                p: 2,
                bgcolor: 'grey.900',
                color: 'grey.100',
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              {detailsDialog.toast.details}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetails}>Close</Button>
          {detailsDialog.toast?.details && (
            <Button
              onClick={() => {
                if (detailsDialog.toast) {
                  navigator.clipboard.writeText(
                    `${detailsDialog.toast.message}\n\n${detailsDialog.toast.details || ''}`
                  );
                }
              }}
            >
              Copy to Clipboard
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
