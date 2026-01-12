'use client';

import { Box, Typography, Divider, Badge, Tooltip, IconButton, Chip } from '@mui/material';
import { 
    CloudDone as CloudDoneIcon, 
    SwapVert as TransferIcon,
    Dns as ProfileIcon,
    Public as RegionIcon,
    Cached as CachedIcon,
    Info as InfoIcon,
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { useTransferStore } from '@/store/transferStore';
import { useBuckets } from '@/hooks/useBuckets';
import { useMemo } from 'react';

function formatCacheAge(ms: number | null): string {
  if (ms === null) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function Footer() {
  const { profiles, activeProfileId } = useProfileStore();
  const { jobs } = useTransferStore();
  const { buckets, isCached, cacheAge, isLoading } = useBuckets();
  
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeTransfers = jobs.filter(j => j.status === 'Queued' || j.status === 'InProgress');
  
  const cacheStatus = useMemo(() => {
    if (isLoading) return { label: 'Loading...', color: 'default' as const };
    if (isCached) return { label: `Cached ${formatCacheAge(cacheAge)}`, color: 'success' as const };
    return { label: '● Live', color: 'primary' as const };
  }, [isCached, cacheAge, isLoading]);
  
  return (
    <Box
      component="footer"
      sx={{
        height: 28,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        px: 2,
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.drawer + 1,
        gap: 2,
      }}
    >
      {/* Profile & Region Info */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        <ProfileIcon sx={{ fontSize: 14 }} />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {activeProfile?.name || 'No Profile'}
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />
        <RegionIcon sx={{ fontSize: 14 }} />
        <Typography variant="caption">
          {activeProfile?.region || 'N/A'}
        </Typography>
      </Box>

      <Box sx={{ flexGrow: 1 }} />

      {/* Cost Awareness Notice */}
      {activeProfile && (
        <Tooltip title="S3 API calls incur charges. Cache auto-refreshes after uploads/deletes within the app.">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.disabled', cursor: 'help' }}>
            <InfoIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
              API costs apply
            </Typography>
          </Box>
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

      {/* Cache Status */}
      {activeProfile && (
        <Tooltip title="Bucket list is cached to reduce API calls. Click refresh to update.">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: isCached ? 'success.main' : 'primary.main' }}>
            <CachedIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
              {cacheStatus.label}
            </Typography>
          </Box>
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

      {/* Stats Summary */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary' }}>
        <Tooltip title={`${buckets.length} Buckets Found`}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
             <CloudDoneIcon sx={{ fontSize: 14, color: activeProfile ? 'success.main' : 'inherit' }} />
             <Typography variant="caption">{buckets.length}</Typography>
           </Box>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

        <Tooltip title={`${activeTransfers.length} Active Transfers`}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
             <TransferIcon sx={{ fontSize: 13, color: activeTransfers.length > 0 ? 'primary.main' : 'inherit' }} />
             <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>{activeTransfers.length}</Typography>
           </Box>
        </Tooltip>
      </Box>

      {/* Production Version */}
      <Typography variant="caption" sx={{ color: 'text.disabled', ml: 1, fontSize: '0.65rem' }}>
        Brows3 v0.2.12
      </Typography>
    </Box>
  );
}

