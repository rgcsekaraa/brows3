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
import { Profile, profileApi, bucketApi, isTauri } from '@/lib/tauri';
import ProfileDialog from './ProfileDialog';

export default function ProfileSelector() {
  const { 
    profiles, 
    activeProfileId, 
    setProfiles, 
    setActiveProfileId,
    isLoading,
    setLoading,
  } = useProfileStore();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  
  // Load profiles on mount
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        setLoading(true);
        const [profileList, activeProfile] = await Promise.all([
          profileApi.listProfiles(),
          profileApi.getActiveProfile(),
        ]);
        setProfiles(profileList);
        if (activeProfile) {
          setActiveProfileId(activeProfile.id);
        }
      } catch (error) {
        console.error('Failed to load profiles:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadProfiles();
  }, [setProfiles, setActiveProfileId, setLoading]);
  
  const handleProfileChange = async (event: SelectChangeEvent<string>) => {
    const newProfileId = event.target.value;
    if (newProfileId === 'manage') {
      setEditingProfile(null);
      setDialogOpen(true);
      return;
    }
    
    try {
      await profileApi.setActiveProfile(newProfileId);
      // Also refresh buckets for the new profile
      bucketApi.refreshS3Client().then(() => {
           // The useBuckets hook will react to profile change if it's set up to do so
           // or we can trigger a global refresh via some event
      });
    } catch (error) {
      console.error('Failed to set active profile:', error);
    }
    setActiveProfileId(newProfileId);
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
  
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  
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
            borderRadius: 1,
            '& .MuiSelect-select': { py: 0.75, px: 1.5, display: 'flex', alignItems: 'center' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.secondary' },
          }}
          MenuProps={{
            PaperProps: {
              sx: { minWidth: 180 }
            }
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
