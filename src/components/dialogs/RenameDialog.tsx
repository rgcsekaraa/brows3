import { useEffect, useState } from 'react';
import {
  Button,
  TextField,
  Box,
  Typography,
  InputAdornment,
  Alert,
} from '@mui/material';
import { DriveFileRenameOutline as RenameIcon } from '@mui/icons-material';
import { BaseDialog } from '../common/BaseDialog';

interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
  currentName: string;
  isFolder?: boolean;
}

export default function RenameDialog({ open, onClose, onRename, currentName, isFolder = false }: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, currentName]);

  const handleSubmit = async () => {
    if (!value.trim() || value === currentName) return;
    
    setIsSubmitting(true);
    setError(null);
    try {
      await onRename(value);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to rename');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title="Rename Object"
      maxWidth="sm"
      actions={
        <>
          <Button 
            onClick={onClose} 
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained" 
            disabled={!value.trim() || value === currentName || isSubmitting}
          >
            {isSubmitting ? 'Renaming...' : 'Rename'}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            Enter a new name for <strong>{currentName}</strong>. 
            <Box component="span" sx={{ display: 'block', mt: 0.5, fontSize: '0.8rem', opacity: 0.8 }}>
              Note: This copies the object to a new key and deletes the old one.
            </Box>
            {isFolder && (
              <Alert severity="warning" sx={{ mt: 1.5, py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
                Warning: Renaming a folder moves all contained objects. For large folders, this may take a significant amount of time.
              </Alert>
            )}
        </Typography>
        
        <TextField
            autoFocus
            fullWidth
            label="New Name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            error={!!error}
            helperText={error}
            disabled={isSubmitting}
            InputProps={{
                startAdornment: (
                    <InputAdornment position="start">
                        <RenameIcon fontSize="small" color="action" />
                    </InputAdornment>
                )
            }}
        />
      </Box>
    </BaseDialog>
  );
}
