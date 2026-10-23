'use client';

import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { BaseDialog } from '@/components/common/BaseDialog';
import type { UploadPlan } from '@/lib/tauri';
import { formatSize } from '@/lib/utils';

export type UploadConflictChoice = 'overwrite' | 'skip';

interface UploadConflictDialogProps {
  existing: UploadPlan['existing'];
  totalFiles: number;
  onResolve: (choice: UploadConflictChoice | null) => void;
}

const PREVIEW_LIMIT = 8;

export default function UploadConflictDialog({ existing, totalFiles, onResolve }: UploadConflictDialogProps) {
  const remaining = totalFiles - existing.length;
  return (
    <BaseDialog
      open
      onClose={() => onResolve(null)}
      title={existing.length === 1 ? 'File already exists' : `${existing.length} files already exist`}
      actions={
        <>
          <Button onClick={() => onResolve(null)}>Cancel</Button>
          <Button onClick={() => onResolve('skip')}>
            {remaining > 0 ? `Skip existing (upload ${remaining})` : 'Skip existing'}
          </Button>
          <Button variant="contained" color="warning" onClick={() => onResolve('overwrite')}>
            Overwrite
          </Button>
        </>
      }
    >
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        These objects are already in this folder. Overwrite replaces them only if they have not changed since this check.
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 240, overflow: 'auto' }}>
        {existing.slice(0, PREVIEW_LIMIT).map(item => (
          <Typography component="li" variant="body2" key={item.key} sx={{ wordBreak: 'break-all' }}>
            {item.key} <Box component="span" sx={{ color: 'text.secondary' }}>({formatSize(item.size)})</Box>
          </Typography>
        ))}
      </Box>
      {existing.length > PREVIEW_LIMIT && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          and {existing.length - PREVIEW_LIMIT} more
        </Typography>
      )}
    </BaseDialog>
  );
}
