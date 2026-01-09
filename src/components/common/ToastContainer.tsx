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
  ContentCopy as CopyIcon,
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

  const hasDetails = !!toast.details || toast.message.length > 100;

  return (
    <Slide direction="left" in={true} mountOnEnter unmountOnExit>
      <Alert
        severity={toast.type}
        variant="filled"
        sx={{
          minWidth: 340,
          maxWidth: 400,
          boxShadow: 3,
          borderRadius: 1,
          alignItems: 'flex-start',
          '& .MuiAlert-message': { flex: 1, py: 0.5 },
          '& .MuiAlert-icon': { py: 1 },
        }}
        action={
          <IconButton
            size="small"
            color="inherit"
            onClick={onClose}
            sx={{ mt: 0.5 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        <Box>
          <Typography 
            variant="body2" 
            sx={{ 
              fontWeight: 500, 
              wordBreak: 'break-word',
              display: '-webkit-box',
              WebkitLineClamp: hasDetails ? 2 : 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {toast.message}
          </Typography>
          {hasDetails && (
            <Button
              size="small"
              color="inherit"
              endIcon={<ExpandMoreIcon sx={{ fontSize: '16px !important' }} />}
              onClick={onShowDetails}
              sx={{ 
                mt: 0.5, 
                p: 0, 
                minWidth: 'auto', 
                fontSize: '0.75rem',
                fontWeight: 600, 
                textTransform: 'none',
                opacity: 0.9,
                '&:hover': { opacity: 1, bgcolor: 'transparent' },
              }}
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
          zIndex: (theme) => theme.zIndex.snackbar + 1,
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
          {detailsDialog.toast?.type === 'error' ? 'Error Details' : 
           detailsDialog.toast?.type === 'warning' ? 'Warning' :
           detailsDialog.toast?.type === 'success' ? 'Success' : 'Information'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ mb: 2, fontWeight: 500 }}>
            {detailsDialog.toast?.message}
          </Typography>
          {detailsDialog.toast?.details && (
            <Box
              sx={{
                p: 2,
                bgcolor: 'action.hover',
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
              variant="contained"
              startIcon={<CopyIcon />}
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
