import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Link,
} from '@mui/material';
import { getVersion } from '@tauri-apps/api/app';
import { useState, useEffect } from 'react';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string>('Unknown');

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center' }}>
            Brows3 S3 Explorer
        </DialogTitle>
        <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
                <Typography variant="body1">
                    A modern, fast, and secure S3 file manager.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Version: {version}
                </Typography>
                <Typography variant="caption" color="text.secondary" align="center">
                    Built with Tauri, Next.js, and Rust.
                </Typography>
                <Link href="https://github.com/google-deepmind" target="_blank" rel="noopener">
                    GitHub Repository
                </Link>
            </Box>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Close</Button>
        </DialogActions>
    </Dialog>
  );
}
