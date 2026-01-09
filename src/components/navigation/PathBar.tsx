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
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/appStore';
import { useHistoryStore } from '@/store/historyStore';
import { toast } from '@/store/toastStore';

export default function PathBar() {
  const router = useRouter();
  const { addTab, setActiveTab, tabs } = useAppStore();
  const { recentPaths, addPath, clearHistory } = useHistoryStore();
  
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

  const validateAndParsePath = (path: string): { bucket: string; prefix: string } | null => {
    const trimmedPath = path.trim();
    
    // MUST start with s3:// - no exceptions
    if (!trimmedPath.startsWith('s3://')) {
      return null;
    }
    
    // Check if it's a valid S3 URI format: s3://bucket-name or s3://bucket-name/prefix/
    // Bucket names: 3-63 chars, lowercase letters, numbers, hyphens, dots
    // Must start and end with letter or number
    const s3UriMatch = trimmedPath.match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(\/.*)?$/i);
    
    if (s3UriMatch) {
      const bucket = s3UriMatch[1];
      let prefix = s3UriMatch[2] || '';
      // Remove leading slash and trailing slash from prefix
      prefix = prefix.replace(/^\//, '').replace(/\/$/, '');
      return { bucket, prefix };
    }
    
    // Invalid format
    return null;
  };

  const handleNavigate = (path: string) => {
    const trimmedPath = path.trim();
    
    if (!trimmedPath) {
      toast.error('Enter S3 URI', 'Please enter a valid S3 URI.\n\nFormat: s3://bucket-name/path/');
      return;
    }
    
    const parsed = validateAndParsePath(trimmedPath);
    
    if (!parsed) {
      toast.error('Invalid S3 URI', 
        'Path must start with s3://\n\n' +
        'Examples:\n' +
        '• s3://my-bucket\n' +
        '• s3://my-bucket/folder/'
      );
      return;
    }

    const { bucket, prefix } = parsed;
    
    // Build the correct URL path
    const urlPath = `/bucket?name=${bucket}&region=us-east-1${prefix ? `&prefix=${encodeURIComponent(prefix + '/')}` : ''}`;
    
    // Save to history
    addPath(`s3://${bucket}/${prefix ? prefix + '/' : ''}`);

    // Navigate using the URL path
    addTab({
      title: bucket,
      path: urlPath,
      icon: 'bucket'
    });
    router.push(urlPath);
    
    setInputValue(''); // Clear input after successful navigation
    setIsOpen(false);
    // Blur to hide keyboard/dropdown
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Only handle Enter if no option is highlighted in the dropdown
      // This prevents double-trigger when selecting from autocomplete
      e.preventDefault();
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
      onChange={(_, value, reason) => {
        // Only navigate when clicking on an option, not on Enter key (handled separately)
        if (value && reason === 'selectOption') {
          handleNavigate(value);
        }
      }}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <Box component="li" key={key} {...otherProps}>
            <HistoryIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2">{option}</Typography>
            </Box>
          </Box>
        );
      }}
      ListboxProps={{
        sx: { maxHeight: 300 },
      }}
      PaperComponent={({ children, ...paperProps }) => (
        <Paper {...paperProps} elevation={8}>
          {children}
          {recentPaths.length > 0 && (
            <Typography
              variant="caption"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearHistory();
                setIsOpen(false);
              }}
              sx={{
                display: 'block',
                textAlign: 'center',
                py: 1,
                color: 'text.disabled',
                cursor: 'pointer',
                borderTop: '1px solid',
                borderColor: 'divider',
                '&:hover': { color: 'text.secondary' },
              }}
            >
              Clear history
            </Typography>
          )}
        </Paper>
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
              pr: 0.5,
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
                  sx={{ mr: 0.8 }}
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
