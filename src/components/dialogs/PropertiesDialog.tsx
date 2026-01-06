import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
} from '@mui/material';
import { useState, useEffect } from 'react';
import { operationsApi, ObjectMetadata } from '@/lib/tauri';

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
  id?: string;
  'aria-labelledby'?: string;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 2 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function PropertiesDialog({ open, onClose, bucketName, bucketRegion, objectKey }: PropertiesDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && bucketName && objectKey) {
      fetchMetadata();
    } else {
        // Reset state on close
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
          setError('Access Denied: You do not have permission to view metadata for this object.');
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

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Properties: {objectKey.split('/').pop()}</DialogTitle>
      
      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </DialogContent>
      ) : error ? (
        <DialogContent>
           <Typography color="error">{error}</Typography>
        </DialogContent>
      ) : metadata ? (
        <>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tabValue} onChange={handleChange} aria-label="properties tabs">
                <Tab label="General" />
                <Tab label="Metadata" />
            </Tabs>
            </Box>
            
            <DialogContent sx={{ p: 0 }}>
                <CustomTabPanel value={tabValue} index={0}>
                    <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableBody>
                                <TableRow>
                                    <TableCell variant="head" width="30%">Key</TableCell>
                                    <TableCell sx={{ wordBreak: 'break-all' }}>{metadata.key}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell variant="head">Size</TableCell>
                                    <TableCell>{formatSize(metadata.size)}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell variant="head">Type</TableCell>
                                    <TableCell>{metadata.content_type || '-'}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell variant="head">Last Modified</TableCell>
                                    <TableCell>{metadata.last_modified}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell variant="head">ETag</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>{metadata.e_tag || '-'}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell variant="head">Storage Class</TableCell>
                                    <TableCell>
                                        <Chip label={metadata.storage_class || 'STANDARD'} size="small" variant="outlined" />
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                </CustomTabPanel>
                
                <CustomTabPanel value={tabValue} index={1}>
                    {Object.keys(metadata.user_metadata).length === 0 ? (
                        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                            No user metadata found.
                        </Typography>
                    ) : (
                         <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableBody>
                                    {Object.entries(metadata.user_metadata).map(([key, value]) => (
                                         <TableRow key={key}>
                                            <TableCell variant="head" width="40%">{key}</TableCell>
                                            <TableCell>{value}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                         </TableContainer>
                    )}
                </CustomTabPanel>
            </DialogContent>
        </>
      ) : null}

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
