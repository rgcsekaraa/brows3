'use client';

import { useState, useCallback } from 'react';
import { 
  Box, 
  TextField, 
  InputAdornment, 
  IconButton, 
  Tooltip,
  Autocomplete,
} from '@mui/material';
import { 
  Search as SearchIcon,
  ArrowForward as GoIcon,
  Storage as BucketIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/appStore';

interface PathBarProps {
  onNavigate?: (bucket: string, prefix?: string) => void;
}

// Parse S3 URI or bucket name
function parseS3Path(input: string): { bucket: string; prefix: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Handle s3:// URIs
  if (trimmed.startsWith('s3://')) {
    const path = trimmed.slice(5);
    const slashIndex = path.indexOf('/');
    if (slashIndex === -1) {
      return { bucket: path, prefix: '' };
    }
    return { 
      bucket: path.slice(0, slashIndex), 
      prefix: path.slice(slashIndex + 1) 
    };
  }
  
  // Handle plain bucket/path format
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return { bucket: trimmed, prefix: '' };
  }
  return { 
    bucket: trimmed.slice(0, slashIndex), 
    prefix: trimmed.slice(slashIndex + 1) 
  };
}

export default function PathBar({ onNavigate }: PathBarProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { addTab } = useAppStore();

  const handleNavigate = useCallback(() => {
    setError(null);
    const parsed = parseS3Path(value);
    
    if (!parsed) {
      setError('Enter a bucket name or S3 URI');
      return;
    }
    
    if (!parsed.bucket) {
      setError('Invalid bucket name');
      return;
    }
    
    // Validate bucket name format (basic check)
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(parsed.bucket) && 
        !/^[a-z0-9]{3,63}$/.test(parsed.bucket)) {
      setError('Invalid bucket name format');
      return;
    }
    
    // Navigate to bucket
    const path = `/bucket?name=${encodeURIComponent(parsed.bucket)}&region=auto${parsed.prefix ? `&prefix=${encodeURIComponent(parsed.prefix)}` : ''}`;
    addTab({ title: parsed.bucket, path, icon: 'bucket' });
    router.push(path);
    
    if (onNavigate) {
      onNavigate(parsed.bucket, parsed.prefix);
    }
    
    setValue('');
  }, [value, router, addTab, onNavigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, mx: 2 }}>
      <TextField
        size="small"
        fullWidth
        placeholder="Type bucket name or s3://bucket/path..."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        error={!!error}
        helperText={error}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <BucketIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
          endAdornment: value && (
            <InputAdornment position="end">
              <Tooltip title="Go to bucket">
                <IconButton 
                  size="small" 
                  onClick={handleNavigate}
                  edge="end"
                  color="primary"
                >
                  <GoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
        sx={{ 
          maxWidth: 400,
          '& .MuiOutlinedInput-root': { 
            borderRadius: 2, 
            bgcolor: 'action.hover',
            '& fieldset': { borderColor: 'transparent' },
            '&:hover fieldset': { borderColor: 'divider' },
            '&.Mui-focused fieldset': { borderColor: 'primary.main' },
          },
          '& .MuiFormHelperText-root': {
            position: 'absolute',
            bottom: -20,
          }
        }}
      />
    </Box>
  );
}
