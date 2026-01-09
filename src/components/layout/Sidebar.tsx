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
  Button,
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
  Explore as ExploreIcon,
} from '@mui/icons-material';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import AboutDialog from '@/components/dialogs/AboutDialog';
import { useState, useMemo } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useBuckets } from '@/hooks/useBuckets';
import { useAppStore } from '@/store/appStore';

const navItems = [
  { label: 'Explorer', icon: <ExploreIcon />, path: '/' },
  { label: 'Buckets', icon: <StorageIcon />, path: '/?view=discovery' },
  { label: 'Favorites', icon: <StarIcon />, path: '/favorites' },
  { label: 'Recent', icon: <HistoryIcon />, path: '/recent' },
  { label: 'Downloads', icon: <DownloadIcon />, path: '/downloads' },
  { label: 'Uploads', icon: <UploadIcon />, path: '/uploads' },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeBucketName = searchParams.get('name');
  
  const [aboutOpen, setAboutOpen] = useState(false);
  
  const { activeProfileId, profiles } = useProfileStore();
  const { buckets, isLoading, fetchBuckets } = useBuckets({ enabled: !!activeProfileId });
  const { addTab } = useAppStore();

  // Check if any profiles exist - this gates most UI
  const hasProfiles = profiles.length > 0;
  const hasActiveProfile = !!activeProfileId;


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
                  selected={
                    item.path === '/' 
                      ? (pathname === '/' && !searchParams.get('view'))
                      : (pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '') === item.path || pathname === item.path)
                  }
                  disabled={!hasProfiles}
                  sx={{ mx: 1, my: 0.5 }}
                >
                  <ListItemIcon sx={{ 
                    minWidth: 32, 
                    color: (item.path === '/' 
                      ? (pathname === '/' && !searchParams.get('view'))
                      : (pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '') === item.path || pathname === item.path)) 
                      ? 'primary.main' : 'inherit' 
                  }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                      primary={item.label} 
                      primaryTypographyProps={{ 
                        variant: 'body2', 
                        fontWeight: (item.path === '/' 
                          ? (pathname === '/' && !searchParams.get('view'))
                          : (pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '') === item.path || pathname === item.path)) 
                          ? 700 : 500
                      }} 
                  />
                </ListItemButton>
              </ListItem>
            </Tooltip>
          ))}
        </List>
        
        <Divider sx={{ mx: 2, my: 1 }} />
        
        {/* Dynamic Buckets Section - disabled without active profile */}
        <Box sx={!hasActiveProfile ? disabledStyles : {}}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1 }}>
            <Typography
              variant="overline"
              sx={{ display: 'block', color: 'text.secondary', fontWeight: 800, letterSpacing: '0.05em' }}
            >
              Buckets ({hasActiveProfile ? buckets.length : 0})
            </Typography>
            {hasActiveProfile && buckets.length === 0 && !isLoading && (
              <Button 
                size="small" 
                onClick={() => fetchBuckets()} 
                sx={{ fontSize: '0.65rem', py: 0, textTransform: 'none', minWidth: 0, fontWeight: 700 }}
              >
                Explore
              </Button>
            )}
          </Box>
          
          <List dense>
            {!hasActiveProfile ? (
              <Typography variant="caption" sx={{ px: 2, color: 'text.disabled', fontWeight: 500 }}>
                Select a profile to view buckets
              </Typography>
            ) : isLoading ? (
               [1,2,3].map(i => (
                  <ListItem key={i} sx={{ px: 2, py: 0.5 }}>
                      <Skeleton variant="text" width="100%" />
                  </ListItem>
               ))
            ) : buckets.length > 0 ? (
              buckets.map((bucket) => (
                <ListItem key={bucket.name} disablePadding>
                  <ListItemButton 
                      onClick={() => handleBucketClick(bucket.name, bucket.region || 'us-east-1')}
                      selected={pathname === '/bucket' && activeBucketName === bucket.name}
                      sx={{ mx: 1, my: 0.2 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <StorageIcon fontSize="small" sx={{ color: 'primary.main', opacity: 0.8 }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={bucket.name} 
                      primaryTypographyProps={{ 
                          variant: 'body2', 
                          noWrap: true,
                          title: bucket.name,
                          fontWeight: (pathname === '/bucket' && activeBucketName === bucket.name) ? 700 : 500
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
      
      {/* Settings & About at bottom (always enabled) */}
      <Box sx={{ flexShrink: 0, pb: 4 }}>
        <Divider sx={{ mx: 2, mb: 1 }} />
        <List dense>
          <ListItem disablePadding>
            <ListItemButton 
              onClick={() => router.push('/settings')} 
              sx={{ mx: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Settings" primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
              <ListItemButton onClick={() => setAboutOpen(true)} sx={{ mx: 1 }}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <InfoIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="About" primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
      
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Box>
  );
}

