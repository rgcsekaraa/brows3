'use client';

import { useMemo, useState, useEffect } from 'react';
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
  CloudUpload as UploadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Sync as SyncIcon,
  Delete as DeleteIcon,

  FolderOpen as FolderOpenIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Cancel as CancelIcon,
  Replay as ReplayIcon,
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

// Format time ago
const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

// Format duration
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// Get status info
const getStatusInfo = (status: TransferJob['status']): { label: string; color: 'success' | 'error' | 'warning' | 'info' | 'default'; icon: React.ReactNode } => {
  if (status === 'Completed') {
    return { label: 'Completed', color: 'success', icon: <CheckCircleIcon fontSize="small" /> };
  }
  if (status === 'InProgress') {
    return { label: 'Uploading', color: 'info', icon: <SyncIcon fontSize="small" className="spin" /> };
  }
  if (status === 'Pending') {
    return { label: 'Pending', color: 'default', icon: <ScheduleIcon fontSize="small" /> };
  }
  if (typeof status === 'object' && 'Failed' in status) {
    return { label: 'Failed', color: 'error', icon: <ErrorIcon fontSize="small" /> };
  }
  if (status === 'Cancelled') {
    return { label: 'Cancelled', color: 'default', icon: <CancelIcon fontSize="small" /> };
  }
  return { label: String(status), color: 'default', icon: null };
};

export default function UploadsPage() {
  const { jobs, refreshJobs, clearCompleted: clearCompletedStore } = useTransferStore();
  
  // Refresh jobs on mount to sync with backend
  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);
  
  // Filter only uploads
  const uploads = useMemo(() => 
    jobs.filter(j => j.transfer_type === 'Upload')
      .sort((a, b) => b.created_at - a.created_at),
  [jobs]);
  
  // Grouping logic
  const groupedUploads = useMemo(() => {
    const groups: Record<string, TransferJob[]> = {};
    const standalone: TransferJob[] = [];
    
    uploads.forEach(job => {
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
      const latest = Math.max(...items.map(i => i.created_at));
      const name = items[0].group_name || 'Unknown Group';
      
      return {
        id: groupId,
        isGroup: true,
        items,
        latest,
        name
      };
    });
    
    return [
        ...standalone.map(j => ({ id: j.id, isGroup: false, item: j, latest: j.created_at })),
        ...groupList
    ].sort((a, b) => b.latest - a.latest);
  }, [uploads]);
  
  // Stats
  const stats = useMemo(() => {
    const active = uploads.filter(u => u.status === 'InProgress' || u.status === 'Pending');
    const completed = uploads.filter(u => u.status === 'Completed');
    const failed = uploads.filter(u => typeof u.status === 'object' && 'Failed' in u.status);
    
    const totalBytes = active.reduce((sum, u) => sum + u.total_bytes, 0);
    const processedBytes = active.reduce((sum, u) => sum + u.processed_bytes, 0);
    
    return {
      activeCount: active.length,
      completedCount: completed.length,
      failedCount: failed.length,
      totalBytes,
      processedBytes,
      progress: totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 0,
    };
  }, [uploads]);

  const clearCompleted = () => {
    clearCompletedStore();
  };

  return (
    <Box sx={{ p: 1, mt: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <UploadIcon color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Uploads
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {stats.activeCount > 0 
                ? `${stats.activeCount} active • ${formatBytes(stats.processedBytes)} / ${formatBytes(stats.totalBytes)}`
                : `${uploads.length} total uploads`}
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



      {/* Uploads Table */}
      {uploads.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <UploadIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No uploads yet
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Upload files to your S3 buckets and they will appear here
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
          <Table stickyHeader size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 150 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 180 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 140 }}>Started</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 140 }}>Finished</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }}>Elapsed</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, width: 100 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(() => {
                  const folders = groupedUploads.filter((row: any) => row.isGroup);
                  const files = groupedUploads.filter((row: any) => !row.isGroup);

                  return (
                    <>
                      {folders.length > 0 && (
                        <>
                          <TableRow>
                            <TableCell colSpan={8} sx={{ bgcolor: 'action.hover', fontWeight: 600, py: 1 }}>
                              Folders ({folders.length})
                            </TableCell>
                          </TableRow>
                          {folders.map((row: any) => (
                             <GroupRow key={row.id} group={row} />
                          ))}
                        </>
                      )}

                      {files.length > 0 && (
                        <>
                           <TableRow>
                            <TableCell colSpan={8} sx={{ bgcolor: 'action.hover', fontWeight: 600, py: 1 }}>
                              Files ({files.length})
                            </TableCell>
                          </TableRow>
                          {files.map((row: any) => (
                             <SingleRow key={row.id} job={row.item} />
                          ))}
                        </>
                      )}
                    </>
                  );
              })()}
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
    const isCompleted = job.status === 'Completed';
    const progress = isCompleted ? 100 : (job.total_bytes > 0 ? (job.processed_bytes / job.total_bytes) * 100 : 0);
    const displayBytes = job.total_bytes > 0 ? job.total_bytes : (isCompleted ? job.processed_bytes : 0);
    const { cancelJob, retryJob } = useTransferStore();
    
    // Actions
    const handleCancel = () => cancelJob(job.id);
    const handleRetry = () => retryJob(job.id);

    // Date formatting (handling ms)
    const startDate = new Date(job.created_at).toLocaleString();
    const finishedDate = job.finished_at ? new Date(job.finished_at).toLocaleString() : '—';
    const elapsed = job.finished_at ? formatDuration(job.finished_at - job.created_at) : (
        job.status === 'InProgress' ? <span className="elapsed-timer">{formatTimeAgo(job.created_at).replace(' ago', '')}</span> : '—'
    );

    return (
        <TableRow sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: isNested ? 'action.hover' : 'inherit' }}>
            <TableCell component="th" scope="row">
                 <Chip 
                    icon={status.icon as any} 
                    label={status.label} 
                    size="small" 
                    color={status.color as any} 
                    variant="outlined" 
                    sx={{ borderRadius: 1, height: 24 }}
                />
            </TableCell>
            <TableCell sx={{ pl: isNested ? 10 : 2 }}>
                <Box sx={{ overflow: 'hidden' }}>
                    <Tooltip title={job.key.split('/').pop() || ''}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{job.key.split('/').pop()}</Typography>
                    </Tooltip>
                    {!isNested && <Typography variant="caption" color="text.secondary" noWrap display="block">{job.bucket}</Typography>}
                </Box>
            </TableCell>
            <TableCell>{formatBytes(displayBytes)}</TableCell>
            <TableCell>
                 <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: '100%', mr: 1 }}>
                        <LinearProgress variant="determinate" value={progress} color={status.color as any} sx={{ height: 4, borderRadius: 1 }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{Math.round(progress)}%</Typography>
                </Box>
            </TableCell>
            <TableCell>
                <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.2 }}>
                   {new Date(job.created_at).toLocaleDateString()}
                   <br/>
                   <Box component="span" color="text.secondary">{new Date(job.created_at).toLocaleTimeString()}</Box>
                </Typography>
            </TableCell>
            <TableCell>
                <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.2 }}>
                   {job.finished_at ? (
                       <>
                           {new Date(job.finished_at).toLocaleDateString()}
                           <br/>
                           <Box component="span" color="text.secondary">{new Date(job.finished_at).toLocaleTimeString()}</Box>
                       </>
                   ) : '—'}
                </Typography>
            </TableCell>
             <TableCell>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                   {job.finished_at ? formatDuration(job.finished_at - job.created_at) : '—'}
                </Typography>
             </TableCell>
             
            {/* 8. Actions */}
            <TableCell align="right">
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    {/* Retry Button */}
                    <Tooltip title={((typeof job.status === 'object' && 'Failed' in job.status) || job.status === 'Cancelled') ? "Retry" : ""}>
                        <span>
                            <IconButton 
                                onClick={handleRetry} 
                                size="small" 
                                color="primary"
                                disabled={!((typeof job.status === 'object' && 'Failed' in job.status) || job.status === 'Cancelled')}
                            >
                                <ReplayIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    {/* Cancel Button */}
                    <Tooltip title={(job.status === 'Pending' || job.status === 'InProgress') ? "Cancel" : ""}>
                        <span>
                            <IconButton 
                                onClick={handleCancel} 
                                size="small" 
                                color="error"
                                disabled={!(job.status === 'Pending' || job.status === 'InProgress')}
                            >
                                <CancelIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </TableCell>
        </TableRow>
    );
}

function GroupRow({ group }: { group: any }) {
    const [open, setOpen] = useState(false);
    const items = group.items as TransferJob[];
    
    
    const totalBytes = items.reduce((sum, j) => {
        const bytes = j.total_bytes > 0 ? j.total_bytes : (j.status === 'Completed' ? j.processed_bytes : 0);
        return sum + bytes;
    }, 0);
    const processedBytes = items.reduce((sum, j) => sum + j.processed_bytes, 0);
    const isAllCompleted = items.every(j => j.status === 'Completed');
    const progress = isAllCompleted ? 100 : (totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 0);

    const activeCount = items.filter(j => j.status === 'InProgress' || j.status === 'Pending').length;
    const failedCount = items.filter(j => typeof j.status === 'object' && 'Failed' in j.status).length;

    // Date calculations
    const startTimes = items.map(j => j.created_at).filter(t => t > 0);
    const startTime = startTimes.length > 0 ? Math.min(...startTimes) : 0;
    
    const endTimes = items.map(j => j.finished_at || 0);
    const endTime = isAllCompleted ? Math.max(...endTimes) : 0;
    
    const startDateStr = startTime > 0 ? new Date(startTime).toLocaleString() : '—';
    const finishedDateStr = endTime > 0 ? new Date(endTime).toLocaleString() : '—';
    const elapsedStr = endTime > 0 ? formatDuration(endTime - startTime) : (activeCount > 0 ? 'In Progress' : '—');
    
    let statusLabel = 'Completed';
    let statusColor = 'success';
    
    if (activeCount > 0) {
        statusLabel = `Uploading (${activeCount})`;
        statusColor = 'info';
    } else if (failedCount > 0) {
        statusLabel = `Failed (${failedCount})`;
        statusColor = 'error';
    }
    
    return (
        <>
            <TableRow sx={{ '& > *': { borderBottom: 'unset' } }} hover onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
                {/* 1. Status */}
                <TableCell>
                    <Chip 
                        label={statusLabel} 
                        size="small" 
                        color={statusColor as any} 
                        variant="outlined" 
                        sx={{ borderRadius: 1, height: 24 }}
                    />
                </TableCell>

                {/* 2. File */}
                <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                         <IconButton
                            aria-label="expand row"
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpen(!open);
                            }}
                            sx={{ mr: 1, p: 0.5 }}
                        >
                            {open ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                        </IconButton>
                        <FolderOpenIcon color="action" sx={{ mr: 1, fontSize: 20 }} />
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

                {/* 3. Size */}
                <TableCell>{formatBytes(totalBytes)}</TableCell>

                {/* 4. Progress */}
                <TableCell>
                     <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 80 }}>
                            <LinearProgress variant="determinate" value={progress} color={statusColor as any} sx={{ height: 6, borderRadius: 1 }} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 35 }}>{Math.round(progress)}%</Typography>
                    </Box>
                </TableCell>
                
                {/* 5. Started */}
                <TableCell>{startDateStr}</TableCell>
                {/* 6. Finished */}
                <TableCell>{finishedDateStr}</TableCell>
                {/* 7. Elapsed */}
                <TableCell>{elapsedStr}</TableCell>
                {/* 8. Actions */}
                <TableCell></TableCell>
            </TableRow>
            
            {/* Flattened Children - No nested table! */}
            {open && items.map((job) => (
                <SingleRow key={job.id} job={job} isNested />
            ))}
        </>
    );  
}
