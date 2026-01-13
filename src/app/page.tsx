'use client';

import { useState, useMemo, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Alert,
  Tooltip,
  Button,
  Container,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  Search as SearchIcon,
  Cloud as CloudIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ArrowForward as GoIcon,
  History as HistoryIcon,
  Explore as ExploreIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { useBuckets } from '@/hooks/useBuckets';
import { useHistoryStore } from '@/store/historyStore';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/toastStore';

function HomeContent() {
  const router = useRouter();
  const { activeProfileId, profiles } = useProfileStore();
  const { recentPaths, addPath } = useHistoryStore();
  const { addTab } = useAppStore();
  
  // Use query parameter to toggle view instead of local state
  const searchParams = useSearchParams();
  const showBuckets = searchParams.get('view') === 'discovery';
  const { buckets, isLoading, error, refresh, fetchBuckets } = useBuckets({ enabled: showBuckets });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [s3UriInput, setS3UriInput] = useState('');
  
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  // ... rest of the component logic ...
  

  const filteredBuckets = useMemo(() => {
    if (!searchQuery.trim()) return buckets;
    const query = searchQuery.toLowerCase();
    return buckets.filter(bucket => 
      bucket.name.toLowerCase().includes(query) || 
      bucket.region.toLowerCase().includes(query)
    );
  }, [buckets, searchQuery]);

  const handleFetchBuckets = () => {
    router.push('/?view=discovery');
  };

  const validateAndParsePath = (path: string): { bucket: string; prefix: string; hasTrailingSlash: boolean } | null => {
    const trimmedPath = path.trim();
    if (!trimmedPath.startsWith('s3://')) return null;
    
    // Check if it's a valid S3 URI format: s3://bucket-name or s3://bucket-name/prefix/
    // Supports explicit region: s3://bucket-name@region/prefix/
    const s3UriMatch = trimmedPath.match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:@([a-z0-9-]+))?(\/(.*))?$/i);
    
    if (s3UriMatch) {
      const bucket = s3UriMatch[1];
      let rawPrefix = s3UriMatch[4] || '';
      const hasTrailingSlash = rawPrefix.endsWith('/');
      const prefix = rawPrefix.replace(/\/$/, '');
      return { bucket, prefix, hasTrailingSlash };
    }
    return null;
  };

  const isNavigating = useRef(false);

  const handleNavigate = (path: string) => {
    // 1. Prevent double navigation in the same frame
    if (isNavigating.current) return;
    isNavigating.current = true;
    setTimeout(() => { isNavigating.current = false; }, 500);

    const trimmedPath = path.trim();
    if (!trimmedPath) {
      toast.error('Enter S3 URI', 'Please enter a valid S3 URI.');
      return;
    }

    const parsed = validateAndParsePath(trimmedPath);
    if (!parsed) {
      toast.error('Invalid S3 URI', 'Path must start with s3://bucket-name/');
      return;
    }
    
    const { bucket, prefix, hasTrailingSlash } = parsed;
    
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    // Priority: 1. Discovered region, 2. Profile default
    const discoveredRegion = useAppStore.getState().discoveredRegions[bucket];
    const region = discoveredRegion || activeProfile?.region || 'us-east-1';
    
    // Determine if we should append a slash
    let finalPrefix = prefix;
    if (prefix) {
        const hasExtension = /\.[a-zA-Z0-9]{2,10}$/.test(prefix);
        if (hasTrailingSlash || !hasExtension) {
            finalPrefix = prefix + '/';
        } else {
            finalPrefix = prefix;
        }
    }

    const urlPath = `/bucket?name=${bucket}&region=${region}${finalPrefix ? `&prefix=${encodeURIComponent(finalPrefix)}` : ''}`;
    addPath(`s3://${bucket}/${finalPrefix}`);
    addTab({ title: bucket, path: urlPath, icon: 'bucket' });
    router.push(urlPath);
  };

  // Show error as toast
  useEffect(() => {
    if (error && showBuckets) {
      toast.error('Failed to load buckets', error);
    }
  }, [error, showBuckets]);
  
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
  
  const renderBucketList = () => {
    if (isLoading) {
      return (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell width={120} sx={{ fontWeight: 600 }}>Region</TableCell>
                <TableCell width={150} sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell width={100} align="right" sx={{ fontWeight: 600 }}>Size</TableCell>
                <TableCell width={50}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Skeleton variant="circular" width={32} height={32} />
                      <Skeleton variant="text" width={200} />
                    </Box>
                  </TableCell>
                  <TableCell><Skeleton variant="text" width={80} /></TableCell>
                  <TableCell><Skeleton variant="text" width={100} /></TableCell>
                  <TableCell align="right"><Skeleton variant="text" width={60} /></TableCell>
                  <TableCell><Skeleton variant="circular" width={24} height={24} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      );
    }
    
    if (filteredBuckets.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', py: 8, bgcolor: 'action.hover', borderRadius: 2, border: '1px dashed', borderColor: 'divider' }}>
          <FolderOpenIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2, opacity: 0.5 }} />
          <Typography variant="h6" color="text.secondary">
            {searchQuery ? 'No buckets match your search' : 'No Buckets Found'}
          </Typography>
          <Button 
            startIcon={<RefreshIcon />} 
            onClick={() => refresh()} 
            sx={{ mt: 2 }}
          >
            Refresh List
          </Button>
        </Box>
      );
    }
    
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 4, borderRadius: 1.5, overflow: 'hidden' }}>
      <Table sx={{ minWidth: 650 }} aria-label="buckets table">
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 600 }}>Bucket Name</TableCell>
            <TableCell sx={{ fontWeight: 600 }} width={140}>Region</TableCell>
            <TableCell sx={{ fontWeight: 600 }} width={180}>Created</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right" width={120}>Total Size</TableCell>
            <TableCell width={60}></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredBuckets.map((bucket) => (
            <TableRow
              key={bucket.name}
              hover
              onClick={() => router.push(`/bucket?name=${bucket.name}&region=${bucket.region}`)}
              sx={{ 
                cursor: 'pointer',
                '&:last-child td, &:last-child th': { border: 0 },
                transition: 'background-color 0s', // Theme standard speed
              }}
            >
              <TableCell component="th" scope="row">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <StorageIcon color="primary" sx={{ fontSize: 24, opacity: 0.8 }} />
                  <Typography variant="body1" fontWeight={500}>
                    {bucket.name}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell>
                <Chip 
                  label={bucket.region} 
                  size="small" 
                  variant="outlined" 
                  sx={{ height: 24, fontSize: '0.75rem', borderColor: 'divider', borderRadius: 1.5 }} 
                />
              </TableCell>
              <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                {bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString() : '—'}
              </TableCell>
              <TableCell align="right" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {bucket.total_size_formatted || '—'}
              </TableCell>
              <TableCell align="right">
                  <ChevronRightIcon color="action" fontSize="small" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};


  const renderLanding = () => (
    <Box sx={{ 
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
      py: 4
    }}>
      <Container maxWidth="sm">

        <Paper 
          variant="outlined"
          sx={{ 
            p: 4, 
            borderRadius: 1.5,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
            Direct Access
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 4 }}>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              placeholder="s3://bucket/prefix/"
              value={s3UriInput}
              onChange={(e) => setS3UriInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNavigate(s3UriInput)}
              sx={{ 
                '& .MuiOutlinedInput-root': { 
                    borderRadius: 1.5,
                    bgcolor: 'action.hover'
                } 
              }}
            />
            <Button 
                variant="contained" 
                disableElevation
                onClick={() => handleNavigate(s3UriInput)}
                sx={{ borderRadius: 1.5, px: 3, fontWeight: 700 }}
            >
                Go
            </Button>
          </Box>

          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 3, mb: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Or browse all resources in your active profile
            </Typography>
            <Button 
                variant="outlined" 
                onClick={handleFetchBuckets}
                startIcon={<StorageIcon />}
                sx={{ 
                    borderRadius: 1.5, 
                    py: 1, 
                    px: 4,
                    minWidth: 200,
                    fontWeight: 700,
                    borderColor: 'divider',
                    color: 'text.primary',
                    '&:hover': { bgcolor: 'action.hover', borderColor: 'text.primary' }
                }}
            >
                List All Buckets
            </Button>
          </Box>
        </Paper>

        {/* Recently Visited */}
        {recentPaths.length > 0 && (
            <Box sx={{ mt: 6, textAlign: 'center' }}>
                <Typography variant="caption" color="text.disabled" fontWeight={700} sx={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Recent Paths
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, mt: 2 }}>
                    {recentPaths.slice(0, 3).map((path) => (
                        <Chip
                            key={path}
                            label={path}
                            onClick={() => handleNavigate(path)}
                            variant="outlined"
                            size="small"
                            sx={{ 
                                borderRadius: 1.5,
                                fontSize: '0.75rem',
                                color: 'text.secondary',
                                maxWidth: '200px',
                                transition: 'all 0.1s',
                                '&:hover': {
                                    bgcolor: 'action.hover',
                                    color: 'primary.main',
                                    borderColor: 'primary.main'
                                }
                            }}
                        />
                    ))}
                </Box>
            </Box>
        )}
      </Container>
    </Box>
  );
  
  return (
    <Box sx={{ p: 1, mt: 1 }}>
      {showBuckets ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton onClick={() => router.push('/')} sx={{ bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                    <FolderOpenIcon />
                </IconButton>
              <Box>
                <Typography variant="h4" fontWeight={800}>
                  All Buckets
                </Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  {activeProfile.name} • {filteredBuckets.length} buckets
                </Typography>
              </Box>
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
                <IconButton 
                  onClick={() => refresh()} 
                  disabled={isLoading} 
                  color="primary" 
                  sx={{ 
                    bgcolor: 'background.paper', 
                    border: '1px solid', 
                    borderColor: 'divider',
                    boxShadow: 1
                  }}
                >
                  <RefreshIcon className={isLoading ? 'spin-animation' : ''} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
          {renderBucketList()}
        </>
      ) : renderLanding()}
      
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

export default function Home() {
  return (
    <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>}>
      <HomeContent />
    </Suspense>
  );
}
