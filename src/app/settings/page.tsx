'use client';

import { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemIcon,
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
  MonitorHeart as MonitorIcon,
  BugReport as BugIcon,
  CheckCircle as SuccessIcon,
  ErrorOutline as ErrorIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useSettingsStore } from '@/store/settingsStore';
import { useAppStore } from '@/store/appStore';
import { useMonitorStore } from '@/store/monitorStore';
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
              secondary="Used as fallback for new profiles if region cannot be auto-detected" 
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
            <ListItemIcon>
              <FolderIcon color="action" />
            </ListItemIcon>
            <ListItemText 
              primary="App Data Location" 
              secondary={appDataDir}
              secondaryTypographyProps={{ 
                component: 'code', 
                sx: { fontSize: '0.75rem', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1, display: 'inline-block', mt: 0.5 } 
              }}
            />
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
      <Paper variant="outlined" sx={{ mb: 3 }}>
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

      {/* System Monitor Section */}
      <SystemMonitor />
    </Container>
  );
}

function SystemMonitor() {
  const { logs, metrics, clearLogs } = useMonitorStore();
  
  return (
    <Paper variant="outlined">
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MonitorIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>System Monitor</Typography>
          </Box>
          <Button size="small" onClick={clearLogs} startIcon={<ClearIcon />}>Clear Logs</Button>
        </Box>
        
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="primary">{metrics.totalRequests}</Typography>
                <Typography variant="caption" color="text.secondary">Total Requests</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color={metrics.failedRequests > 0 ? "error" : "text.secondary"}>
                    {metrics.failedRequests}
                </Typography>
                <Typography variant="caption" color="text.secondary">Failed Requests</Typography>
            </Paper>
        </Box>

        <Box sx={{ maxHeight: 300, overflow: 'auto', borderTop: 1, borderColor: 'divider' }}>
            {logs.length === 0 ? (
                <Typography sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>No logs yet</Typography>
            ) : (
                <List dense>
                    {logs.map((log) => (
                        <ListItem key={log.id} divider>
                            <ListItemIcon sx={{ minWidth: 36 }}>
                                {log.type === 'error' ? <ErrorIcon color="error" fontSize="small" /> : 
                                 log.type === 'success' ? <SuccessIcon color="success" fontSize="small" /> :
                                 <InfoIcon color="info" fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText 
                                primary={
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>{log.message}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </Typography>
                                    </Box>
                                }
                                secondary={log.details}
                                secondaryTypographyProps={{ 
                                    sx: { 
                                        color: 'error.main', 
                                        fontFamily: 'monospace', 
                                        fontSize: '0.75rem',
                                        mt: 0.5 
                                    } 
                                }}
                            />
                        </ListItem>
                    ))}
                </List>
            )}
        </Box>
    </Paper>
  );
}

