'use client';

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
  Refresh as RefreshIcon,
  Cloud as CloudIcon,
} from '@mui/icons-material';
import { Divider } from '@mui/material';
import { useAppStore } from '@/store/appStore';
import { useBuckets } from '@/hooks/useBuckets';
import ProfileSelector from '../profile/ProfileSelector';

export default function TopBar() {
  const { themeMode, setThemeMode } = useAppStore();
  const { refresh, isLoading } = useBuckets();
  
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
    <Toolbar variant="dense" sx={{ minHeight: 48, px: { xs: 1, sm: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 0, mr: 4 }}>
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
      
      {/* Spacer */}
      <Box sx={{ flexGrow: 1 }} />
      
      {/* Right Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* Profile Selector */}
        <ProfileSelector />
        
        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Refresh">
            <IconButton 
              color="inherit" 
              size="small" 
              onClick={() => refresh()}
              disabled={isLoading}
              sx={{ color: 'text.secondary' }}
            >
              <RefreshIcon fontSize="small" className={isLoading ? 'spin-animation' : ''} />
            </IconButton>
          </Tooltip>
          
          <Divider orientation="vertical" flexItem sx={{ mx: 1, height: 20, my: 'auto' }} />
          
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
