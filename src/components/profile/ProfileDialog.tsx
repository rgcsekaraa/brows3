'use client';

import { useState, useEffect } from 'react';
import { useTheme, alpha } from '@mui/material';
import { useSettingsStore } from '@/store/settingsStore';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
  Autocomplete,
  Paper,
  Fade,
  Tooltip,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Cloud as CloudIcon,
  Dns as ProfileIcon,
  Public as RegionIcon,
} from '@mui/icons-material';
import { Profile, CredentialType, profileApi, TestConnectionResult } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { useAppStore } from '@/store/appStore';
import { useHistoryStore } from '@/store/historyStore';
import { useClipboardStore } from '@/store/clipboardStore';
import { toast } from '@/store/toastStore';
import { useRouter } from 'next/navigation';
import { BaseDialog } from '../common/BaseDialog';

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
  'ap-east-1', 'ap-southeast-3', 'ap-southeast-4',
  'sa-east-1', 'ca-central-1', 'af-south-1', 'me-south-1', 'me-central-1',
  'us-gov-east-1', 'us-gov-west-1',
];

type CredentialTypeKey = 'Environment' | 'SharedConfig' | 'Manual' | 'CustomEndpoint';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  editProfile?: Profile | null;
}

export default function ProfileDialog({ open, onClose, editProfile }: ProfileDialogProps) {
  const router = useRouter();
  const theme = useTheme();
  const { profiles, addProfile, updateProfile, removeProfile, setActiveProfileId } = useProfileStore();
  const { resetApp } = useAppStore();
  const { clearHistory } = useHistoryStore();
  const { clear: clearClipboard } = useClipboardStore();
  const { defaultRegion } = useSettingsStore();
  
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [formData, setFormData] = useState({
    name: '',
    credentialType: 'Environment' as CredentialTypeKey,
    region: 'us-east-1',
    profileName: 'default',
    accessKeyId: '',
    secretAccessKey: '',
    endpointUrl: '',
  });
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [discoveredProfiles, setDiscoveredProfiles] = useState<{ name: string; region?: string }[]>([]);
  const [awsEnv, setAwsEnv] = useState<{ has_access_key: boolean; has_secret_key: boolean; has_session_token: boolean; region?: string } | null>(null);

  // Discover local profiles and check environment
  useEffect(() => {
    if (open) {
        const fetchData = async () => {
            try {
                const [discovered, env] = await Promise.all([
                    profileApi.discoverLocalProfiles(),
                    profileApi.checkAwsEnvironment()
                ]);
                
                setDiscoveredProfiles(discovered);
                setAwsEnv(env);
                
                // Smart default: If we are in "add" mode and haven't started typing a name yet
                if (mode === 'add' && !formData.name && !editProfile) {
                    if (env.has_access_key) {
                        setFormData((prev: any) => ({ ...prev, credentialType: 'Environment', name: 'Environment Credentials' }));
                    } else if (discovered.length > 0) {
                        const defaultProf = discovered.find((p: any) => p.name === 'default') || discovered[0];
                        setFormData((prev: any) => ({
                            ...prev,
                            credentialType: 'SharedConfig',
                            profileName: defaultProf.name,
                            region: defaultProf.region || prev.region,
                            name: `Local AWS (${defaultProf.name})`
                        }));
                    }
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        };
        
        fetchData();
    }
  }, [open, mode, editProfile]);

  const updateField = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  // Reset testing state when form data changes
  useEffect(() => {
    if (testing || testResult) {
      setTesting(false);
      setTestResult(null);
    }
  }, [formData]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (!editProfile) {
        setMode('list');
      }
      setTestResult(null);
      setError(null);
      resetForm();
    }
  }, [open, editProfile]);
  
  // Handle edit profile prop
  useEffect(() => {
    if (editProfile) {
      loadProfileToForm(editProfile);
      setMode('edit');
      setSelectedProfile(editProfile);
    }
  }, [editProfile]);
  
  const resetForm = () => {
    setFormData({
      name: '',
      credentialType: 'Environment',
      region: defaultRegion || 'us-east-1',
      profileName: 'default',
      accessKeyId: '',
      secretAccessKey: '',
      endpointUrl: '',
    });
  };
  
  const loadProfileToForm = (profile: Profile) => {
    const cred = profile.credential_type;
    setFormData({
      name: profile.name,
      credentialType: cred.type as CredentialTypeKey,
      region: profile.region || 'us-east-1',
      profileName: cred.type === 'SharedConfig' ? (cred.profile_name || 'default') : 'default',
      accessKeyId: 'access_key_id' in cred ? cred.access_key_id : '',
      secretAccessKey: '',
      endpointUrl: cred.type === 'CustomEndpoint' ? cred.endpoint_url : '',
    });
  };
  
  const buildCredentialType = (): CredentialType => {
    switch (formData.credentialType) {
      case 'Environment':
        return { type: 'Environment' };
      case 'SharedConfig':
        return { type: 'SharedConfig', profile_name: formData.profileName };
      case 'Manual':
        return { 
          type: 'Manual', 
          access_key_id: formData.accessKeyId, 
          secret_access_key: formData.secretAccessKey 
        };
      case 'CustomEndpoint':
        return { 
          type: 'CustomEndpoint', 
          endpoint_url: formData.endpointUrl,
          access_key_id: formData.accessKeyId, 
          secret_access_key: formData.secretAccessKey 
        };
    }
  };
  
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    
    try {
      const profile: Partial<Profile> = {
        id: editProfile?.id || '',
        name: formData.name || 'Test',
        credential_type: buildCredentialType(),
        region: formData.region,
        is_default: false,
      };
      
      const result = await profileApi.testConnection(profile as Profile);
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };
  
  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Profile name is required');
      return;
    }
    
    setSaving(true);
    setError(null);
    
    try {
      const profileData: any = {
        name: formData.name,
        credential_type: buildCredentialType(),
        region: formData.region,
        is_default: false,
      };
      
      if (mode === 'edit' && selectedProfile) {
        const profileToUpdate = { 
            ...selectedProfile, 
            ...profileData, 
            id: selectedProfile.id 
        };
        const updated = await profileApi.updateProfile(selectedProfile.id, profileToUpdate);
        updateProfile(selectedProfile.id, updated);
      } else {
        const created = await profileApi.addProfile(profileData as Profile);
        addProfile(created);
        
        if (profiles.length === 0) {
          setActiveProfileId(created.id);
        }
      }
      
      setMode('list');
      resetForm();
      if (editProfile) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  
  const handleDelete = async (profileID: string, profileName: string) => {
    let confirmed = false;
    try {
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      confirmed = await confirm(`This will permanently delete "${profileName}" and clear all cached data.`, {
        title: 'Delete Profile?',
        kind: 'warning',
      });
    } catch {
      confirmed = window.confirm(`Delete profile "${profileName}"?`);
    }
    
    if (!confirmed) return;
    
    try {
      await profileApi.deleteProfile(profileID);
      removeProfile(profileID);
      
      resetApp();
      clearHistory();
      clearClipboard();
      
      toast.success(`Profile "${profileName}" deleted.`);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };
  
  const handleEditMode = (profile: Profile) => {
    setSelectedProfile(profile);
    loadProfileToForm(profile);
    setMode('edit');
  };

  const getDialogTitle = () => {
    if (mode === 'list' && !editProfile) return "Cloud Profiles";
    if (mode === 'edit') return "Update Profile";
    return "New Cloud Connection";
  };
  
  const renderList = () => (
    <Fade in={mode === 'list'}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {profiles.length === 0 ? (
            <Box sx={{ 
              py: 8, 
              textAlign: 'center', 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Box sx={{ 
                width: 100, 
                height: 100, 
                borderRadius: 4, 
                bgcolor: alpha(theme.palette.primary.main, 0.1), 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                color: theme.palette.primary.main,
                mb: 3,
                boxShadow: `0 12px 32px ${alpha(theme.palette.primary.main, 0.15)}`,
                border: '1px solid',
                borderColor: alpha(theme.palette.primary.main, 0.2)
              }}>
                <CloudIcon sx={{ fontSize: 48 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>Connect to Cloud</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4, maxWidth: 350, fontWeight: 500 }}>
                Manage your AWS, Wasabi, DigitalOcean, or any S3-compatible accounts in one place.
              </Typography>
              <Button 
                variant="contained"
                size="large"
                startIcon={<AddIcon />} 
                onClick={() => setMode('add')}
                sx={{ 
                  borderRadius: 100, 
                  px: 6,
                  py: 1.8,
                  fontWeight: 800,
                  boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.3)}`
                }}
              >
                Create New Profile
              </Button>
            </Box>
          ) : (
            <Box>
              <Typography variant="caption" sx={{ 
                fontWeight: 800, 
                letterSpacing: '0.1em', 
                color: 'text.secondary', 
                mb: 2, 
                display: 'block' 
              }}>
                ACTIVE CONNECTIONS
              </Typography>
              <List sx={{ pt: 0, px: 0 }}>
                {profiles.map((profile) => (
                  <Paper 
                    key={profile.id} 
                    elevation={0}
                    sx={{ 
                      mb: 2, 
                      borderRadius: 3, 
                      bgcolor: alpha(theme.palette.background.paper, 0.4),
                      border: '1px solid',
                      borderColor: 'divider',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        borderColor: alpha(theme.palette.primary.main, 0.5),
                        bgcolor: alpha(theme.palette.background.paper, 0.6),
                        transform: 'translateY(-2px)',
                        boxShadow: `0 12px 24px ${alpha(theme.palette.common.black, 0.05)}`
                      }
                    }}
                  >
                    <ListItem disablePadding>
                      <ListItemButton 
                        sx={{ py: 2.5, px: 3, borderRadius: 3 }}
                        onClick={() => handleEditMode(profile)}
                      >
                        <ListItemIcon sx={{ minWidth: 60 }}>
                          <Box sx={{ 
                            width: 44, 
                            height: 44, 
                            borderRadius: 2, 
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <ProfileIcon sx={{ color: theme.palette.primary.main, fontSize: 24 }} />
                          </Box>
                        </ListItemIcon>
                        <ListItemText 
                          primary={<Typography sx={{ fontWeight: 800, fontSize: '1rem' }}>{profile.name}</Typography>}
                          secondary={
                              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mt: 1 }}>
                                  <Box sx={{ 
                                      fontSize: '0.65rem', 
                                      fontWeight: 800,
                                      bgcolor: alpha(theme.palette.secondary.main, 0.1), 
                                      color: theme.palette.secondary.main,
                                      px: 1.5, 
                                      py: 0.5,
                                      borderRadius: 1,
                                      textTransform: 'uppercase'
                                  }}>
                                      {profile.credential_type.type === 'CustomEndpoint' ? 'S3 COMPAT' : profile.credential_type.type}
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', opacity: 0.8 }}>
                                      <RegionIcon sx={{ fontSize: 14 }} /> 
                                      <Typography variant="caption" sx={{ fontWeight: 700 }}>{profile.region || 'global'}</Typography>
                                  </Box>
                              </Box>
                          }
                          secondaryTypographyProps={{ component: 'div' }}
                        />
                        <ListItemSecondaryAction sx={{ right: 24 }}>
                          <Box sx={{ display: 'flex', gap: 1.5 }}>
                            <Tooltip title="Settings">
                                <IconButton 
                                  size="small" 
                                  onClick={(e) => { e.stopPropagation(); handleEditMode(profile); }}
                                  sx={{ bgcolor: alpha(theme.palette.action.hover, 0.5), p: 1 }}
                                >
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                                <IconButton 
                                  size="small" 
                                  onClick={(e) => { e.stopPropagation(); handleDelete(profile.id, profile.name); }} 
                                  color="error"
                                  sx={{ bgcolor: alpha(theme.palette.error.main, 0.05), p: 1 }}
                                >
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                          </Box>
                        </ListItemSecondaryAction>
                      </ListItemButton>
                    </ListItem>
                  </Paper>
                ))}
              </List>
              
              <Button 
                fullWidth 
                variant="outlined" 
                startIcon={<AddIcon />}
                onClick={() => { resetForm(); setMode('add'); }}
                sx={{ 
                  mt: 1,
                  borderRadius: 3, 
                  py: 2,
                  fontWeight: 800,
                  borderWidth: '2px !important',
                  borderColor: alpha(theme.palette.divider, 1)
                }}
              >
                Add Another Profile
              </Button>
            </Box>
          )}
      </Box>
    </Fade>
  );
  
  const renderForm = () => (
    <Fade in={mode !== 'list'}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        <TextField
          label="Profile Name"
          placeholder="e.g. Production AWS"
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          fullWidth
          required
          variant="outlined"
          sx={{ 
              mt: 1,
              '& .MuiOutlinedInput-root': { borderRadius: 2, fontWeight: 600 },
          }}
        />
        
        <FormControl fullWidth>
          <InputLabel sx={{ fontWeight: 700 }}>Authentication Method</InputLabel>
          <Select
            value={formData.credentialType}
            label="Authentication Method"
            onChange={(e) => updateField('credentialType', e.target.value)}
            sx={{ borderRadius: 2, fontWeight: 600 }}
          >
            <MenuItem value="Environment">System Environment Variables</MenuItem>
            <MenuItem value="SharedConfig">Local AWS Config File (~/.aws)</MenuItem>
            <MenuItem value="Manual">Manual Credentials (AK/SK)</MenuItem>
            <MenuItem value="CustomEndpoint">Custom S3 / Compatibility Mode</MenuItem>
          </Select>
        </FormControl>
        
        {formData.credentialType === 'Environment' && (
            <Alert 
              severity={awsEnv?.has_access_key ? "success" : "info"}
              variant="filled" 
              sx={{ 
                  borderRadius: 2, 
                  fontWeight: 600,
                  bgcolor: awsEnv?.has_access_key ? alpha(theme.palette.success.main, 0.2) : alpha(theme.palette.info.main, 0.1),
                  color: 'text.primary',
                  border: '1px solid',
                  borderColor: awsEnv?.has_access_key ? theme.palette.success.main : theme.palette.info.main,
                  '& .MuiAlert-icon': { color: awsEnv?.has_access_key ? theme.palette.success.main : theme.palette.info.main } 
              }}
             >
               {awsEnv?.has_access_key ? (
                 <Box>
                   <Typography variant="body2" sx={{ fontWeight: 800 }}>System Credentials Detected</Typography>
                   <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.8 }}>
                     Using: {awsEnv.has_access_key ? 'AWS_ACCESS_KEY_ID' : ''} 
                     {awsEnv.has_secret_key ? ' + SECRET' : ''}
                   </Typography>
                 </Box>
               ) : (
                 <Typography variant="body2" sx={{ fontWeight: 600 }}>No <code>AWS_ACCESS_KEY_ID</code> found. Ensure environment variables are set before launch.</Typography>
               )}
             </Alert>
        )}
        
        {formData.credentialType === 'SharedConfig' && (
          <Autocomplete
            freeSolo
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontWeight: 600 } }}
            value={formData.profileName}
            onInputChange={(_, newValue) => updateField('profileName', newValue)}
            onChange={(_, value) => {
                if (value) {
                    updateField('profileName', value);
                    const found = discoveredProfiles.find((p: any) => p.name === value);
                    if (found?.region) updateField('region', found.region);
                }
            }}
            options={discoveredProfiles.map((p: any) => p.name)}
            renderInput={(params) => (
                <TextField 
                    {...params} 
                    label="Local AWS Profile" 
                    placeholder="default"
                    fullWidth
                />
            )}
          />
        )}
        
        {(formData.credentialType === 'Manual' || formData.credentialType === 'CustomEndpoint') && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, p: 3, borderRadius: 3, border: '1px dashed', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                {formData.credentialType === 'CustomEndpoint' && (
                  <TextField
                    label="Endpoint URL"
                    value={formData.endpointUrl}
                    onChange={(e) => updateField('endpointUrl', e.target.value)}
                    fullWidth
                    placeholder="https://s3.us-east-1.amazonaws.com"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: 'background.paper', fontWeight: 600 } }}
                  />
                )}
                <TextField
                    label="Access Key ID"
                    value={formData.accessKeyId}
                    onChange={(e) => updateField('accessKeyId', e.target.value)}
                    fullWidth
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: 'background.paper', fontWeight: 600 } }}
                />
                <TextField
                    label="Secret Access Key"
                    type="password"
                    value={formData.secretAccessKey}
                    onChange={(e) => updateField('secretAccessKey', e.target.value)}
                    fullWidth
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: 'background.paper', fontWeight: 600 } }}
                />
          </Box>
        )}
        
        <FormControl fullWidth>
          <InputLabel sx={{ fontWeight: 700 }}>Default Region</InputLabel>
          <Select
            value={formData.region}
            label="Default Region"
            onChange={(e) => updateField('region', e.target.value)}
            sx={{ borderRadius: 2, fontWeight: 600 }}
            MenuProps={{ PaperProps: { sx: { maxHeight: 300, borderRadius: 2, border: '1px solid', borderColor: 'divider' } } }}
          >
            {AWS_REGIONS.map((region) => (
              <MenuItem key={region} value={region} sx={{ fontWeight: 600 }}>{region}</MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              variant="text"
              onClick={handleTestConnection}
              disabled={testing}
              startIcon={testing ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
              sx={{ borderRadius: 100, fontWeight: 700, px: 2 }}
            >
              Test Connection
            </Button>
            
            {testResult && (
              <Chip 
                label={testResult.success ? "Connection OK" : "Failed"} 
                color={testResult.success ? "success" : "error"}
                size="small"
                sx={{ fontWeight: 800, borderRadius: 1 }}
              />
            )}
          </Box>
          
          {error && (
            <Alert severity="error" variant="filled" sx={{ borderRadius: 2, fontWeight: 600 }}>{error}</Alert>
          )}
        </Box>
      </Box>
    </Fade>
  );
  
  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title={getDialogTitle()}
      maxWidth="sm"
      fullWidth
      actions={
        mode !== 'list' ? (
          <Box sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', px: 1 }}>
            <Button 
              onClick={() => setMode('list')} 
              disabled={saving} 
              sx={{ fontWeight: 700, color: 'text.secondary' }}
            >
              Cancel
            </Button>
            <Button 
              variant="contained" 
              onClick={handleSave}
              disabled={saving}
              sx={{ 
                  px: 5, 
                  py: 1,
                  borderRadius: 100, 
                  fontWeight: 800,
                  boxShadow: `0 8px 20px ${alpha(theme.palette.primary.main, 0.2)}`
              }}
            >
              {saving ? 'Saving...' : mode === 'edit' ? 'Update Profile' : 'Connect Account'}
            </Button>
          </Box>
        ) : null
      }
    >
      {mode === 'list' && !editProfile ? renderList() : renderForm()}
    </BaseDialog>
  );
}
