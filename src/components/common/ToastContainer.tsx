'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Slide,
  Stack,
  LinearProgress,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { useToastStore, Toast } from '@/store/toastStore';

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
  onShowDetails: () => void;
}

// Color config for different toast types
const toastConfig = {
  success: {
    icon: SuccessIcon,
    color: '#10B981',
    bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  error: {
    icon: ErrorIcon,
    color: '#EF4444',
    bg: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  warning: {
    icon: WarningIcon,
    color: '#F59E0B',
    bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  info: {
    icon: InfoIcon,
    color: '#3B82F6',
    bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
    border: 'rgba(59, 130, 246, 0.3)',
  },
};

function ToastItem({ toast, onClose, onShowDetails }: ToastItemProps) {
  const [progress, setProgress] = useState(100);
  const config = toastConfig[toast.type];
  const Icon = config.icon;
  const duration = toast.duration || 5000;

  useEffect(() => {
    if (toast.autoHide) {
      const interval = 50;
      const decrement = (100 * interval) / duration;
      
      const timer = setInterval(() => {
        setProgress((prev) => {
          if (prev <= 0) {
            clearInterval(timer);
            onClose();
            return 0;
          }
          return prev - decrement;
        });
      }, interval);
      
      return () => clearInterval(timer);
    }
  }, [toast.autoHide, duration, onClose]);

  const hasDetails = !!toast.details || toast.message.length > 100;

  return (
    <Slide direction="left" in={true} mountOnEnter unmountOnExit>
      <Paper
        elevation={0}
        sx={{
          width: 380,
          background: config.bg,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${config.border}`,
          borderRadius: 2,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box sx={{ p: 2, display: 'flex', gap: 1.5 }}>
          {/* Icon */}
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              bgcolor: `${config.color}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon sx={{ color: config.color, fontSize: 20 }} />
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                mb: 0.25,
                textTransform: 'capitalize',
              }}
            >
              {toast.type}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: hasDetails ? 2 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {toast.message}
            </Typography>
            {hasDetails && (
              <Button
                size="small"
                onClick={onShowDetails}
                endIcon={<ExpandMoreIcon sx={{ fontSize: '16px !important' }} />}
                sx={{
                  mt: 0.5,
                  p: 0,
                  minWidth: 'auto',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: config.color,
                  textTransform: 'none',
                  '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                }}
              >
                View Details
              </Button>
            )}
          </Box>

          {/* Close Button */}
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              flexShrink: 0,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* Progress Bar */}
        {toast.autoHide && (
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 3,
              bgcolor: 'transparent',
              '& .MuiLinearProgress-bar': {
                bgcolor: config.color,
              },
            }}
          />
        )}
      </Paper>
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

  const config = detailsDialog.toast ? toastConfig[detailsDialog.toast.type] : toastConfig.info;
  const Icon = config.icon;

  return (
    <>
      {/* Toast Stack - Fixed to bottom right */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: (theme) => theme.zIndex.snackbar + 1,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 1,
          pointerEvents: 'none',
          '& > *': { pointerEvents: 'auto' },
        }}
      >
        <Stack spacing={1.5}>
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
        PaperProps={{
          sx: {
            borderRadius: 3,
            border: `1px solid ${config.border}`,
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              bgcolor: `${config.color}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon sx={{ color: config.color }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {detailsDialog.toast?.type === 'error' ? 'Error Details' : 
               detailsDialog.toast?.type === 'warning' ? 'Warning Details' :
               detailsDialog.toast?.type === 'success' ? 'Success' : 'Information'}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ mb: 2, fontWeight: 500, color: 'text.primary' }}>
            {detailsDialog.toast?.message}
          </Typography>
          {detailsDialog.toast?.details && (
            <Box
              sx={{
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 2,
                fontFamily: '"Fira Code", "Consolas", monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 300,
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {detailsDialog.toast.details}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleCloseDetails} variant="outlined">
            Close
          </Button>
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
