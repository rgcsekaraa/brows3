'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Skeleton,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Cloud as CloudIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { useBuckets } from '@/hooks/useBuckets';
import { toast } from '@/store/toastStore';
import { useEffect } from 'react';

export default function Home() {
  const router = useRouter();
  const { activeProfileId, profiles } = useProfileStore();
  const { buckets, isLoading, error, refresh } = useBuckets();
  const [searchQuery, setSearchQuery] = useState('');
  
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  
  const filteredBuckets = useMemo(() => {
    if (!searchQuery.trim()) return buckets;
    const query = searchQuery.toLowerCase();
    return buckets.filter(bucket => 
      bucket.name.toLowerCase().includes(query) || 
      bucket.region.toLowerCase().includes(query)
    );
  }, [buckets, searchQuery]);

  // Show error as toast
  useEffect(() => {
    if (error) {
      toast.error('Failed to load buckets', error);
    }
  }, [error]);
  
  if (!activeProfile) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '60vh', 
        textAlign: 'center', 
        p: 3 
      }}>
        <CloudIcon sx={{ fontSize: 100, color: 'text.secondary', mb: 3, opacity: 0.5 }} />
        <Typography variant="h5" color="text.primary" gutterBottom fontWeight={600}>
          No Profile Selected
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 400, mb: 4 }}>
          Select an existing profile from the top bar or create a new one to start browsing your S3 buckets.
        </Typography>
      </Box>
    );
  }
  
  const renderContent = () => {
    if (isLoading && buckets.length === 0) {
      return (
        <Grid container spacing={2}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={i}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <Skeleton variant="circular" width={40} height={40} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="80%" height={28} />
                      <Skeleton variant="text" width="40%" height={20} />
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Skeleton variant="text" width="30%" />
                    <Skeleton variant="text" width="30%" />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      );
    }
    
    if (filteredBuckets.length === 0) {
      if (searchQuery) {
        return (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary">
              No buckets match your search
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try adjusting your filter or search term
            </Typography>
          </Box>
        );
      }
      
      return (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <FolderOpenIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2, opacity: 0.5 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Buckets Found
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, mx: 'auto', mb: 3 }}>
            This profile doesn't seem to have any buckets, or we couldn't list them.
          </Typography>
          <IconButton onClick={() => refresh()} color="primary">
            <RefreshIcon />
          </IconButton>
        </Box>
      );
    }
    
    return (
      <Grid container spacing={2}>
        {filteredBuckets.map((bucket) => (
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={bucket.name}>
            <Card
              variant="outlined"
              onClick={() => router.push(`/bucket?name=${bucket.name}&region=${bucket.region}`)}
              sx={{
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: 4,
                  borderColor: 'primary.main',
                },
              }}
            >
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
                  <StorageIcon color="primary" sx={{ fontSize: 32 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography 
                      variant="subtitle1" 
                      title={bucket.name}
                      sx={{ 
                        fontWeight: 600, 
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bucket.name}
                    </Typography>
                    <Chip 
                      label={bucket.region} 
                      size="small" 
                      variant="outlined"
                      sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                    />
                  </Box>
                </Box>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between', color: 'text.secondary', fontSize: '0.8125rem' }}>
                  <Typography variant="body2" component="span">
                    {bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString() : 'Unknown date'}
                  </Typography>
                  {bucket.total_size_formatted && (
                    <Typography variant="body2" component="span" fontWeight={500}>
                      {bucket.total_size_formatted}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };
  
  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Buckets
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {activeProfile.name} • {filteredBuckets.length} buckets
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            placeholder="Search buckets..."
            size="small"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: 250 }}
          />
          <Tooltip title="Refresh bucket list">
            <IconButton onClick={() => refresh()} disabled={isLoading} color="primary" sx={{ bgcolor: 'action.hover' }}>
              <RefreshIcon className={isLoading ? 'spin-animation' : ''} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {renderContent()}
      
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin-animation {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </Box>
  );
}
