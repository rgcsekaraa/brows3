import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  InputAdornment,
} from '@mui/material';
import { DriveFileRenameOutline as RenameIcon } from '@mui/icons-material';

interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
  currentName: string;
}

export default function RenameDialog({ open, onClose, onRename, currentName }: RenameDialogProps) {
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <RenameIcon color="primary" />
        Rename Object
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enter a new name for <strong>{currentName}</strong>. 
                Warning: This effectively copies the object to a new key and deletes the old one.
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
      </DialogContent>
      
      <DialogActions sx={{ p: 2 }}>
         <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
         <Button 
            onClick={handleSubmit} 
            variant="contained" 
            disabled={!value.trim() || value === currentName || isSubmitting}
         >
            {isSubmitting ? 'Renaming...' : 'Rename'}
         </Button>
      </DialogActions>
    </Dialog>
  );
}
