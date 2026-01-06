'use client';

import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Cloud as CloudIcon,
  Dns as ProfileIcon,
  Public as RegionIcon,
} from '@mui/icons-material';
import { Profile, CredentialType, profileApi, isTauri, TestConnectionResult } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

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
  const { profiles, setProfiles, addProfile, updateProfile, removeProfile } = useProfileStore();
  
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
  const [discoveredProfiles, setDiscoveredProfiles] = useState<string[]>([]);
  const [awsEnv, setAwsEnv] = useState<{ has_access_key: boolean; has_secret_key: boolean; has_session_token: boolean; region?: string } | null>(null);

  // Discover local profiles and check environment
  useEffect(() => {
    if (open) {
        profileApi.discoverLocalProfiles()
          .then(setDiscoveredProfiles)
          .catch(err => setError(err instanceof Error ? err.message : String(err)));
          
        profileApi.checkAwsEnvironment()
          .then(setAwsEnv)
          .catch(console.error);
    }
  }, [open]);
  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

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
      region: 'us-east-1',
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
        // Ensure we preserve the ID and other fields
        const profileToUpdate = { 
            ...selectedProfile, 
            ...profileData, 
            id: selectedProfile.id 
        };
        const updated = await profileApi.updateProfile(selectedProfile.id, profileToUpdate);
        updateProfile(selectedProfile.id, updated);
      } else {
        // For new profile, backend handles ID or we let it fail if not provided?
        // Usually addProfile expects a profile object. 
        // If the Rust add_profile generates ID, we can pass partial. 
        // But better to let the backend validation handle it.
        const created = await profileApi.addProfile(profileData as Profile);
        addProfile(created);
      }
      
      setMode('list');
      resetForm();
      if (editProfile) onClose(); // Close if we were editing a specific profile
    } catch (err) {
      console.error('Save error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  
  const handleDelete = async (profileID: string, profileName: string) => {
    if (!confirm(`Delete profile "${profileName}"?`)) return;
    
    try {
      await profileApi.deleteProfile(profileID);
      removeProfile(profileID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };
  
  const handleEditMode = (profile: Profile) => {
    setSelectedProfile(profile);
    loadProfileToForm(profile);
    setMode('edit');
  };
  
  const renderList = () => (
    <Fade in={mode === 'list'}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DialogTitle component="div" sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          pb: 1,
          px: 3,
          pt: 3
        }}>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.5px' }}>
            Cloud Profiles
          </Typography>
          <IconButton onClick={onClose} size="small" sx={{ bgcolor: 'action.hover' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ minWidth: 500, minHeight: 400, px: 3 }}>
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
                width: 80, 
                height: 80, 
                borderRadius: '50%', 
                bgcolor: 'primary.main', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                color: 'primary.contrastText',
                mb: 3,
                boxShadow: '0 8px 32px rgba(255, 153, 0, 0.3)'
              }}>
                <CloudIcon sx={{ fontSize: 40 }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Setup Your First Profile</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4, maxWidth: 300 }}>
                Connect your AWS or S3-compatible account to start browsing your buckets.
              </Typography>
              <Button 
                variant="contained"
                size="large"
                startIcon={<AddIcon />} 
                onClick={() => setMode('add')}
                sx={{ 
                  borderRadius: 100, 
                  px: 4,
                  py: 1.5,
                  boxShadow: '0 4px 14px 0 rgba(255, 153, 0, 0.39)',
                  '&:hover': {
                    boxShadow: '0 6px 20px rgba(255, 153, 0, 0.23)',
                  }
                }}
              >
                Create New Profile
              </Button>
            </Box>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, mb: 1.5, display: 'block' }}>
                ACTIVE CONNECTIONS
              </Typography>
              <List sx={{ pt: 0 }}>
                {profiles.map((profile) => (
                  <Paper 
                    key={profile.id} 
                    elevation={0}
                    sx={{ 
                      mb: 1.5, 
                      borderRadius: 2, 
                      bgcolor: 'action.hover',
                      border: '1px solid',
                      borderColor: 'divider',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: 'action.selected',
                        transform: 'translateY(-2px)'
                      }
                    }}
                  >
                    <ListItem disablePadding>
                      <ListItemButton 
                        sx={{ py: 2, px: 2 }}
                        onClick={() => handleEditMode(profile)}
                      >
                        <ListItemIcon sx={{ minWidth: 48 }}>
                          <Box sx={{ 
                            width: 36, 
                            height: 36, 
                            borderRadius: 1, 
                            bgcolor: 'background.paper',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '1px solid',
                            borderColor: 'divider'
                          }}>
                            <ProfileIcon color="primary" sx={{ fontSize: 20 }} />
                          </Box>
                        </ListItemIcon>
                        <ListItemText 
                          primary={<Typography component="span" variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{profile.name}</Typography>}
                          secondary={
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.8 }}>
                                  <Box sx={{ 
                                      fontSize: '0.65rem', 
                                      fontWeight: 800,
                                      bgcolor: 'secondary.main', 
                                      color: 'secondary.contrastText',
                                      px: 1, 
                                      py: 0.3,
                                      borderRadius: 0.5,
                                      textTransform: 'uppercase'
                                  }}>
                                      {profile.credential_type.type === 'CustomEndpoint' ? 'S3 COMPAT' : profile.credential_type.type}
                                  </Box>
                                  <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', fontWeight: 500 }}>
                                      <RegionIcon sx={{ fontSize: 13 }} /> {profile.region || 'global'}
                                  </Typography>
                              </Box>
                          }
                          secondaryTypographyProps={{ component: 'div' }}
                        />
                        <ListItemSecondaryAction sx={{ right: 24 }}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Tooltip title="Edit Settings">
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleEditMode(profile); }} sx={{ bgcolor: 'background.paper' }}>
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(profile.id, profile.name); }} color="error" sx={{ bgcolor: 'background.paper' }}>
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
            </>
          )}
        </DialogContent>
        {profiles.length > 0 && (
            <DialogActions sx={{ p: 3, pt: 0 }}>
              <Button 
                fullWidth 
                variant="outlined" 
                startIcon={<AddIcon />}
                onClick={() => { resetForm(); setMode('add'); }}
                sx={{ 
                  borderRadius: 2, 
                  py: 1.2,
                  fontWeight: 700,
                  borderWidth: 2,
                  '&:hover': { borderWidth: 2 }
                }}
              >
                Add Another Profile
              </Button>
            </DialogActions>
        )}
      </Box>
    </Fade>
  );
  
  const renderForm = () => (
    <Fade in={mode !== 'list'}>
      <Box sx={{ p: 1 }}>
        <DialogTitle component="div" sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          pb: 1,
          px: 2,
          pt: 1
        }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {mode === 'edit' ? 'Update Profile' : 'New Cloud Connection'}
          </Typography>
          <IconButton size="small" onClick={() => setMode('list')} sx={{ bgcolor: 'action.hover' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3, px: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            <TextField
              label="Connection Name"
              placeholder="e.g. Production AWS"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              fullWidth
              required
              variant="outlined"
              sx={{ 
                  mt: 1,
                  '& .MuiOutlinedInput-root': { borderRadius: 2 },
                  '& .MuiInputLabel-root': { fontWeight: 600 }
              }}
            />
            
            <FormControl fullWidth variant="outlined">
              <InputLabel sx={{ fontWeight: 600 }}>Provider / Auth Method</InputLabel>
              <Select
                value={formData.credentialType}
                label="Provider / Auth Method"
                onChange={(e) => updateField('credentialType', e.target.value)}
                sx={{ borderRadius: 2 }}
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
                  variant="outlined" 
                  sx={{ 
                      borderRadius: 2, 
                      bgcolor: awsEnv?.has_access_key ? 'success.main' : 'info.main', 
                      color: awsEnv?.has_access_key ? 'success.contrastText' : 'info.contrastText',
                      '& .MuiAlert-icon': { color: awsEnv?.has_access_key ? 'success.contrastText' : 'info.contrastText' } 
                  }}
                 >
                   {awsEnv?.has_access_key ? (
                     <Box>
                       <Typography variant="body2" sx={{ fontWeight: 700 }}>Real credentials detected in shell!</Typography>
                       <Typography variant="caption" sx={{ opacity: 0.9 }}>
                         Using: {awsEnv.has_access_key ? 'AWS_ACCESS_KEY_ID' : ''} 
                         {awsEnv.has_secret_key ? ' + SECRET' : ''}
                         {awsEnv.region ? ` (${awsEnv.region})` : ''}
                       </Typography>
                     </Box>
                   ) : (
                     <Typography variant="body2">No <code>AWS_ACCESS_KEY_ID</code> detected in system environment. This only works if you launched the app from a terminal with these set.</Typography>
                   )}
                 </Alert>
            )}
            
            {formData.credentialType === 'SharedConfig' && (
              <Autocomplete
                freeSolo
                value={formData.profileName}
                onInputChange={(_, newValue) => updateField('profileName', newValue)}
                options={discoveredProfiles}
                renderInput={(params) => (
                    <TextField 
                        {...params} 
                        label="Local AWS Profile" 
                        variant="outlined" 
                        placeholder="default"
                        helperText="Found profiles in your local machine"
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                    />
                )}
                fullWidth
              />
            )}
            
            {(formData.credentialType === 'Manual' || formData.credentialType === 'CustomEndpoint') && (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2, borderStyle: 'dashed' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    {formData.credentialType === 'CustomEndpoint' && (
                      <TextField
                        label="Endpoint URL"
                        value={formData.endpointUrl}
                        onChange={(e) => updateField('endpointUrl', e.target.value)}
                        fullWidth
                        placeholder="https://s3.us-east-1.amazonaws.com"
                        variant="outlined"
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: 'background.paper' } }}
                      />
                    )}
                    <TextField
                        label="Access Key ID"
                        value={formData.accessKeyId}
                        onChange={(e) => updateField('accessKeyId', e.target.value)}
                        fullWidth
                        variant="outlined"
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: 'background.paper' } }}
                    />
                    <TextField
                        label="Secret Access Key"
                        type="password"
                        value={formData.secretAccessKey}
                        onChange={(e) => updateField('secretAccessKey', e.target.value)}
                        fullWidth
                        variant="outlined"
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: 'background.paper' } }}
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 500 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
                        Stored securely in your system's native keychain.
                    </Typography>
                </Box>
              </Paper>
            )}
            
            <FormControl fullWidth variant="outlined">
              <InputLabel>Default Region</InputLabel>
              <Select
                value={formData.region}
                label="Default Region"
                onChange={(e) => updateField('region', e.target.value)}
                sx={{ borderRadius: 2 }}
                MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
              >
                {AWS_REGIONS.map((region) => (
                  <MenuItem key={region} value={region}>{region}</MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Button
                variant="outlined"
                onClick={handleTestConnection}
                disabled={testing}
                startIcon={testing ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
                sx={{ 
                    alignSelf: 'flex-start', 
                    borderRadius: 100, 
                    px: 3, 
                    fontWeight: 700,
                    textTransform: 'none'
                }}
              >
                Test Connection
              </Button>
              
              {testResult && (
                <Alert 
                  severity={testResult.success ? 'success' : 'error'} 
                  sx={{ borderRadius: 2, fontWeight: 600 }}
                >
                  {testResult.message}
                </Alert>
              )}
            </Box>
            
            {error && (
              <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>{error}</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1, justifyContent: 'space-between' }}>
          <Button onClick={() => setMode('list')} disabled={saving} variant="text" sx={{ fontWeight: 700 }}>
              Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ 
                px: 5, 
                py: 1.2,
                borderRadius: 100, 
                fontWeight: 800,
                boxShadow: 4
            }}
          >
            {mode === 'edit' ? 'Update Profile' : 'Connect Account'}
          </Button>
        </DialogActions>
      </Box>
    </Fade>
  );
  
  return (
    <Dialog 
        open={open} 
        onClose={onClose} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
            sx: { 
                borderRadius: 3, 
                boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
                backgroundImage: 'none',
                bgcolor: 'background.paper',
                overflow: 'hidden'
            }
        }}
    >
      {mode === 'list' && !editProfile ? renderList() : renderForm()}
    </Dialog>
  );
}
