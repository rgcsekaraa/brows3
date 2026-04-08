'use client';

import { useState, useEffect } from 'react';
import {
  Button,
  TextField,
  Box,
  Typography,
  InputAdornment,
  Alert,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Stack,
  Chip,
} from '@mui/material';
import {
  Link as LinkIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  AccessTime as TimeIcon,
} from '@mui/icons-material';
import { BaseDialog } from '../common/BaseDialog';
import { objectApi } from '@/lib/tauri';

interface PresignedUrlDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion: string | undefined;
  objectKey: string;
}

// Preset expiry options
const EXPIRY_OPTIONS = [
  { label: '15 minutes', value: 900 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '12 hours', value: 43200 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: 'Custom', value: -1 },
];

export default function PresignedUrlDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
}: PresignedUrlDialogProps) {
  const [selectedExpiry, setSelectedExpiry] = useState(3600);
  const [customExpiry, setCustomExpiry] = useState('');
  const [customUnit, setCustomUnit] = useState<'seconds' | 'minutes' | 'hours' | 'days'>('hours');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Calculate actual expiry time in seconds
  const getExpirySeconds = (): number => {
    if (selectedExpiry !== -1) return selectedExpiry;
    
    const customValue = parseInt(customExpiry, 10) || 0;
    switch (customUnit) {
      case 'seconds': return customValue;
      case 'minutes': return customValue * 60;
      case 'hours': return customValue * 3600;
      case 'days': return customValue * 86400;
      default: return customValue;
    }
  };

  // Format expiry for display
  const formatExpiry = (seconds: number): string => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
    return `${Math.round(seconds / 86400)} days`;
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedExpiry(3600);
      setCustomExpiry('');
      setCustomUnit('hours');
      setGeneratedUrl(null);
      setError(null);
      setCopied(false);
      setIsGenerating(false);
    }
  }, [open]);

  const handleGenerate = async () => {
    const expirySeconds = getExpirySeconds();
    
    if (expirySeconds <= 0) {
      setError('Expiry time must be greater than 0');
      return;
    }
    
    // AWS max is 7 days (604800 seconds) for most credential types
    if (expirySeconds > 604800) {
      setError('Expiry cannot exceed 7 days (604800 seconds) for most AWS credential types');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedUrl(null);

    try {
      const url = await objectApi.getPresignedUrl(bucketName, bucketRegion, objectKey, expirySeconds);
      setGeneratedUrl(url);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setError(`Failed to generate URL: ${errMsg}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const fileName = objectKey.split('/').pop() || objectKey;

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Generate Presigned URL"
      maxWidth="sm"
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {!generatedUrl && (
            <Button
              onClick={handleGenerate}
              variant="contained"
              disabled={isGenerating || (selectedExpiry === -1 && !customExpiry)}
              startIcon={<LinkIcon />}
            >
              {isGenerating ? 'Generating...' : 'Generate URL'}
            </Button>
          )}
        </>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body2" color="text.secondary">
          Generate a temporary URL that allows anyone with the link to access{' '}
          <Box component="span" sx={{ fontWeight: 700, fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>
            {fileName}
          </Box>
        </Typography>

        {!generatedUrl ? (
          <>
            {/* Expiry Selection */}
            <FormControl fullWidth>
              <InputLabel id="expiry-label">URL Expires In</InputLabel>
              <Select
                labelId="expiry-label"
                value={selectedExpiry}
                label="URL Expires In"
                onChange={(e) => setSelectedExpiry(e.target.value as number)}
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Custom Expiry Input */}
            {selectedExpiry === -1 && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Custom Duration"
                  type="number"
                  value={customExpiry}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  sx={{ flex: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <TimeIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  }}
                />
                <FormControl sx={{ flex: 1 }}>
                  <InputLabel>Unit</InputLabel>
                  <Select
                    value={customUnit}
                    label="Unit"
                    onChange={(e) => setCustomUnit(e.target.value as typeof customUnit)}
                  >
                    <MenuItem value="seconds">Seconds</MenuItem>
                    <MenuItem value="minutes">Minutes</MenuItem>
                    <MenuItem value="hours">Hours</MenuItem>
                    <MenuItem value="days">Days</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}

            <Alert severity="info" sx={{ py: 0.5 }}>
              <Typography variant="caption">
                The maximum expiry for presigned URLs is 7 days for most AWS credential types.
                URLs generated with temporary credentials (STS) may have shorter limits.
              </Typography>
            </Alert>
          </>
        ) : (
          <>
            {/* Generated URL Display */}
            <Box sx={{ position: 'relative' }}>
              <TextField
                fullWidth
                multiline
                rows={4}
                value={generatedUrl}
                InputProps={{
                  readOnly: true,
                  sx: {
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    wordBreak: 'break-all',
                  },
                }}
              />
              <Tooltip title={copied ? 'Copied!' : 'Copy URL'}>
                <IconButton
                  onClick={handleCopy}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'background.paper',
                  }}
                  color={copied ? 'success' : 'default'}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </IconButton>
              </Tooltip>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                icon={<TimeIcon />}
                label={`Expires in ${formatExpiry(getExpirySeconds())}`}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  setGeneratedUrl(null);
                  setError(null);
                }}
              >
                Generate Another
              </Button>
            </Stack>

            <Alert severity="warning" sx={{ py: 0.5 }}>
              <Typography variant="caption">
                Anyone with this URL can access this object until it expires. Share carefully.
              </Typography>
            </Alert>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ py: 0.5 }}>
            {error}
          </Alert>
        )}
      </Box>
    </BaseDialog>
  );
}
