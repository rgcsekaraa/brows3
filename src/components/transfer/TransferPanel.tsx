'use client';

import {
  Box,
  IconButton,
  List,
  ListItem,
  Typography,
  LinearProgress,
  Paper,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Cancel as CancelIcon,
  SwapVert as SwapIcon,
} from '@mui/icons-material';
import { useTransferStore } from '@/store/transferStore';
import { TransferJob } from '@/lib/tauri';
import { formatTransferSpeed, totalTransferSpeed, transferSpeed } from '@/lib/transferSpeed';

import { TransferActivityIcon } from './TransferActivityIcon';

interface TransferPanelProps {
  filterType?: 'Upload' | 'Download';
}

export function TransferPanel({ filterType }: TransferPanelProps) {
  const { jobs, isPanelOpen, isPanelHidden, togglePanel, hidePanel, clearCompleted } = useTransferStore();
  
  const filteredJobs = filterType 
    ? jobs.filter(j => j.transfer_type === filterType)
    : jobs;
  
  const activeJobs = filteredJobs.filter(j => j.status === 'Pending' || j.status === 'InProgress');
  const finishedJobs = filteredJobs.filter(j =>
    j.status === 'Completed' ||
    j.status === 'Cancelled' ||
    (typeof j.status === 'object' && 'Failed' in j.status)
  );
  
  const getStatusIcon = (job: TransferJob) => {
    const status = job.status;
    if (status === 'Completed') return <CheckCircleIcon color="success" fontSize="small" />;
    if (status === 'Cancelled') return <CancelIcon color="disabled" fontSize="small" />;
    if (typeof status === 'object' && 'Failed' in status) return <ErrorIcon color="error" fontSize="small" />;
    return <TransferActivityIcon type={job.transfer_type} active={status === 'InProgress'} />;
  };

  // Don't show if no jobs or user closed it
  if (filteredJobs.length === 0 || isPanelHidden) return null;

  return (
    <Box 
      sx={{ 
        position: 'fixed', 
        bottom: 32,
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
             <SwapIcon fontSize="small" color={activeJobs.length > 0 ? 'primary' : 'disabled'} />
             <Typography variant="body2" sx={{ fontWeight: 600 }}>
               Transfers
             </Typography>
             <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
               {activeJobs.length > 0 
                 ? `${activeJobs.length} active` 
                 : finishedJobs.length > 0 
                   ? `${finishedJobs.length} finished`
                   : ''
               }
             </Typography>
           </Box>
           
           <Box sx={{ display: 'flex', alignItems: 'center' }}>
             <IconButton size="small" aria-label={isPanelOpen ? 'Collapse transfers' : 'Expand transfers'} onClick={togglePanel}>
               {isPanelOpen ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
             </IconButton>
             <IconButton size="small" aria-label="Hide transfers" onClick={hidePanel}>
               <CloseIcon fontSize="small" />
             </IconButton>
           </Box>
        </Paper>

        {activeJobs.length > 0 && (
          <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'background.paper', display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {(['Upload', 'Download'] as const).filter(type => activeJobs.some(job => job.transfer_type === type)).map(type => (
              <Typography key={type} variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TransferActivityIcon type={type} active={activeJobs.some(job => job.transfer_type === type && job.status === 'InProgress')} />
                {type}: {formatTransferSpeed(totalTransferSpeed(activeJobs, type))}
              </Typography>
            ))}
          </Box>
        )}

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
                 [...activeJobs, ...filteredJobs.filter(job => !activeJobs.includes(job))].slice(0, 8).map((job) => {
                   const isError = typeof job.status === 'object' && 'Failed' in job.status;
                   const errorMessage = isError && typeof job.status === 'object' ? job.status.Failed : '';
                   const progress =
                     job.status === 'Completed'
                       ? 100
                       : job.total_bytes > 0
                         ? (job.processed_bytes / job.total_bytes) * 100
                         : 0;

                   return (
                     <div key={job.id}>
                       <ListItem sx={{ py: 0.5, px: 1.5 }}>
                          <Box sx={{ width: '100%' }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                              <Tooltip title={isError ? errorMessage : job.key}>
                                <Typography variant="caption" noWrap sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  {getStatusIcon(job)}
                                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.key.split('/').pop()}</Box>
                                </Typography>
                              </Tooltip>
                              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1, fontVariantNumeric: 'tabular-nums' }}>
                                {job.status === 'InProgress' ? `${formatTransferSpeed(transferSpeed(job))} · ` : ''}{Math.round(progress)}%
                              </Typography>
                            </Box>
                            <LinearProgress
                              variant="determinate"
                              value={progress}
                              color={isError ? 'error' : job.status === 'Completed' ? 'success' : 'primary'}
                              sx={{ height: 2, borderRadius: 1 }}
                            />
                            {isError && (
                              <Typography
                                variant="caption"
                                color="error"
                                noWrap
                                sx={{ display: 'block', mt: 0.25 }}
                                title={errorMessage}
                              >
                                {errorMessage}
                              </Typography>
                            )}
                          </Box>
                       </ListItem>
                     </div>
                   );
                 })
               )}
             </List>
             {finishedJobs.length > 0 && (
               <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                 <Typography 
                   variant="caption" 
                   color="primary"
                   sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                   onClick={() => clearCompleted()}
                 >
                   Clear finished
                 </Typography>
               </Box>
             )}
           </Paper>
        )}
        
    </Box>
  );
}
