'use client';

import {
  Box,
  IconButton,
  List,
  ListItem,
  Typography,
  LinearProgress,
  Badge,
  Paper,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  SwapVert as SwapIcon,
  ClearAll as ClearIcon,
} from '@mui/icons-material';
import { useTransferStore } from '@/store/transferStore';
import { TransferJob } from '@/lib/tauri';

interface TransferPanelProps {
  filterType?: 'Upload' | 'Download';
}

export function TransferPanel({ filterType }: TransferPanelProps) {
  const { jobs, isPanelOpen, isPanelHidden, togglePanel, hidePanel, clearCompleted } = useTransferStore();
  
  const filteredJobs = filterType 
    ? jobs.filter(j => j.transfer_type === filterType)
    : jobs;
  
  const activeJobs = filteredJobs.filter(j => j.status === 'Pending' || j.status === 'InProgress');
  const completedJobs = filteredJobs.filter(j => j.status === 'Completed');
  
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

  // Don't show if no jobs or user closed it
  if (jobs.length === 0 || isPanelHidden) return null;

  return (
    <Box 
      sx={{ 
        position: 'fixed', 
        bottom: 24, 
        right: 24, 
        width: 320, 
        zIndex: 1200,
        boxShadow: 8,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
        {/* Header Bar */}
        <Paper 
          sx={{ 
            px: 1.5,
            py: 1, 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            bgcolor: 'background.paper',
            borderBottom: isPanelOpen ? '1px solid' : 'none',
            borderColor: 'divider',
          }}
          elevation={0}
        >
           <Box 
             sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: 1 }}
             onClick={togglePanel}
           >
             <Badge badgeContent={activeJobs.length} color="primary" max={99}>
               <SwapIcon fontSize="small" color={activeJobs.length > 0 ? 'primary' : 'disabled'} />
             </Badge>
             <Typography variant="body2" sx={{ fontWeight: 600 }}>
               Transfers
             </Typography>
             <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
               {activeJobs.length > 0 
                 ? `${activeJobs.length} active` 
                 : completedJobs.length > 0 
                   ? `${completedJobs.length} done`
                   : ''
               }
             </Typography>
           </Box>
           
           <Box sx={{ display: 'flex', alignItems: 'center' }}>
             <IconButton size="small" onClick={togglePanel}>
               {isPanelOpen ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
             </IconButton>
             <IconButton size="small" onClick={hidePanel}>
               <CloseIcon fontSize="small" />
             </IconButton>
           </Box>
        </Paper>

        {/* Expanded List */}
        {isPanelOpen && (
           <Paper 
             sx={{ 
               maxHeight: 200, 
               overflow: 'auto', 
               bgcolor: 'background.default', 
             }}
             elevation={0}
           >
             <List dense sx={{ py: 0 }}>
               {filteredJobs.length === 0 ? (
                 <ListItem>
                   <Typography variant="caption" color="text.secondary">No transfers</Typography>
                 </ListItem>
               ) : (
                 filteredJobs.slice(0, 8).map((job) => {
                   const isError = typeof job.status === 'object' && 'Failed' in job.status;
                   const progress = job.total_bytes > 0 ? (job.processed_bytes / job.total_bytes) * 100 : 0;
                   
                   return (
                     <div key={job.id}>
                       <ListItem sx={{ py: 0.5, px: 1.5 }}>
                          <Box sx={{ width: '100%' }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                              <Typography variant="caption" noWrap sx={{ maxWidth: 200, display: 'flex', alignItems: 'center', gap: 0.5 }} title={job.key}>
                                {getStatusIcon(job.status)}
                                {job.transfer_type === 'Upload' ? '↑' : '↓'} {job.key.split('/').pop()}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {Math.round(progress)}%
                              </Typography>
                            </Box>
                            <LinearProgress 
                              variant="determinate" 
                              value={progress} 
                              color={isError ? 'error' : job.status === 'Completed' ? 'success' : 'primary'}
                              sx={{ height: 2, borderRadius: 1 }}
                            />
                          </Box>
                       </ListItem>
                     </div>
                   );
                 })
               )}
             </List>
             {completedJobs.length > 0 && (
               <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                 <Typography 
                   variant="caption" 
                   color="primary"
                   sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                   onClick={() => clearCompleted()}
                 >
                   Clear completed
                 </Typography>
               </Box>
             )}
           </Paper>
        )}
        
         <style jsx global>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin-animation { animation: spin 1s linear infinite; }
          `}</style>
    </Box>
  );
}


