'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  Toolbar,
  Typography,
  useMediaQuery,
  ThemeProvider,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Cloud as CloudIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { lightTheme, darkTheme } from '@/lib/theme';
import { useAppStore } from '@/store/appStore';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import Footer from './Footer';
import TabBar from './TabBar';
import { useTransferEvents } from '@/hooks/useTransferEvents';
import { TransferPanel } from '@/components/transfer/TransferPanel';
import { useProfileStore } from '@/store/profileStore';
import ProfileDialog from '@/components/profile/ProfileDialog';
import ToastContainer from '@/components/common/ToastContainer';
import { check } from '@tauri-apps/plugin-updater';
import { toast } from '@/store/toastStore';
import { profileApi } from '@/lib/tauri';
import { useClipboardShortcuts } from '@/hooks/useClipboardShortcuts';
import { preloadMonaco } from '@/lib/monaco-config';

const drawerWidth = 260; 

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { themeMode, sidebarOpen, setSidebarOpen, toggleSidebar } = useAppStore();
  const { profiles, setProfiles, setActiveProfileId } = useProfileStore();
  const [mounted, setMounted] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [isUpdateavailable, setIsUpdateAvailable] = useState(false);
  
  // Enable clipboard shortcuts globally
  useClipboardShortcuts();
  
  // Determine if we should use dark mode
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const isMobile = useMediaQuery('(max-width:900px)');
  
  const theme = useMemo(() => {
    if (themeMode === 'system') {
      return prefersDarkMode ? darkTheme : lightTheme;
    }
    return themeMode === 'dark' ? darkTheme : lightTheme;
  }, [themeMode, prefersDarkMode]);
  
  // Handle hydration mismatch
  useEffect(() => {
    setMounted(true);
    // Preload Monaco Editor in background for faster file editing
    preloadMonaco();
  }, []);
  
  // Close drawer on mobile when navigating
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, setSidebarOpen]);

  // Listen for global transfer events
  useTransferEvents();

  // Load profiles on mount (Persistence Fix)
  useEffect(() => {
    const initProfiles = async () => {
      // Only run in Tauri environment
      if (typeof window !== 'undefined' && !('__TAURI__' in window)) {
         return;
      }
      
      try {
        const [loadedProfiles, activeProfile] = await Promise.all([
          profileApi.listProfiles(),
          profileApi.getActiveProfile()
        ]);
        
        if (loadedProfiles.length > 0) {
          setProfiles(loadedProfiles);
          if (activeProfile) {
            setActiveProfileId(activeProfile.id);
          } else if (loadedProfiles.length === 1) {
             // Auto-select if only one profile exists
             setActiveProfileId(loadedProfiles[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to hydrate profiles on init", err);
      }
    };

    if (mounted) {
      initProfiles();
    }
  }, [mounted, setProfiles, setActiveProfileId]);

  // Check for updates on load (with safety checks)
  useEffect(() => {
    const checkForUpdates = async () => {
      // Skip in development or SSR
      if (process.env.NODE_ENV === 'development') return;
      if (typeof window === 'undefined') return;
      
      // Check if we're in a Tauri environment
      // @ts-expect-error - __TAURI__ is injected by Tauri
      if (!window.__TAURI__) {
        console.log('Not running in Tauri environment, skipping update check');
        return;
      }
      
      // Add a small delay to let the app fully initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        // Dynamic import to avoid SSR issues
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update?.available) {
          setIsUpdateAvailable(true);
          toast.info("Update Available", `Version ${update.version} is ready to install.`);
           // If "dialog: true" is set in tauri.conf.json, this will show the built-in dialog
           // and handle download, install, and relaunch automatically.
          await update.downloadAndInstall();
        }
      } catch (error) {
        // Silently fail - don't crash the app if update check fails
        console.warn('Update check failed (non-critical):', error);
      }
    };
    
    if (mounted) {
      checkForUpdates();
    }
  }, [mounted]);
  
  if (!mounted) {
    return null;
  }
  
  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
        <CssBaseline />
        
        {/* Top App Bar Container (AppBar + TabBar) */}
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: (theme) => theme.zIndex.drawer + 2 }}>
            <AppBar
                position="static"
                elevation={0}
                sx={{
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                }}
            >
                <Suspense fallback={<Box sx={{ height: 48 }} />}>
                    <TopBar />
                </Suspense>
            </AppBar>
            <TabBar />
        </Box>
        
        {/* Sidebar Drawer */}
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? sidebarOpen : true}
          onClose={() => setSidebarOpen(false)}
          sx={{
            width: isMobile ? (sidebarOpen ? drawerWidth : 0) : drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
              height: '100vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Toolbar variant="dense" /> {/* Spacer for AppBar */}
          <Toolbar variant="dense" sx={{ minHeight: 40 }} /> {/* Spacer for TabBar */}
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Suspense fallback={<Box sx={{ p: 2 }}><CircularProgress size={24} /></Box>}>
              <Sidebar />
            </Suspense>
          </Box>
        </Drawer>
        
        {/* Main Content */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            height: '100vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Toolbar variant="dense" /> {/* Spacer for AppBar */}
          <Toolbar variant="dense" sx={{ minHeight: 40 }} /> {/* Spacer for TabBar */}
          
          <Box sx={{ 
            flexGrow: 1, 
            overflow: 'auto', 
            pb: 6, // Space for footer
            px: 2, // Horizontal padding for breathing room
            bgcolor: 'background.default'
          }}>
            {!mounted || profiles.length === 0 ? (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress size={32} />
              </Box>
            ) : profiles.length === 0 ? (
              <Box sx={{ 
                height: 'calc(100vh - 150px)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                p: 4
              }}>
                <Box sx={{ 
                  textAlign: 'center', 
                  maxWidth: 500,
                  p: 6,
                  borderRadius: 4,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.05)'
                }}>
                  <Box sx={{ 
                    width: 72, 
                    height: 72, 
                    borderRadius: '50%', 
                    bgcolor: 'primary.main', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    color: 'primary.contrastText',
                    mb: 3,
                    mx: 'auto'
                  }}>
                    <CloudIcon sx={{ fontSize: 36 }} />
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 800, mb: 1.5, letterSpacing: '-0.02em' }}>
                    Welcome to Brows3
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ mb: 4, lineHeight: 1.6 }}>
                    Your ultimate S3 browser. To get started, you'll need to connect an AWS account or S3-compatible storage.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                    <Button 
                      variant="contained" 
                      size="large"
                      onClick={() => setProfileDialogOpen(true)}
                      sx={{ borderRadius: 100, px: 4, py: 1.5, fontWeight: 700 }}
                    >
                      Connect Account
                    </Button>
                  </Box>
                </Box>
              </Box>
            ) : (
              children
            )}

            <Suspense fallback={<Box sx={{ height: 28 }} />}>
              <Footer />
            </Suspense>
        </Box>
        
        <ProfileDialog open={profileDialogOpen} onClose={() => setProfileDialogOpen(false)} />
        <ToastContainer />
        <TransferPanel />
      </Box>
    </Box>
  </ThemeProvider>
  );
}
