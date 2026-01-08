'use client';

import { useMemo } from 'react';
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

  const clearCompleted = () => {
    setJobs(jobs.filter(j => 
      j.transfer_type !== 'Download' || 
      (j.status !== 'Completed' && !(typeof j.status === 'object' && 'Failed' in j.status))
    ));
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
            sx={{ height: 8, borderRadius: 4 }}
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
              {downloads.map((job) => {
                const statusInfo = getStatusInfo(job.status);
                const progress = job.total_bytes > 0 ? (job.processed_bytes / job.total_bytes) * 100 : 0;
                const filename = job.key.split('/').pop() || job.key;
                const isError = typeof job.status === 'object' && 'Failed' in job.status;
                const errorMessage = isError ? (job.status as { Failed: string }).Failed : '';
                
                return (
                  <TableRow key={job.id} hover>
                    <TableCell>
                      <Tooltip title={isError ? errorMessage : statusInfo.label}>
                        <Chip 
                          icon={statusInfo.icon as any}
                          label={statusInfo.label}
                          size="small"
                          color={statusInfo.color}
                          variant={job.status === 'Completed' ? 'filled' : 'outlined'}
                          sx={{ height: 24 }}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2" fontWeight={500} noWrap title={filename}>
                          {filename}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap title={job.key}>
                          {job.bucket}/{job.key}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {formatBytes(job.total_bytes)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {job.status === 'InProgress' || job.status === 'Queued' ? (
                        <Box>
                          <LinearProgress 
                            variant="determinate" 
                            value={progress}
                            sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(job.processed_bytes)} ({Math.round(progress)}%)
                          </Typography>
                        </Box>
                      ) : job.status === 'Completed' ? (
                        <Typography variant="body2" color="success.main">
                          ✓ Complete
                        </Typography>
                      ) : isError ? (
                        <Tooltip title={errorMessage}>
                          <Typography variant="body2" color="error.main" noWrap sx={{ maxWidth: 120 }}>
                            {errorMessage.slice(0, 30)}...
                          </Typography>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatTimeAgo(job.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Open folder">
                        <IconButton size="small" disabled>
                          <FolderOpenIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Stats Footer */}
      {downloads.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', gap: 3 }}>
          <Typography variant="caption" color="text.secondary">
            <strong>{stats.completedCount}</strong> completed
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <strong>{stats.activeCount}</strong> in progress
          </Typography>
          {stats.failedCount > 0 && (
            <Typography variant="caption" color="error">
              <strong>{stats.failedCount}</strong> failed
            </Typography>
          )}
        </Box>
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
