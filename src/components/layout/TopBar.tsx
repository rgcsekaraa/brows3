'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  IconButton,
  Toolbar,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  SettingsBrightness as AutoModeIcon,
  Cloud as CloudIcon,
  Close as CloseIcon,
  Remove as MinimizeIcon,
  CropSquare as MaximizeIcon,
  FilterNone as RestoreIcon,
} from '@mui/icons-material';
import { useAppStore } from '@/store/appStore';
import ProfileSelector from '../profile/ProfileSelector';
import PathBar from '../navigation/PathBar';
import { useProfileStore } from '@/store/profileStore';
// Dynamic import for Tauri to avoid SSR issues
import { getCurrentWindow } from '@tauri-apps/api/window';

export default function TopBar() {
  const { themeMode, setThemeMode } = useAppStore();
  const { activeProfileId } = useProfileStore();
  
  const handleThemeToggle = () => {
    const modes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = modes.indexOf(themeMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setThemeMode(modes[nextIndex]);
  };
  
  const getThemeIcon = () => {
    switch (themeMode) {
      case 'light': return <LightModeIcon fontSize="small" />;
      case 'dark': return <DarkModeIcon fontSize="small" />;
      case 'system': return <AutoModeIcon fontSize="small" />;
    }
  };
  
  return (
    <Toolbar 
        variant="dense" 
        sx={{ 
            minHeight: 48, 
            px: { xs: 1, sm: 2 },
        }}
    >
      {/* Brand */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 0, mr: 2 }}>
        <CloudIcon sx={{ color: '#FF9900', mr: 1, fontSize: 24 }} />
        <Typography
          variant="h6"
          noWrap
          sx={{
            fontWeight: 800,
            letterSpacing: '-0.5px',
            fontSize: '1.1rem',
            color: 'text.primary'
          }}
        >
          Brows3
        </Typography>
      </Box>
      
      
      {/* Left Spacer */}
      <Box sx={{ flex: 1 }} />
      
      {/* Path Bar for Direct Bucket Access (Centered) */}
      <Box sx={{ width: '100%', maxWidth: 450, mx: 1 }}>
        {activeProfileId && <PathBar />}
      </Box>
      
      {/* Right Spacer */}
      <Box sx={{ flex: 1 }} />
      
      {/* Right Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* Profile Selector */}
        <ProfileSelector />
        
        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Theme Settings">
            <IconButton 
              color="inherit" 
              onClick={handleThemeToggle} 
              size="small"
              sx={{ color: 'text.secondary' }}
            >
              {getThemeIcon()}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-animation { animation: spin 1s linear infinite; }
      `}</style>
    </Toolbar>
  );
}

