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
  Divider,
  Tooltip,
} from '@mui/material';
import { 
  Search as SearchIcon, 
  ArrowForward as GoIcon,
  DataObject as ObjectIcon,
  Storage as BucketIcon,
  History as HistoryIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppStore } from '@/store/appStore';
import { useHistoryStore } from '@/store/historyStore';
import { useProfileStore } from '@/store/profileStore';
import { toast } from '@/store/toastStore';

export default function PathBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addTab, setActiveTab, tabs } = useAppStore();
  const { recentPaths, addPath, clearHistory } = useHistoryStore();
  
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input value with current URL params
  useEffect(() => {
    // Only sync if the user is NOT actively typing/focused
    if (isFocused) return;

    if (!searchParams) return;

    const bucket = searchParams.get('name');
    const region = searchParams.get('region');
    const prefix = searchParams.get('prefix') || '';
    
    if (bucket) {
      const uri = `s3://${bucket}/${prefix}`;
      setInputValue(uri);
    } else {
      setInputValue('');
    }
  }, [searchParams, isFocused]);

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
    // Region/Prefix: More permissive regex to allow underscores and dots in paths
    const s3UriMatch = trimmedPath.match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:@([a-z0-9-]+))?(\/(.*))?$/i);
    
    if (s3UriMatch) {
      const bucket = s3UriMatch[1];
      const region = s3UriMatch[2]; // Optional region
      let rawPrefix = s3UriMatch[4] || ''; // The actual path after s3://bucket/
      
      const hasTrailingSlash = rawPrefix.endsWith('/');
      
      // Remove leading slash and trailing slash from prefix for internal use
      const prefix = rawPrefix.replace(/\/$/, '');
      return { bucket, region, prefix, hasTrailingSlash };
    }
    
    // Invalid format
    return null;
  };

  const isNavigating = useRef(false);

  const handleNavigate = (path: string) => {
    // 1. Prevent double navigation in the same frame (CRITICAL for race conditions)
    if (isNavigating.current) return;
    isNavigating.current = true;
    setTimeout(() => { isNavigating.current = false; }, 500);

    const trimmedPath = path.trim();
    
    if (!trimmedPath) {
      // Don't show error if user just clicked Enter on empty input while browsing history
      if (isOpen) return;
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
    
    const activeProfileId = useProfileStore.getState().activeProfileId;
    const activeProfile = useProfileStore.getState().profiles.find(p => p.id === activeProfileId);
    
    // Priority: 1. Discovered region (specific to this bucket), 2. Explicit region, 3. Profile default
    const discoveredRegion = useAppStore.getState().discoveredRegions[bucket];
    const region = explicitRegion || discoveredRegion || activeProfile?.region || 'us-east-1';
    
    // Determine if we should append a slash (treat as folder) or not (treat as file)
    let finalPrefix = prefix;
    if (prefix) {
        // More robust extension check: it's a "file" if it ends in .ext, and NOT a folder if no trailing slash
        const hasExtension = /\.[a-zA-Z0-9]{2,10}$/.test(prefix);
        
        if (hasTrailingSlash) {
            if (hasExtension) {
                // If it has an extension but user provided a slash, they likely pasted 
                // a file URI with an accidental trailing slash. Treat as file.
                finalPrefix = prefix;
            } else {
                // Standard folder
                finalPrefix = prefix + '/';
            }
        } else {
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
    const { activeTabId, updateTab, tabs, setActiveTab } = useAppStore.getState();
    
    // Check if a tab with this path already exists (deduplication)
    const existingTab = tabs.find(t => t.path === urlPath);
    
    if (existingTab) {
      // Switch to the existing tab
      setActiveTab(existingTab.id);
    } else if (activeTabId && activeTabId !== 'home') {
      // Update the current active tab
      updateTab(activeTabId, {
        title: bucket,
        path: urlPath,
      });
    } else {
      // Create a new tab
      addTab({
        title: bucket,
        path: urlPath,
        icon: 'bucket'
      });
    }
    
    router.push(urlPath);
    
    setIsOpen(false);
    // Blur to hide keyboard/dropdown
    inputRef.current?.blur();
  };


  return (
    <Autocomplete
      freeSolo
      autoHighlight={false}
      selectOnFocus={false}
      clearOnBlur={false}
      handleHomeEndKeys={true}
      open={isOpen}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      inputValue={inputValue}
      onInputChange={(_, newVal, reason) => {
        // IMPORTANT: Ignore 'reset' events which MUI triggers on blur or selection
        // This prevents the input from being wiped or snapped to a previous value
        if (reason !== 'reset') {
          setInputValue(newVal);
        }
      }}
      // Set value to null so Autocomplete doesn't "hold" a selection state
      // This makes it purely a suggestion engine for the inputValue text
      value={null}
      options={recentPaths}
      onChange={(_, value, reason) => {
        // Handle explicit selection from history
        if (value && reason === 'selectOption') {
          handleNavigate(value);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // If the popup is open and an item is highlighted, Autocomplete handles it via onChange
          // We only trigger manual navigation if the popup is closed or no item is highlighted
          // The use of setTimeout or isNavigating ref in handleNavigate handles race conditions
          handleNavigate(inputValue);
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
      renderInput={(params) => {
        // Merge refs to ensure both MUI and our shortcuts work
        const { ref, ...inputProps } = params.inputProps as any;
        return (
          <TextField
            {...params}
            onFocus={() => setIsFocused(true)}
            onBlur={(e: any) => {
              setIsFocused(false);
              params.inputProps.onBlur?.(e);
            }}
            inputRef={(el: HTMLInputElement) => {
              (inputRef as any).current = el;
              if (ref) {
                if (typeof ref === 'function') ref(el);
                else ref.current = el;
              }
            }}
            placeholder="Go to path... (e.g. s3://bucket@region/folder/)"
            variant="outlined"
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: 'background.paper',
                pr: 1,
                transition: 'all 0.2s',
                '& fieldset': { borderColor: 'divider' },
                '&:hover fieldset': { borderColor: 'text.primary' },
                '&.Mui-focused fieldset': { borderColor: 'primary.main', borderWidth: 2 },
              },
              '& .MuiInputBase-input': {
                pr: 2 // Extra padding so text doesn't hit the Go button
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
                <Box sx={{ display: 'flex', alignItems: 'center', mr: -0.5 }}>
                  {params.InputProps.endAdornment}
                  <Divider orientation="vertical" flexItem sx={{ height: 16, mx: 0.5, my: 'auto' }} />
                  <InputAdornment position="end">
                    <Tooltip title="Go to path" placement="top">
                      <IconButton 
                        size="small" 
                        onClick={() => handleNavigate(inputValue)}
                        sx={{ 
                          color: 'primary.main',
                          '&:hover': { bgcolor: 'primary.alpha10' }
                        }}
                      >
                        <GoIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                </Box>
              )
            }}
          />
        );
      }}
    />
  );
}
