import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { copyToClipboard, objectApi } from '@/lib/tauri';
import Editor from '@monaco-editor/react';
import { toast } from '@/store/toastStore';
import { BaseDialog } from '../common/BaseDialog';
import ImagePreviewViewer from './ImagePreviewViewer';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { getEditorLanguage, getObjectExtension, getObjectKind, getObjectName } from '@/lib/objectCapabilities';
import { useSettingsStore } from '@/store/settingsStore';

interface ObjectPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion: string;
  objectKey: string;
  objectSize?: number;
  onSave?: () => void;
  startInEditMode?: boolean;
  imageSequence?: string[];
  onNavigateImage?: (key: string) => void;
  navigation?: { index: number; total: number; busy: boolean; error: string; onPrevious?: () => void; onNext?: () => void };
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export default function ObjectPreviewDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
  objectSize,
  onSave,
  startInEditMode = false,
  imageSequence = [],
  onNavigateImage,
  navigation,
  isSelected = false,
  onToggleSelect,
}: ObjectPreviewDialogProps) {
  const theme = useTheme();
  const maxTextPreviewSizeMb = useSettingsStore((state) => state.maxTextPreviewSizeMb);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [contentType, setContentType] = useState<string | null>(null);
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [textIdentity, setTextIdentity] = useState<{ etag: string | null; profileId: string } | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [loadedObjectKey, setLoadedObjectKey] = useState('');
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [discardAction, setDiscardAction] = useState<'close' | 'cancel' | null>(null);
  const previewRoot = useRef<HTMLDivElement>(null);
  const loadRequestIdRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => { queueMicrotask(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }); };
  }, [open]);

  const filename = getObjectName(objectKey);
  const ext = getObjectExtension(filename);
  const objectKind = getObjectKind(filename, contentType);
  const isImageFile = objectKind === 'image';
  const isAudioFile = objectKind === 'audio';
  const isVideoFile = objectKind === 'video';
  const isPdfFile = objectKind === 'pdf';
  const isText = objectKind === 'text';
  
  // Content is authoritative across undo, save, and controlled discard resets.
  // Monaco assigns a new version even when restoring the original text.
  const hasChanges = editedContent !== content;

  useEffect(() => {
    if (!open || !objectKey) return;
    const requestId = ++loadRequestIdRef.current;
    let cancelled = false;

    const loadContent = async () => {
      setLoadedObjectKey(objectKey);
      setIsLoading(true);
      setError(null);
      setContent('');
      setTextIdentity(null);
      setEditedContent('');
      setContentType(null);
      setPresignedUrl(null);
      setIsEditing(startInEditMode); // Reset edit mode based on prop
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      if (pdfLoadingTimeoutRef.current) {
        clearTimeout(pdfLoadingTimeoutRef.current);
        pdfLoadingTimeoutRef.current = null;
      }

      const maxPreviewBytes = maxTextPreviewSizeMb * 1024 * 1024;

      // Safety timeout to prevent infinite spinner
      loadTimeoutRef.current = setTimeout(() => {
        if (!cancelled && requestId === loadRequestIdRef.current) {
          console.error("Content loading timed out");
          setIsLoading(false);
          setError("Loading timed out. Please try again.");
        }
      }, 120000);

      try {
        let resolvedContentType: string | null = null;
        let resolvedObjectSize = objectSize;
        try {
          const metadata = await objectApi.getObjectMetadata(bucketName, bucketRegion, objectKey);
          resolvedContentType = metadata.content_type;
          resolvedObjectSize = metadata.size;
          if (!cancelled && requestId === loadRequestIdRef.current) {
            setContentType(metadata.content_type);
          }
        } catch (metadataErr) {
          console.warn('Failed to load object metadata, falling back to filename-based detection:', metadataErr);
        }

        if (cancelled || requestId !== loadRequestIdRef.current) return;

        const resolvedKind = getObjectKind(filename, resolvedContentType);
        if (resolvedKind === 'text' && resolvedObjectSize && resolvedObjectSize > maxPreviewBytes) {
          setError(`File is too large to preview (${(resolvedObjectSize / 1024 / 1024).toFixed(2)} MB). Increase the ${maxTextPreviewSizeMb} MB text preview limit in Settings or download it.`);
          return;
        }

        if (resolvedKind === 'image' || resolvedKind === 'audio' || resolvedKind === 'video' || resolvedKind === 'pdf') {
          // Get presigned URL for preview
          if (resolvedKind === 'pdf') {
             setIsPdfLoading(true);
             pdfLoadingTimeoutRef.current = setTimeout(() => {
               if (!cancelled && requestId === loadRequestIdRef.current) {
                 setIsPdfLoading(false);
               }
             }, 5000);
          }
          const url = await objectApi.getPresignedUrl(bucketName, bucketRegion, objectKey, 3600);
          if (!cancelled && requestId === loadRequestIdRef.current) {
            setPresignedUrl(url);
          }
        } else if (resolvedKind === 'text') {
          // Get text content
          const textContent = await objectApi.getObjectContent(
            bucketName,
            bucketRegion,
            objectKey,
            maxPreviewBytes
          );
          
          // Even if empty, it's valid content
          if (!cancelled && requestId === loadRequestIdRef.current) {
            setContent(textContent.content);
            setEditedContent(textContent.content);
            setTextIdentity({ etag: textContent.e_tag, profileId: textContent.profile_id });
          }
        } else {
          setError('This object is not previewable in the app. Please download it to inspect locally.');
        }
      } catch (err) {
        console.error("Failed to load object content:", err);
        if (!cancelled && requestId === loadRequestIdRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestId === loadRequestIdRef.current && loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        if (!cancelled && requestId === loadRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      cancelled = true;
      loadRequestIdRef.current += 1;
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      if (pdfLoadingTimeoutRef.current) {
        clearTimeout(pdfLoadingTimeoutRef.current);
        pdfLoadingTimeoutRef.current = null;
      }
    };
  }, [open, objectKey, bucketName, bucketRegion, objectSize, startInEditMode, filename, maxTextPreviewSizeMb, reloadAttempt]);

  const handleSave = async () => {
    if (!isEditing || isSaving || !textIdentity?.etag) return;
    const requestId = loadRequestIdRef.current;

    setIsSaving(true);
    setError(null);

    try {
      const etag = await objectApi.putObjectContent(bucketName, bucketRegion, objectKey, editedContent, textIdentity.etag, textIdentity.profileId);
      if (requestId !== loadRequestIdRef.current) return;
      setTextIdentity({ ...textIdentity, etag });
      setContent(editedContent);
      toast.success('File Saved', `${filename} saved successfully`);
      onSave?.();
    } catch (err) {
      if (requestId === loadRequestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyContent = async () => {
    try {
      await copyToClipboard(isEditing ? editedContent : content);
      toast.info('Copied', 'Content copied to clipboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy content');
    }
  };

  const closePreview = () => {
    loadRequestIdRef.current += 1;
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (pdfLoadingTimeoutRef.current) {
      clearTimeout(pdfLoadingTimeoutRef.current);
      pdfLoadingTimeoutRef.current = null;
    }
    setIsEditing(false);
    onClose();
  };
  const handleClose = () => {
    if (isSaving) return;
    if (isEditing && hasChanges) { setDiscardAction('close'); return; }
    closePreview();
  };
  const navBlocked = isEditing || isSaving || navigation?.busy;
  useEffect(() => {
    if (open && !isImageFile && !startInEditMode) previewRoot.current?.focus({ preventScroll: true });
  }, [open, objectKey, isImageFile, startInEditMode]);

  if (isImageFile) {
    const index = navigation?.index ?? imageSequence.indexOf(objectKey);
    return <ImagePreviewViewer
      key={JSON.stringify([bucketName, bucketRegion])}
      open={open} name={filename} url={isLoading || loadedObjectKey !== objectKey ? null : presignedUrl} error={loadedObjectKey === objectKey ? error : null} attempt={reloadAttempt}
      index={index} total={navigation?.total ?? (index >= 0 ? imageSequence.length : 0)}
      onPrevious={navigation ? navigation.onPrevious : onNavigateImage && index > 0 ? () => onNavigateImage(imageSequence[index - 1]) : undefined}
      onNext={navigation ? navigation.onNext : onNavigateImage && index >= 0 && index < imageSequence.length - 1 ? () => onNavigateImage(imageSequence[index + 1]) : undefined}
      navigationLabel={navigation ? 'file' : 'image'} navigationBusy={navigation?.busy} navigationError={navigation?.error}
      isSelected={isSelected} onToggleSelect={onToggleSelect}
      onClose={handleClose} onRetry={() => setReloadAttempt(attempt => attempt + 1)}
    />;
  }

  return (<>
    <BaseDialog 
      open={open} 
      onClose={handleClose} 
      closeDisabled={isSaving}
      title={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h4" sx={{ 
            fontSize: '1.1rem', 
            fontWeight: 800,
            maxWidth: { xs: 200, sm: 400, md: 600 },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {filename}
          </Typography>
          {ext && (
            <Box sx={{ 
              bgcolor: alpha(theme.palette.primary.main, 0.1), 
              color: theme.palette.primary.main,
              px: 1, 
              py: 0.2, 
              borderRadius: 1,
              fontSize: '0.7rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.2)
            }}>
              {ext}
            </Box>
          )}
        </Box>
      }
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { height: '80vh', maxHeight: '1000px' } }}
      actions={
        isText ? (
          <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button 
                startIcon={<CopyIcon />} 
                onClick={handleCopyContent} 
                size="small"
                sx={{ color: theme.palette.text.secondary, fontWeight: 600 }}
              >
                Copy
              </Button>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {!isEditing ? (
                <Button 
                  startIcon={<EditIcon />} 
                  onClick={() => setIsEditing(true)} 
                  variant="contained" 
                  size="small"
                >
                  Edit File
                </Button>
              ) : (
                <>
                  <Button 
                    disabled={isSaving}
                    onClick={() => { if (hasChanges) setDiscardAction('cancel'); else { setIsEditing(false); setEditedContent(content); } }}
                    sx={{ color: theme.palette.text.secondary, fontWeight: 600 }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    startIcon={<SaveIcon />} 
                    onClick={handleSave} 
                    variant="contained" 
                    disabled={isSaving || !hasChanges || !textIdentity?.etag}
                    sx={{
                      // Visual feedback: dim when no changes
                      opacity: !hasChanges ? 0.6 : 1,
                    }}
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </>
              )}
            </Box>
          </Box>
        ) : null
      }
    >
      <Box ref={previewRoot} tabIndex={-1} sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 1, outline: 'none' }} onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || navBlocked) return;
        if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"],video,audio,embed,.monaco-editor')) return;
        if (event.key === 'ArrowLeft' && navigation?.onPrevious) { event.preventDefault(); event.stopPropagation(); navigation.onPrevious(); }
        if (event.key === 'ArrowRight' && navigation?.onNext) { event.preventDefault(); event.stopPropagation(); navigation.onNext(); }
        if (event.key === ' ' && onToggleSelect && !(event.target as HTMLElement).closest('button')) { event.preventDefault(); event.stopPropagation(); onToggleSelect(); }
      }}>
        {(navigation || onToggleSelect) && <Box role="group" aria-label="Preview controls" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', pb: 1.5 }}>
          {onToggleSelect && <Button size="small" variant="outlined" aria-label="Select file" aria-pressed={isSelected} onClick={onToggleSelect} sx={{ borderRadius: '999px', color: 'text.primary', bgcolor: isSelected ? 'action.selected' : 'transparent' }}>{isSelected ? 'Selected' : 'Select'}</Button>}
          {navigation && (navigation.total > 1 || navigation.onNext) && <>
            <Button size="small" sx={{ borderRadius: '999px', color: 'text.primary' }} aria-label="Previous file" disabled={navBlocked || !navigation.onPrevious} onClick={navigation.onPrevious}>Previous</Button>
            <Typography variant="caption" aria-label="Preview position">{navigation.index + 1} / {navigation.total}</Typography>
            <Button size="small" sx={{ borderRadius: '999px', color: 'text.primary' }} aria-label="Next file" disabled={navBlocked || !navigation.onNext} onClick={navigation.onNext}>Next</Button>
          </>}
          {isEditing && <Typography variant="caption" color="text.secondary">Finish editing before navigating.</Typography>}
        </Box>}
        {(navigation?.busy || navigation?.error) && <Typography role="status" variant="body2" sx={{ mb: 1 }}>{navigation.busy ? 'Looking for the next previewable file...' : navigation.error}</Typography>}
        {isLoading && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <CircularProgress size={40} thickness={4} />
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>Fetching content...</Typography>
          </Box>
        )}

        {error && (
          <Box sx={{ p: 4 }}>
            <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>{error}</Alert>
          </Box>
        )}

        {!isLoading && isText && textIdentity && !textIdentity.etag && (
          <Alert severity="warning">This provider did not return an ETag. Download or copy the text to edit it safely.</Alert>
        )}

        {!isLoading && (!error || textIdentity) && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Video Preview */}
            {isVideoFile && presignedUrl && (
              <Box sx={{ flex: 1, bgcolor: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <video 
                    controls 
                    src={presignedUrl} 
                    style={{ width: '100%', height: '100%', maxHeight: 'calc(80vh - 120px)' }}
                 >
                    Your browser does not support the video tag.
                 </video>
              </Box>
            )}

            {/* Audio Preview */}
            {isAudioFile && presignedUrl && (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
                <audio controls src={presignedUrl} style={{ width: 'min(100%, 720px)' }}>
                  Your browser does not support the audio tag.
                </audio>
              </Box>
            )}

            {/* PDF Preview */}
            {isPdfFile && presignedUrl && (
                 <Box sx={{ flex: 1, width: '100%', position: 'relative' }}>
                    {isPdfLoading && (
                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: theme.palette.background.default, zIndex: 1, gap: 2 }}>
                            <CircularProgress size={32} />
                            <Typography variant="caption" color="text.secondary">Loading PDF...</Typography>
                        </Box>
                    )}
                    <embed 
                        src={`${presignedUrl}#toolbar=0&navpanes=0&view=FitH`} 
                        title={filename}
                        width="100%" 
                        height="100%" 
                        type="application/pdf"
                        style={{ border: 'none' }} 
                        onLoad={() => setIsPdfLoading(false)}
                    />
                 </Box>
            )}

            {/* Monaco Editor (Text) */}
            {isText && (
               <Box sx={{ flex: 1, border: '1px solid', borderColor: 'divider', borderRadius: 0.5, overflow: 'hidden' }}>
                 <Editor 
                    height="100%"
                    defaultLanguage={getEditorLanguage(filename, contentType)}
                    value={editedContent}
                    options={{ 
                        readOnly: !isEditing || isSaving,
                        minimap: { enabled: true },
                        scrollBeyondLastLine: false,
                        fontSize: 14,
                        wordWrap: 'on',
                        automaticLayout: true,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        padding: { top: 16, bottom: 16 }
                    }}
                    theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                    onChange={(val) => setEditedContent(val || '')}
                    loading={<CircularProgress size={32} />}
                 />
               </Box>
            )}

            {!isImageFile && !isVideoFile && !isAudioFile && !isPdfFile && !isText && (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
                <Typography color="text.secondary" variant="body1" sx={{ fontWeight: 500 }}>
                  Preview not available for this file type
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </BaseDialog>
    <ConfirmDialog open={!!discardAction} title="Discard unsaved changes?" message="Your edits have not been saved. Discard them or keep editing." confirmLabel="Discard changes" cancelLabel="Keep editing" isDestructive onClose={() => setDiscardAction(null)} onConfirm={() => {
      const action = discardAction; setDiscardAction(null);
      if (action === 'close') closePreview();
      else { setIsEditing(false); setEditedContent(content); }
    }} />
    </>
  );
}
