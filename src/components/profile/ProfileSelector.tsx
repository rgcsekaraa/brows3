'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tooltip,
  Typography,
  CircularProgress,
  Chip,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Settings as SettingsIcon,
  CheckCircle as ConnectedIcon,
  Error as DisconnectedIcon,
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { Profile, profileApi, bucketApi, invalidateCache } from '@/lib/tauri';
import ProfileDialog from './ProfileDialog';
import { invalidateBucketCache } from '@/hooks/useBuckets';
import { useAppStore } from '@/store/appStore';
import { useRouter } from 'next/navigation';

export default function ProfileSelector() {
  const router = useRouter();
  const { 
    profiles, 
    activeProfileId, 
    setActiveProfileId,
    isLoading,
  } = useProfileStore();
  const { resetApp, clearDiscoveredRegions } = useAppStore();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  
  // Profiles are hydrated by AppShell on mount - no need to load here
  
  const handleProfileChange = async (event: SelectChangeEvent<string>) => {
    const newProfileId = event.target.value;
    if (newProfileId === 'manage') {
      setEditingProfile(null);
      setDialogOpen(true);
      return;
    }
    
    try {
      await profileApi.setActiveProfile(newProfileId);
      setActiveProfileId(newProfileId);
      invalidateBucketCache();
      clearDiscoveredRegions();
      invalidateCache();
      resetApp();
      router.push('/');
      // Also refresh buckets for the new profile
      bucketApi.refreshS3Client().then(() => {
           // The useBuckets hook will react to profile change if it's set up to do so
           // or we can trigger a global refresh via some event
      });
    } catch (error) {
      console.error('Failed to set active profile:', error);
      return;
    }
  };
  
  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  const handleAddProfile = () => {
    setEditingProfile(null);
    setDialogOpen(true);
  };
  
  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingProfile(null);
  };
  
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FormControl 
        variant="outlined" 
        size="small" 
        sx={{ 
            minWidth: 140,
        }}
      >
        <Select
          value={activeProfileId || ''}
          onChange={handleProfileChange}
          displayEmpty
          renderValue={(selected) => {
            if (!selected) {
              return <Typography variant="body2" color="text.secondary">Select Profile</Typography>;
            }
            const profile = profiles.find((p) => p.id === selected);
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ConnectedIcon sx={{ fontSize: 14, color: 'success.main' }} />
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>{profile?.name}</Typography>
              </Box>
            );
          }}
          sx={{
            minWidth: 140,
          }}
        >
          {profiles.map((profile) => (
            <MenuItem key={profile.id} value={profile.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2">{profile.name}</Typography>
                  <Chip label={profile.region || 'us-east-1'} size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
                </Box>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleEditProfile(profile); }}>
                  <SettingsIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </MenuItem>
          ))}
          
          <Divider />
          
          <MenuItem value="manage">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
              <AddIcon sx={{ fontSize: 18 }} />
              <Typography variant="body2">Manage Profiles</Typography>
            </Box>
          </MenuItem>
        </Select>
      </FormControl>
      
      {isLoading && <CircularProgress size={16} sx={{ ml: 1 }} />}
      
      <ProfileDialog 
        open={dialogOpen} 
        onClose={handleDialogClose}
        editProfile={editingProfile}
      />
    </Box>
  );
}
