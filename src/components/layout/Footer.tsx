'use client';

import { Box, Typography, Divider, Badge, Tooltip, IconButton } from '@mui/material';
import { 
    CloudDone as CloudDoneIcon, 
    SwapVert as TransferIcon,
    Dns as ProfileIcon,
    Public as RegionIcon
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { useTransferStore } from '@/store/transferStore';
import { useBuckets } from '@/hooks/useBuckets';

export default function Footer() {
  const { profiles, activeProfileId } = useProfileStore();
  const { jobs } = useTransferStore();
  const { buckets } = useBuckets();
  
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeTransfers = jobs.filter(j => j.status === 'Queued' || j.status === 'InProgress');
  
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
             <TransferIcon sx={{ fontSize: 14, color: activeTransfers.length > 0 ? 'primary.main' : 'inherit' }} />
             <Typography variant="caption">{activeTransfers.length}</Typography>
           </Box>
        </Tooltip>
      </Box>

      {/* Production Version */}
      <Typography variant="caption" sx={{ color: 'text.disabled', ml: 1 }}>
        Brows3 v1.0.0-rc1
      </Typography>
    </Box>
  );
}
