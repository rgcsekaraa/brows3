'use client';

import { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemSecondaryAction, 
  Select, 
  MenuItem, 
  TextField, 
  Slider, 
  Container,
  Button,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import {
  Cached as CacheIcon,
  Update as UpdateIcon,
  Folder as FolderIcon,
  DeleteSweep as ClearIcon,
} from '@mui/icons-material';
import { useSettingsStore } from '@/store/settingsStore';
import { useAppStore } from '@/store/appStore';
import { invalidateBucketCache } from '@/hooks/useBuckets';
import { toast } from '@/store/toastStore';

export default function SettingsPage() {
  // Theme is controlled by appStore (used by the actual app)
  const { themeMode, setThemeMode } = useAppStore();
  // Other settings from settingsStore
  const { 
    defaultRegion, setDefaultRegion, 
    maxConcurrentTransfers, setMaxConcurrentTransfers 
  } = useSettingsStore();
  
  const [version, setVersion] = useState<string>('...');
  const [appDataDir, setAppDataDir] = useState<string>('Loading...');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  
  useEffect(() => {
    // Get app version
    import('@tauri-apps/api/app').then(({ getVersion }) => {
      getVersion().then(setVersion).catch(() => setVersion('Unknown'));
    });
    
    // Get app data directory
    import('@tauri-apps/api/path').then(({ appDataDir: getAppDataDir }) => {
      getAppDataDir().then(setAppDataDir).catch(() => setAppDataDir('Unknown'));
    });
  }, []);

  const handleClearCache = () => {
    invalidateBucketCache();
    toast.success('Cache cleared', 'Bucket cache has been cleared. Refresh to reload data.');
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        toast.success('Update available', `Version ${update.version} is available. It will install automatically.`);
        await update.downloadAndInstall();
      } else {
        toast.info('Up to date', 'You are running the latest version.');
      }
    } catch (err) {
      toast.error('Update check failed', String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h4">Settings</Typography>
        <Chip label={`v${version}`} size="small" variant="outlined" />
      </Box>

      {/* Appearance Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>Appearance</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Theme" 
              secondary="Choose your preferred interface appearance" 
            />
            <ListItemSecondaryAction>
              <Select
                size="small"
                value={themeMode}
                onChange={(e) => {
                  setThemeMode(e.target.value as 'light' | 'dark' | 'system');
                  toast.success('Theme updated', `Changed to ${e.target.value} mode`);
                }}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="light">Light</MenuItem>
                <MenuItem value="dark">Dark</MenuItem>
                <MenuItem value="system">System</MenuItem>
              </Select>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Defaults Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>Defaults</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Default Region" 
              secondary="Region used when creating buckets or defaulting connections" 
            />
            <ListItemSecondaryAction>
              <TextField 
                size="small" 
                variant="outlined" 
                value={defaultRegion} 
                onChange={(e) => setDefaultRegion(e.target.value)}
                sx={{ width: 150 }}
              />
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Performance Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>Performance</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Max Concurrent Transfers" 
              secondary={`Allow up to ${maxConcurrentTransfers} simultaneous uploads/downloads`} 
            />
            <Box sx={{ width: 200, mr: 2 }}>
               <Slider
                 value={maxConcurrentTransfers}
                 min={1}
                 max={20}
                 step={1}
                 valueLabelDisplay="auto"
                 onChange={(_, val) => setMaxConcurrentTransfers(val as number)}
               />
            </Box>
          </ListItem>
        </List>
      </Paper>

      {/* Data & Storage Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>Data & Storage</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="App Data Location" 
              secondary={appDataDir}
              secondaryTypographyProps={{ 
                component: 'code', 
                sx: { fontSize: '0.75rem', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1 } 
              }}
            />
            <ListItemSecondaryAction>
              <FolderIcon color="action" />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider />
          <ListItem>
            <ListItemText 
              primary="Bucket Cache" 
              secondary="Clear cached bucket listings to force a fresh fetch from S3" 
            />
            <ListItemSecondaryAction>
              <Button 
                variant="outlined" 
                size="small" 
                startIcon={<ClearIcon />}
                onClick={handleClearCache}
              >
                Clear Cache
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Updates Section */}
      <Paper variant="outlined">
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>Updates</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Check for Updates" 
              secondary="Manually check if a newer version is available" 
            />
            <ListItemSecondaryAction>
              <Button 
                variant="contained" 
                size="small" 
                startIcon={<UpdateIcon />}
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? 'Checking...' : 'Check Now'}
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
        <Alert severity="info" sx={{ m: 2, mt: 0 }}>
          Brows3 automatically checks for updates on startup. Updates are signed and verified before installation.
        </Alert>
      </Paper>
    </Container>
  );
}

