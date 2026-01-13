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
import { useProfileStore } from '@/store/profileStore';
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

  const validateAndParsePath = (path: string): { bucket: string; region?: string; prefix: string; hasTrailingSlash: boolean } | null => {
    const trimmedPath = path.trim();
    
    // MUST start with s3:// - no exceptions
    if (!trimmedPath.startsWith('s3://')) {
      return null;
    }
    
    // Check if it's a valid S3 URI format: s3://bucket-name or s3://bucket-name/prefix/
    // Supports explicit region: s3://bucket-name@region/prefix/
    // Bucket names: 3-63 chars, lowercase letters, numbers, hyphens, dots
    // Must start and end with letter or number
    const s3UriMatch = trimmedPath.match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:@([a-z0-9-]+))?(\/.*)?$/i);
    
    if (s3UriMatch) {
      const bucket = s3UriMatch[1];
      const region = s3UriMatch[2]; // Optional region
      let prefix = s3UriMatch[3] || '';
      
      const hasTrailingSlash = prefix.endsWith('/');
      
      // Remove leading slash and trailing slash from prefix for internal use
      prefix = prefix.replace(/^\//, '').replace(/\/$/, '');
      return { bucket, region, prefix, hasTrailingSlash };
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
        '• s3://my-bucket@us-west-2/folder/ (Explicit Region)\n' +
        '• s3://my-bucket/file.json (Direct File)'
      );
      return;
    }

    const { bucket, region: explicitRegion, prefix, hasTrailingSlash } = parsed;
    
    const activeProfile = useProfileStore.getState().profiles.find(p => p.id === useProfileStore.getState().activeProfileId);
    // Use explicit region if provided, otherwise fallback to profile default
    const region = explicitRegion || activeProfile?.region || 'us-east-1';
    
    // Determine if we should append a slash (treat as folder) or not (treat as file)
    // 1. If explicit trailing slash was provided -> Folder
    // 2. If NO trailing slash but looks like a file (has extension) -> File
    // 3. Otherwise (no slash, no extension) -> Default to Folder logic (append slash)
    let finalPrefix = prefix;
    if (prefix) {
        if (hasTrailingSlash) {
            finalPrefix = prefix + '/';
        } else {
            // Check for extension (e.g. .json, .txt, .jpg)
            // Simple heuristic: dot not at start/end
            const hasExtension = /\.[a-zA-Z0-9]+$/.test(prefix);
            if (hasExtension) {
                // Treat as file - NO slash
                finalPrefix = prefix;
            } else {
                // Treat as folder - Append slash
                finalPrefix = prefix + '/';
            }
        }
    }
    
    // Build the correct URL path
    const urlPath = `/bucket?name=${bucket}&region=${region}${finalPrefix ? `&prefix=${encodeURIComponent(finalPrefix)}` : ''}`;
    
    // Save to history
    addPath(`s3://${bucket}${explicitRegion ? '@' + explicitRegion : ''}/${finalPrefix}`);

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
        // Only render if we have history
        recentPaths.length > 0 ? (
          <Paper {...paperProps} elevation={4} sx={{ mt: 0.5 }}>
            {children}
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
                py: 0.75,
                color: 'text.secondary',
                cursor: 'pointer',
                borderTop: '1px solid',
                borderColor: 'divider',
                '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
              }}
            >
              Clear history
            </Typography>
          </Paper>
        ) : null
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          placeholder="Go to path... (e.g. s3://bucket@region/folder/)"
          variant="outlined"
          size="small"
          fullWidth
          onKeyDown={handleKeyDown}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'background.paper',
              pr: 0.5,
              transition: 'all 0.2s',
              '& fieldset': { borderColor: 'divider' },
              '&:hover fieldset': { borderColor: 'text.primary' },
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
              <>
                {params.InputProps.endAdornment}
                <InputAdornment position="end">
                  <IconButton 
                    size="small" 
                    onClick={() => handleNavigate(inputValue)}
                    edge="end"
                    sx={{ mr: -0.5 }}
                  >
                    <GoIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              </>
            )
          }}
        />
      )}
    />
  );
}
