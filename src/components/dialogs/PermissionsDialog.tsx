import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BaseDialog } from '../common/BaseDialog';
import { ObjectCannedAcl, ObjectPermissions, operationsApi } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

interface PermissionsDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion?: string;
  objectKey: string;
  isFolder: boolean;
}

const ACL_OPTIONS: { value: ObjectCannedAcl; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'public-read', label: 'Public read' },
  { value: 'public-read-write', label: 'Public read and write' },
  { value: 'authenticated-read', label: 'Authenticated read' },
  { value: 'bucket-owner-read', label: 'Bucket owner read' },
  { value: 'bucket-owner-full-control', label: 'Bucket owner full control' },
  { value: 'aws-exec-read', label: 'AWS exec read' },
];

export default function PermissionsDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
  isFolder,
}: PermissionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<ObjectPermissions | null>(null);
  const [selectedAcl, setSelectedAcl] = useState<ObjectCannedAcl>('private');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const canEditAcl = permissions?.status === 'available';

  const fetchPermissions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await operationsApi.getObjectPermissions(bucketName, bucketRegion, objectKey, isFolder);
      if (requestId === requestIdRef.current) {
        setPermissions(data);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [bucketName, bucketRegion, objectKey, isFolder]);

  useEffect(() => {
    if (open && bucketName && objectKey) {
      fetchPermissions();
    } else {
      setPermissions(null);
      setError(null);
      setSelectedAcl('private');
    }
  }, [open, bucketName, objectKey, fetchPermissions]);

  const handleSave = async () => {
    if (!bucketName || !objectKey) return;
    setSaving(true);
    setError(null);
    try {
      const result = await operationsApi.setObjectPermissions(bucketName, bucketRegion, objectKey, isFolder, selectedAcl);
      toast.success(`Updated permissions for ${result.affected_count} object${result.affected_count === 1 ? '' : 's'}.`);
      await fetchPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={`Permissions: ${objectKey.split('/').filter(Boolean).pop() || objectKey}`}
      maxWidth="md"
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>Close</Button>
          <Button onClick={handleSave} variant="contained" disabled={loading || saving || !!error || !canEditAcl}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 2 }}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">Loading permissions...</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {permissions && (
            <>
              {permissions.status !== 'available' && (
                <Alert severity={permissions.status === 'unsupported' ? 'warning' : 'error'}>
                  {permissions.message || 'ACL permissions are not available for this object.'}
                </Alert>
              )}

              {isFolder && (
                <Alert severity="info">
                  Saving applies the selected ACL to {permissions.target_count.toLocaleString()} object{permissions.target_count === 1 ? '' : 's'} under this folder.
                </Alert>
              )}

              <Box>
                <Typography variant="subtitle2" color="text.secondary">Owner</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                  {permissions.owner_display_name || permissions.owner_id || 'Unknown'}
                </Typography>
              </Box>

              <FormControl fullWidth size="small" disabled={!canEditAcl}>
                <InputLabel id="acl-select-label">ACL</InputLabel>
                <Select
                  labelId="acl-select-label"
                  label="ACL"
                  value={selectedAcl}
                  onChange={(event) => setSelectedAcl(event.target.value as ObjectCannedAcl)}
                >
                  {ACL_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {permissions.status === 'available' && (
                <TableContainer component={Paper} elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Grantee</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Permission</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {permissions.grants.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} align="center">No grants found.</TableCell>
                        </TableRow>
                      ) : permissions.grants.map((grant, index) => (
                        <TableRow key={`${grant.permission}-${grant.id || grant.uri || index}`}>
                          <TableCell sx={{ wordBreak: 'break-all' }}>
                            {grant.display_name || grant.email_address || grant.uri || grant.id || 'Unknown'}
                          </TableCell>
                          <TableCell>{grant.grantee_type || '-'}</TableCell>
                          <TableCell>{grant.permission || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </Box>
      )}
    </BaseDialog>
  );
}
