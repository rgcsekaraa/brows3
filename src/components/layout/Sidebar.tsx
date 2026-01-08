'use client';

import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  TextField,
  InputAdornment,
  Skeleton,
  Tooltip,
} from '@mui/material';
import {
  Cloud as CloudIcon,
  Folder as FolderIcon,
  Star as StarIcon,
  CloudUpload as UploadIcon,
  CloudDownload as DownloadIcon,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Home as HomeIcon,
  Info as InfoIcon,
  Storage as StorageIcon,
  Search as SearchIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useRouter, usePathname } from 'next/navigation';
import AboutDialog from '@/components/dialogs/AboutDialog';
import { useState, useMemo } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useBuckets } from '@/hooks/useBuckets';
import { useAppStore } from '@/store/appStore';

const navItems = [
  { label: 'All Buckets', icon: <HomeIcon />, path: '/' },
  { label: 'Favorites', icon: <StarIcon />, path: '/favorites' },
  { label: 'Recent', icon: <HistoryIcon />, path: '/recent' },
  { label: 'Downloads', icon: <DownloadIcon />, path: '/downloads' },
  { label: 'Uploads', icon: <UploadIcon />, path: '/uploads' },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [bucketSearch, setBucketSearch] = useState('');
  
  const { activeProfileId, profiles } = useProfileStore();
  const { buckets, isLoading } = useBuckets();
  const { addTab } = useAppStore();

  // Check if any profiles exist - this gates most UI
  const hasProfiles = profiles.length > 0;
  const hasActiveProfile = !!activeProfileId;

  const filteredBuckets = useMemo(() => {
    return buckets.filter(b => b.name.toLowerCase().includes(bucketSearch.toLowerCase()));
  }, [buckets, bucketSearch]);

  const handleBucketClick = (bucketName: string, region: string) => {
    if (!hasActiveProfile) return;
    const path = `/bucket?name=${bucketName}&region=${region}`;
    addTab({ title: bucketName, path, icon: 'bucket' });
    router.push(path);
  };

  const handleNavClick = (item: typeof navItems[0]) => {
    if (!hasProfiles) return;
    addTab({ title: item.label, path: item.path, icon: item.label.toLowerCase() });
    router.push(item.path);
  };

  // Disabled item styles
  const disabledStyles = {
    opacity: 0.4,
    pointerEvents: 'none' as const,
    cursor: 'not-allowed',
  };

  return (
    <Box sx={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Search Buckets - disabled without profile */}
      <Box sx={{ p: 2, pb: 1, ...((!hasProfiles) && disabledStyles) }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Filter buckets..."
          value={bucketSearch}
          onChange={(e) => setBucketSearch(e.target.value)}
          disabled={!hasProfiles}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ 
            '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: 'action.hover' },
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' }
          }}
        />
      </Box>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {/* Main Navigation - disabled without profile */}
        <List dense>
          {navItems.map((item) => (
            <Tooltip 
              key={item.label} 
              title={!hasProfiles ? "Create a profile first" : ""} 
              placement="right"
            >
              <ListItem disablePadding sx={!hasProfiles ? disabledStyles : {}}>
                <ListItemButton 
                  onClick={() => handleNavClick(item)}
                  selected={pathname === item.path}
                  disabled={!hasProfiles}
                  sx={{ borderRadius: 1, mx: 1, my: 0.2 }}
                >
                  <ListItemIcon sx={{ minWidth: 32, color: pathname === item.path ? 'primary.main' : 'inherit' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                      primary={item.label} 
                      primaryTypographyProps={{ variant: 'body2', fontWeight: pathname === item.path ? 600 : 400 }} 
                  />
                </ListItemButton>
              </ListItem>
            </Tooltip>
          ))}
        </List>
        
        <Divider sx={{ mx: 2, my: 1 }} />
        
        {/* Dynamic Buckets Section - disabled without active profile */}
        <Box sx={!hasActiveProfile ? disabledStyles : {}}>
          <Typography
            variant="overline"
            sx={{ px: 2, pt: 1, display: 'block', color: 'text.secondary', fontWeight: 700 }}
          >
            Buckets ({hasActiveProfile ? filteredBuckets.length : 0})
          </Typography>
          
          <List dense>
            {!hasActiveProfile ? (
              <Typography variant="caption" sx={{ px: 2, color: 'text.disabled' }}>
                Select a profile to view buckets
              </Typography>
            ) : isLoading ? (
               [1,2,3].map(i => (
                  <ListItem key={i} sx={{ px: 2, py: 0.5 }}>
                      <Skeleton variant="text" width="100%" />
                  </ListItem>
               ))
            ) : filteredBuckets.length > 0 ? (
              filteredBuckets.map((bucket) => (
                <ListItem key={bucket.name} disablePadding>
                  <ListItemButton 
                      onClick={() => handleBucketClick(bucket.name, bucket.region || 'us-east-1')}
                      sx={{ borderRadius: 1, mx: 1, my: 0.1 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <StorageIcon fontSize="small" sx={{ color: 'primary.main', opacity: 0.7 }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={bucket.name} 
                      primaryTypographyProps={{ 
                          variant: 'body2', 
                          noWrap: true,
                          title: bucket.name
                      }} 
                    />
                  </ListItemButton>
                </ListItem>
              ))
            ) : (
              <Typography variant="caption" sx={{ px: 2, color: 'text.disabled' }}>
                No buckets found
              </Typography>
            )}
          </List>
        </Box>
      </Box>
      
      {/* About at bottom (always enabled) */}
      <Box sx={{ flexShrink: 0, pb: 4 }}>
        <Divider sx={{ mx: 2 }} />
        <List dense>
          <ListItem disablePadding>
            <ListItemButton onClick={() => setAboutOpen(true)} sx={{ borderRadius: 1, mx: 1 }}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <InfoIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="About" primaryTypographyProps={{ variant: 'body2' }} />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
      
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Box>
  );
}

