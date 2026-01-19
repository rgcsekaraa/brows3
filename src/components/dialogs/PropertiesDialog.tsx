import {
  Button,
  Tabs,
  Tab,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  CircularProgress,
  Chip,
  alpha,
  useTheme,
} from '@mui/material';
import { useState, useEffect } from 'react';
import { operationsApi, ObjectMetadata } from '@/lib/tauri';
import { BaseDialog } from '../common/BaseDialog';
import { formatSize } from '@/lib/utils';

interface PropertiesDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion?: string;
  objectKey: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index } = props;

  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

export default function PropertiesDialog({ open, onClose, bucketName, bucketRegion, objectKey }: PropertiesDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (open && bucketName && objectKey) {
      fetchMetadata();
    } else {
        setMetadata(null);
        setError(null);
        setTabValue(0);
    }
  }, [open, bucketName, bucketRegion, objectKey]);

  const fetchMetadata = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await operationsApi.getObjectMetadata(bucketName, bucketRegion, objectKey);
      setMetadata(data);
    } catch (err) {
      const errorMsg = String(err);
      if (errorMsg.includes('Access Denied') || errorMsg.includes('403')) {
          setError('Access Denied: You do not have permission to view metadata.');
      } else {
          setError(`Failed to load properties: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title={`Properties: ${objectKey.split('/').pop()}`}
      maxWidth="sm"
      actions={
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      }
    >
      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 2 }}>
           <CircularProgress size={32} />
           <Typography variant="body2" color="text.secondary">Loading metadata...</Typography>
        </Box>
      ) : error ? (
        <Box sx={{ p: 2 }}>
           <Typography color="error" variant="body1" align="center" sx={{ fontWeight: 600 }}>{error}</Typography>
        </Box>
      ) : metadata ? (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ borderBottom: 1, borderColor: alpha(theme.palette.divider, 0.5) }}>
              <Tabs 
                value={tabValue} 
                onChange={handleChange} 
                sx={{
                  '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minWidth: 100 },
                  '& .Mui-selected': { color: theme.palette.primary.main }
                }}
              >
                  <Tab label="General" />
                  <Tab label="Metadata" />
              </Tabs>
            </Box>
            
            <CustomTabPanel value={tabValue} index={0}>
                <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                    <Table size="small">
                        <TableBody>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary', width: '35%' }}>Key</TableCell>
                                <TableCell sx={{ wordBreak: 'break-all', fontWeight: 600 }}>{metadata.key}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>Size</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{formatSize(metadata.size)}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>Content Type</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{metadata.content_type || '-'}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>Modified</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{metadata.last_modified}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>ETag (MD5)</TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.8rem' }}>{metadata.e_tag || '-'}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>Storage Class</TableCell>
                                <TableCell>
                                    <Chip 
                                      label={metadata.storage_class || 'STANDARD'} 
                                      size="small" 
                                      sx={{ 
                                        fontWeight: 600, 
                                        fontSize: '0.65rem',
                                        bgcolor: alpha(theme.palette.success.main, 0.1),
                                        color: theme.palette.success.main,
                                        border: '1px solid',
                                        borderColor: alpha(theme.palette.success.main, 0.2)
                                      }} 
                                    />
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </CustomTabPanel>
            
            <CustomTabPanel value={tabValue} index={1}>
                {Object.keys(metadata.user_metadata).length === 0 ? (
                    <Box sx={{ py: 4, textAlign: 'center', opacity: 0.6 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>No user metadata found.</Typography>
                    </Box>
                ) : (
                     <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                        <Table size="small">
                            <TableBody>
                                {Object.entries(metadata.user_metadata).map(([key, value]) => (
                                     <TableRow key={key} sx={{ '&:last-child td': { border: 0 } }}>
                                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', width: '40%' }}>{key}</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>{value}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                     </TableContainer>
                )}
            </CustomTabPanel>
        </Box>
      ) : null}
    </BaseDialog>
  );
}
