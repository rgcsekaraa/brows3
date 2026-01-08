'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Paper, 
  Autocomplete,
  TextField,
  InputAdornment, 
  IconButton,
  Typography,
  Box,
} from '@mui/material';
import { 
  Search as SearchIcon, 
  ArrowForward as GoIcon,
  DataObject as ObjectIcon,
  Storage as BucketIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/appStore';
import { useHistoryStore } from '@/store/historyStore';
import { toast } from '@/store/toastStore';

export default function PathBar() {
  const router = useRouter();
  const { addTab, setActiveTab, tabs } = useAppStore();
  const { recentPaths, addPath } = useHistoryStore();
  
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Shortcut: Ctrl+Shift+P (or Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const validateAndParsePath = (path: string) => {
    // 1. Remove optional s3:// prefix
    let cleanPath = path.replace(/^s3:\/\//, '');
    
    // 2. Remove trailing slash
    if (cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    
    if (!cleanPath) return null;
    
    // 3. Split bucket and prefix
    const parts = cleanPath.split('/');
    const bucket = parts[0];
    const prefix = parts.slice(1).join('/');
    
    // Bucket name validation (basic)
    if (!bucket || bucket.length < 3) return null;
    
    return { bucket, prefix };
  };

  const handleNavigate = (path: string) => {
    const parsed = validateAndParsePath(path);
    
    if (!parsed) {
      toast.error('Invalid S3 Path', 'Please enter a valid bucket name (e.g. "my-bucket" or "s3://my-bucket/folder")');
      return;
    }

    const { bucket, prefix } = parsed;
    const fullPath = prefix ? `/${bucket}/${prefix}/` : `/${bucket}/`;
    
    // Save to history
    addPath(`s3://${bucket}/${prefix ? prefix + '/' : ''}`);

    // Navigate logic
    const homeTab = tabs.find(t => t.id === 'home');
    if (homeTab) {
        // Reuse home tab if available
        setActiveTab('home');
        router.push(fullPath);
    } else {
        addTab({
            title: bucket,
            path: fullPath,
            icon: 'bucket'
        });
        router.push(fullPath);
    }
    setIsOpen(false);
    // Blur to hide keyboard/dropdown
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNavigate(inputValue);
    }
  };

  return (
    <Autocomplete
      freeSolo
      open={isOpen}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      inputValue={inputValue}
      onInputChange={(_, newVal) => setInputValue(newVal)}
      options={recentPaths}
      onChange={(_, value) => {
        if (value) handleNavigate(value);
      }}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option}>
            <HistoryIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
            <Box>
                <Typography variant="body2">{option}</Typography>
            </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          placeholder="Go to bucket (e.g. s3://my-bucket)..."
          variant="outlined"
          size="small"
          fullWidth
          onKeyDown={handleKeyDown}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'background.paper',
              borderRadius: 2,
              pr: 1,
              '& fieldset': { borderColor: 'divider' },
              '&:hover fieldset': { borderColor: 'text.secondary' },
              '&.Mui-focused fieldset': { borderColor: 'primary.main', borderWidth: 2 },
            }
          }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton 
                  size="small" 
                  onClick={() => handleNavigate(inputValue)}
                  edge="end"
                >
                  <GoIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            )
          }}
        />
      )}
    />
  );
}
