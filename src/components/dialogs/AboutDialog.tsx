import {
  Typography,
  Box,
  Link,
  Chip,
  Divider,
  alpha,
  useTheme,
} from '@mui/material';
import { GitHub as GitHubIcon } from '@mui/icons-material';
import { getVersion } from '@tauri-apps/api/app';
import { useState, useEffect } from 'react';
import { BaseDialog } from '../common/BaseDialog';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string>('...');
  const theme = useTheme();

  useEffect(() => {
    if (open) {
      getVersion().then(setVersion).catch(() => setVersion('Unknown'));
    }
  }, [open]);

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title="About Brows3"
      maxWidth="xs"
    >
      <Box sx={{ textAlign: 'center', pb: 2 }}>
        {/* Logo with slight pulse or refined container */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Box
            sx={{
              width: 90,
              height: 90,
              borderRadius: 3,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 12px 32px ${alpha(theme.palette.primary.main, 0.2)}`,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.5)
            }}
          >
            <img src="/logo.png" alt="Brows3" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
          </Box>
        </Box>
        
        <Typography variant="h3" sx={{ fontSize: '1.5rem', mb: 0.5 }}>Brows3</Typography>
        
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 3 }}>
          <Chip 
            label={`Version ${version}`} 
            size="small" 
            sx={{ 
              fontWeight: 800, 
              fontSize: '0.7rem',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
              border: 'none'
            }}
          />
          <Chip 
            label="Public Beta" 
            size="small" 
            sx={{ 
              fontWeight: 800, 
              fontSize: '0.7rem',
              bgcolor: alpha(theme.palette.secondary.main, 0.1),
              color: theme.palette.secondary.main,
              border: 'none'
            }}
          />
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4, lineHeight: 1.7, fontWeight: 500 }}>
          The high-performance, open-source Amazon S3 desktop client. 
          Built for speed, security, and a premium developer experience.
        </Typography>
        
        <Divider sx={{ mb: 4, bgcolor: alpha(theme.palette.divider, 0.5) }} />
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Link 
            href="https://github.com/rgcsekaraa/brows3" 
            target="_blank" 
            rel="noopener"
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 1.5,
              fontWeight: 700,
              color: theme.palette.text.primary,
              textDecoration: 'none',
              '&:hover': { color: theme.palette.primary.main }
            }}
          >
            <GitHubIcon fontSize="small" />
            View Source Code
          </Link>
          <Link 
            href="https://github.com/rgcsekaraa/brows3/issues" 
            target="_blank" 
            rel="noopener"
            color="text.secondary"
            sx={{ fontSize: '0.85rem', fontWeight: 600 }}
          >
            Report a bug or request a feature
          </Link>
        </Box>
        
        <Box sx={{ mt: 5 }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, letterSpacing: '0.05em' }}>
            TAURI • REACT • RUST • NEXT.JS
          </Typography>
          <Typography variant="caption" display="block" color="text.disabled" sx={{ mt: 1, opacity: 0.5 }}>
            Released under MIT License © 2026
          </Typography>
        </Box>
      </Box>
    </BaseDialog>
  );
}

