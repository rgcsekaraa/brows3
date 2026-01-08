'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
} from '@mui/material';
import {
  Search as SearchIcon,
  Cloud as CloudIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
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
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell width={120}>Region</TableCell>
                <TableCell width={150}>Created</TableCell>
                <TableCell width={100} align="right">Size</TableCell>
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
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 450, mx: 'auto', mb: 2 }}>
            This profile doesn't have permission to list buckets, or there are no buckets available.
          </Typography>
          <Alert severity="info" sx={{ maxWidth: 450, mx: 'auto', mb: 3, textAlign: 'left' }}>
            <Typography variant="body2">
              <strong>Tip:</strong> If you have access to specific buckets, use the <strong>path bar</strong> in the navbar to navigate directly. Type a bucket name or S3 URI like <code>s3://my-bucket/</code>
            </Typography>
          </Alert>
          <IconButton onClick={() => refresh()} color="primary">
            <RefreshIcon />
          </IconButton>
        </Box>
      );
    }
    
    return (
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table sx={{ minWidth: 650 }} aria-label="buckets table">
          <TableHead>
            <TableRow sx={{ bgcolor: 'background.default' }}>
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
                  transition: 'background-color 0.2s',
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
                    sx={{ height: 24, fontSize: '0.75rem', borderColor: 'divider' }} 
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
  
  return (
    <Box sx={{ p: 1, mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
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
