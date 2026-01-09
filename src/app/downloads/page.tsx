'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Collapse,
} from '@mui/material';
import {
  CloudDownload as DownloadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Sync as SyncIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  FolderOpen as FolderOpenIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Stop as StopIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useTransferStore } from '@/store/transferStore';
import { TransferJob } from '@/lib/tauri';

// Format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Format duration
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};

// Format time ago
const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

// Get status info
const getStatusInfo = (status: TransferJob['status']): { label: string; color: 'success' | 'error' | 'warning' | 'info' | 'default'; icon: React.ReactNode } => {
  if (status === 'Completed') {
    return { label: 'Completed', color: 'success', icon: <CheckCircleIcon fontSize="small" /> };
  }
  if (status === 'InProgress') {
    return { label: 'Downloading', color: 'info', icon: <SyncIcon fontSize="small" className="spin" /> };
  }
  if (status === 'Queued') {
    return { label: 'Queued', color: 'default', icon: <ScheduleIcon fontSize="small" /> };
  }
  if (typeof status === 'object' && 'Failed' in status) {
    return { label: 'Failed', color: 'error', icon: <ErrorIcon fontSize="small" /> };
  }
  return { label: String(status), color: 'default', icon: null };
};

export default function DownloadsPage() {
  const { jobs, setJobs } = useTransferStore();
  
  // Filter only downloads
  const downloads = useMemo(() => 
    jobs.filter(j => j.transfer_type === 'Download')
      .sort((a, b) => b.created_at - a.created_at),
  [jobs]);
  
  // Stats
  const stats = useMemo(() => {
    const active = downloads.filter(d => d.status === 'InProgress' || d.status === 'Queued');
    const completed = downloads.filter(d => d.status === 'Completed');
    const failed = downloads.filter(d => typeof d.status === 'object' && 'Failed' in d.status);
    
    const totalBytes = active.reduce((sum, d) => sum + d.total_bytes, 0);
    const processedBytes = active.reduce((sum, d) => sum + d.processed_bytes, 0);
    
    return {
      activeCount: active.length,
      completedCount: completed.length,
      failedCount: failed.length,
      totalBytes,
      processedBytes,
      progress: totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 0,
    };
  }, [downloads]);

  const { refreshJobs, clearCompleted: clearCompletedStore } = useTransferStore();

  // Grouping logic
  const groupedDownloads = useMemo(() => {
    const groups: Record<string, TransferJob[]> = {};
    const standalone: TransferJob[] = [];
    
    downloads.forEach(job => {
      if (job.parent_group_id) {
        if (!groups[job.parent_group_id]) {
          groups[job.parent_group_id] = [];
        }
        groups[job.parent_group_id].push(job);
      } else {
        standalone.push(job);
      }
    });
    
    // Convert groups to array for sorting
    const groupList = Object.entries(groups).map(([groupId, items]) => {
      // Find latest date in group
      const latest = Math.max(...items.map(i => i.created_at));
      // Use group_name from first item
      const name = items[0].group_name || 'Unknown Group';
      
      return {
        id: groupId,
        isGroup: true,
        items,
        latest,
        name
      };
    });
    
    // Combine and sort
    return [
        ...standalone.map(j => ({ id: j.id, isGroup: false, item: j, latest: j.created_at })),
        ...groupList
    ].sort((a, b) => b.latest - a.latest);
  }, [downloads]);

  const clearCompleted = () => {
      clearCompletedStore();
  };

  return (
    <Box sx={{ p: 1, mt: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <DownloadIcon color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Downloads
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {stats.activeCount > 0 
                ? `${stats.activeCount} active • ${formatBytes(stats.processedBytes)} / ${formatBytes(stats.totalBytes)}`
                : `${downloads.length} total downloads`}
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          {(stats.completedCount > 0 || stats.failedCount > 0) && (
            <Button 
              variant="outlined" 
              size="small"
              startIcon={<DeleteIcon />}
              onClick={clearCompleted}
            >
              Clear Completed
            </Button>
          )}
        </Box>
      </Box>

      {/* Overall Progress */}
      {stats.activeCount > 0 && (
        <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              Overall Progress
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {stats.activeCount} files remaining
            </Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={stats.progress} 
            sx={{ height: 6, borderRadius: 1 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {formatBytes(stats.processedBytes)} / {formatBytes(stats.totalBytes)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {Math.round(stats.progress)}%
            </Typography>
          </Box>
        </Paper>
      )}

      {/* Downloads Table */}
      {downloads.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <DownloadIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No downloads yet
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Download files from your S3 buckets and they will appear here
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 50 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 150 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }}>Started</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 80 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groupedDownloads.map((row: any) => (
                 row.isGroup ? 
                    <GroupRow key={row.id} group={row} /> :
                    <SingleRow key={row.id} job={row.item} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
          {stats.failedCount > 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1 }}>
              <strong>{stats.failedCount}</strong> failed
            </Typography>
          )}

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </Box>
  );
}

function SingleRow({ job, isNested = false }: { job: TransferJob; isNested?: boolean }) {
    const status = getStatusInfo(job.status);
    const progress = job.total_bytes > 0 ? (job.processed_bytes / job.total_bytes) * 100 : 0;
    const { cancelJob, retryJob } = useTransferStore();
    
    // Actions
    const handleCancel = () => cancelJob(job.id);
    const handleRetry = () => retryJob(job.id);

    return (
        <TableRow sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: isNested ? 'action.hover' : 'inherit' }}>
            <TableCell component="th" scope="row" sx={{ pl: isNested ? 4 : 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                     {!isNested && <Typography variant="body2" sx={{ fontWeight: 500 }}>{job.key.split('/').pop()}</Typography>}
                     {isNested && <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{job.key.split('/').pop()}</Typography>}
                     <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {formatTimeAgo(job.created_at)}
                     </Typography>
                </Box>
            </TableCell>
            <TableCell>{formatBytes(job.total_bytes)}</TableCell>
            <TableCell>
                 <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: '100%', mr: 1 }}>
                        <LinearProgress variant="determinate" value={progress} color={status.color as any} sx={{ height: 4, borderRadius: 1 }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{Math.round(progress)}%</Typography>
                </Box>
            </TableCell>
            <TableCell>
                <Chip 
                    icon={status.icon as any} 
                    label={status.label} 
                    size="small" 
                    color={status.color as any} 
                    variant="outlined" 
                    sx={{ borderRadius: 1, height: 24 }}
                />
            </TableCell>
            <TableCell sx={{ display: 'none' }}>{/* Started col placeholder if needed */}</TableCell>
            <TableCell align="right">
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                   {(job.status === 'InProgress' || job.status === 'Queued') && (
                        <Tooltip title="Cancel">
                            <IconButton size="small" onClick={handleCancel} color="error">
                                <StopIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                   )}
                   {(typeof job.status === 'object' && 'Failed' in job.status || job.status === 'Cancelled') && (
                        <Tooltip title="Retry">
                            <IconButton size="small" onClick={handleRetry} color="primary">
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                   )}
                </Box>
            </TableCell>
        </TableRow>
    );
}

function GroupRow({ group }: { group: any }) {
    const [open, setOpen] = useState(false);
    const items = group.items as TransferJob[];
    
    // Aggregated stats
    const totalBytes = items.reduce((sum, j) => sum + j.total_bytes, 0);
    const processedBytes = items.reduce((sum, j) => sum + j.processed_bytes, 0);
    const progress = totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 0;
    
    const activeCount = items.filter(j => j.status === 'InProgress' || j.status === 'Queued').length;
    const failedCount = items.filter(j => typeof j.status === 'object' && 'Failed' in j.status).length;
    
    let statusLabel = 'Completed';
    let statusColor = 'success';
    
    if (activeCount > 0) {
        statusLabel = `Downloading (${activeCount})`;
        statusColor = 'info';
    } else if (failedCount > 0) {
        statusLabel = `Failed (${failedCount})`;
        statusColor = 'error';
    }
    
    return (
        <>
            <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
                <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <IconButton
                            aria-label="expand row"
                            size="small"
                            onClick={() => setOpen(!open)}
                            sx={{ mr: 1 }}
                        >
                            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                        </IconButton>
                        <FolderOpenIcon color="action" sx={{ mr: 1 }} />
                        <Box>
                             <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {group.name ? group.name.replace('s3://', '') : 'Group'}
                             </Typography>
                             <Typography variant="caption" color="text.secondary">
                                {items.length} files
                             </Typography>
                        </Box>
                    </Box>
                </TableCell>
                <TableCell>{formatBytes(totalBytes)}</TableCell>
                <TableCell>
                     <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <LinearProgress variant="determinate" value={progress} color={statusColor as any} sx={{ height: 4, borderRadius: 1 }} />
                        <Typography variant="caption" color="text.secondary">{Math.round(progress)}%</Typography>
                    </Box>
                </TableCell>
                <TableCell>
                    <Chip 
                        label={statusLabel} 
                        size="small" 
                        color={statusColor as any} 
                        variant="outlined" 
                        sx={{ borderRadius: 1, height: 24 }}
                    />
                </TableCell>
                <TableCell sx={{ display: 'none' }}></TableCell>
                <TableCell align="right">
                    {/* Bulk actions could go here */}
                </TableCell>
            </TableRow>
            <TableRow>
                <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ margin: 1 }}>
                            <Table size="small" aria-label="files">
                                <TableBody>
                                    {items.map((job) => (
                                        <SingleRow key={job.id} job={job} isNested />
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );  
}
