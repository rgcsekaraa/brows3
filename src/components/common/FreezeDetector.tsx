'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress } from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';

const FREEZE_THRESHOLD_MS = 8000; // 8 seconds - more tolerant threshold
const CHECK_INTERVAL_MS = 2000; // Check every 2 seconds (less CPU overhead)

export function FreezeDetector() {
  const [isFrozen, setIsFrozen] = useState(false);
  const lastTickRef = useRef(Date.now());
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Main thread heartbeat check
    const checkFreeze = () => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      
      // If more than FREEZE_THRESHOLD_MS has passed since last tick,
      // the main thread was likely blocked
      if (elapsed > FREEZE_THRESHOLD_MS) {
        setIsFrozen(true);
        // Auto-reload after showing dialog briefly
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
      
      lastTickRef.current = now;
    };

    checkIntervalRef.current = setInterval(checkFreeze, CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, []);

  const handleReloadNow = () => {
    window.location.reload();
  };

  if (!isFrozen) return null;

  return (
    <Dialog 
      open={isFrozen} 
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon color="warning" />
        Recovering...
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={24} />
          <Typography variant="body2" color="text.secondary">
            App unresponsive - reloading...
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleReloadNow} variant="contained" color="primary" size="small">
          Reload Now
        </Button>
      </DialogActions>
    </Dialog>
  );
}
