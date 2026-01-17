'use client';

import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  LinearProgress,
  Badge,
  Paper,
  Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  SwapVert as SwapIcon,
} from '@mui/icons-material';
import { useTransferStore } from '@/store/transferStore';
import { TransferJob } from '@/lib/tauri';

const PREVIEW_COUNT = 3;

interface TransferPanelProps {
  filterType?: 'Upload' | 'Download';
}

export function TransferPanel({ filterType }: TransferPanelProps) {
  const { jobs, isPanelOpen, togglePanel } = useTransferStore();
  
  const filteredJobs = filterType 
    ? jobs.filter(j => j.transfer_type === filterType)
    : jobs;
  
  const activeJobs = filteredJobs.filter(j => j.status === 'Pending' || j.status === 'InProgress');
  const finishedJobs = filteredJobs.filter(j => j.status === 'Completed' || typeof j.status === 'object');
  
  const getStatusIcon = (status: TransferJob['status']) => {
    if (status === 'Completed') return <CheckCircleIcon color="success" fontSize="small" />;
    if (typeof status === 'object' && 'Failed' in status) return <ErrorIcon color="error" fontSize="small" />;
    return <SwapIcon color="primary" fontSize="small" className="spin-animation" />;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (jobs.length === 0) return null;

  return (
    <Box 
      sx={{ 
        position: 'fixed', 
        bottom: 32, 
        right: 20, 
        width: 360, 
        zIndex: 1200,
        boxShadow: 24,
      }}
    >
        {/* Header Bar */}
        <Paper 
          sx={{ 
            p: 1.5, 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            bgcolor: 'background.paper',
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            cursor: 'pointer',
            borderBottom: isPanelOpen ? '1px solid rgba(255, 255, 255, 0.12)' : 'none',
          }}
          elevation={3}
          onClick={togglePanel}
        >
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
             <Badge badgeContent={activeJobs.length} color="primary">
               <SwapIcon fontSize="small" />
             </Badge>
             <Typography variant="subtitle2" sx={{ ml: 1 }}>
               Transfers {isPanelOpen ? '' : activeJobs.length > 0 ? ' - In Progress' : ' - Completed'}
             </Typography>
           </Box>
           {isPanelOpen ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </Paper>

        {/* List Content */}
        {isPanelOpen && (
           <Paper 
             sx={{ 
               maxHeight: 400, 
               overflow: 'auto', 
               borderTopLeftRadius: 0, 
               borderTopRightRadius: 0,
               bgcolor: 'background.paper', 
             }}
             elevation={3}
           >
             <List dense>
               {filteredJobs.map((job) => {
                 const isError = typeof job.status === 'object' && 'Failed' in job.status;
                 const errorMessage = isError ? (job.status as { Failed: string }).Failed : '';
                 const progress = job.total_bytes > 0 ? (job.processed_bytes / job.total_bytes) * 100 : 0;
                 
                 return (
                   <div key={job.id}>
                     <ListItem sx={{ py: 1 }}>
                        <Box sx={{ width: '100%' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                              {getStatusIcon(job.status)}
                              <Typography variant="body2" noWrap sx={{ maxWidth: 180 }} title={job.key}>
                                {job.transfer_type === 'Upload' ? '↑' : '↓'} {job.key.split('/').pop()}
                              </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                              {Math.round(progress)}%
                            </Typography>
                          </Box>
                          
                          <LinearProgress 
                            variant="determinate" 
                            value={progress} 
                            color={isError ? 'error' : job.status === 'Completed' ? 'success' : 'primary'}
                            sx={{ height: 4, borderRadius: 2 }}
                          />
                          
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                             <Typography variant="caption" color="text.secondary">
                               {formatBytes(job.processed_bytes)} / {formatBytes(job.total_bytes)}
                             </Typography>
                             {isError && (
                               <Typography variant="caption" color="error" title={errorMessage}>
                                 Failed
                               </Typography>
                             )}
                          </Box>
                        </Box>
                     </ListItem>
                     <Divider component="li" />
                   </div>
                 );
               })}
             </List>
           </Paper>
        )}
        
         <style jsx global>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin-animation { animation: spin 1s linear infinite; }
          `}</style>
    </Box>
  );
}
