import {
  Dialog,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Link,
  Chip,
  Divider,
} from '@mui/material';
import { Close as CloseIcon, Cloud as CloudIcon, GitHub as GitHubIcon } from '@mui/icons-material';
import { getVersion } from '@tauri-apps/api/app';
import { useState, useEffect } from 'react';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string>('...');

  useEffect(() => {
    if (open) {
      getVersion().then(setVersion).catch(() => setVersion('Unknown'));
    }
  }, [open]);

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="xs" 
      fullWidth
      PaperProps={{
        sx: { borderRadius: 1.25, overflow: 'hidden' }
      }}
    >
      <IconButton
        onClick={onClose}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      
      <DialogContent sx={{ textAlign: 'center', py: 4, px: 3 }}>
        {/* Logo */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 1.25,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CloudIcon sx={{ fontSize: 40, color: '#FF9900' }} />
          </Box>
        </Box>
        
        {/* Title */}
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Brows3
        </Typography>
        
        <Chip 
          label={`v${version}`} 
          size="small" 
          variant="outlined"
          sx={{ mb: 2 }}
        />
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          A high-performance, open-source Amazon S3 desktop client designed for developers who demand speed.
        </Typography>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Links */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Link 
            href="https://github.com/rgcsekaraa/brows3" 
            target="_blank" 
            rel="noopener"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}
          >
            <GitHubIcon fontSize="small" />
            View on GitHub
          </Link>
          <Link 
            href="https://github.com/rgcsekaraa/brows3/issues" 
            target="_blank" 
            rel="noopener"
            color="text.secondary"
            sx={{ fontSize: '0.875rem' }}
          >
            Report an Issue
          </Link>
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Tech Stack */}
        <Typography variant="caption" color="text.disabled" display="block">
          Built with Tauri • React • Rust
        </Typography>
        <Typography variant="caption" color="text.disabled">
          MIT License © 2026
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

