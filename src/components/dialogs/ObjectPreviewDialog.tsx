import { useState, useEffect, useRef } from 'react';
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
import Editor, { OnMount } from '@monaco-editor/react';
import { toast } from '@/store/toastStore';
import { BaseDialog } from '../common/BaseDialog';
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
  const [isImageRendering, setIsImageRendering] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const initialVersionIdRef = useRef<number>(0);
  const [currentVersionId, setCurrentVersionId] = useState<number>(0);
  const loadRequestIdRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filename = getObjectName(objectKey);
  const ext = getObjectExtension(filename);
  const objectKind = getObjectKind(filename, contentType);
  const isImageFile = objectKind === 'image';
  const isAudioFile = objectKind === 'audio';
  const isVideoFile = objectKind === 'video';
  const isPdfFile = objectKind === 'pdf';
  const isText = objectKind === 'text';
  
  // Compute whether content has actually changed from original
  // Uses Monaco's version ID for accurate undo/redo tracking when available
  // Version ID comparison handles undo correctly - when version matches initial, no changes
  const hasChanges = editorRef.current 
    ? currentVersionId !== initialVersionIdRef.current 
    : editedContent !== content;

  useEffect(() => {
    if (!open || !objectKey) return;
    const requestId = ++loadRequestIdRef.current;
    let cancelled = false;

    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      setContent('');
      setEditedContent('');
      setContentType(null);
      setPresignedUrl(null);
      setIsEditing(startInEditMode); // Reset edit mode based on prop
      // Reset version tracking for fresh content
      initialVersionIdRef.current = 0;
      setCurrentVersionId(0);
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

        const resolvedKind = getObjectKind(filename, resolvedContentType);
        if (resolvedKind === 'text' && resolvedObjectSize && resolvedObjectSize > maxPreviewBytes) {
          setError(`File is too large to preview (${(resolvedObjectSize / 1024 / 1024).toFixed(2)} MB). Increase the ${maxTextPreviewSizeMb} MB text preview limit in Settings or download it.`);
          return;
        }

        if (resolvedKind === 'image' || resolvedKind === 'audio' || resolvedKind === 'video' || resolvedKind === 'pdf') {
          // Get presigned URL for preview
          if (resolvedKind === 'image') setIsImageRendering(true);
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
            setContent(textContent || '');
            setEditedContent(textContent || '');
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
        if (loadTimeoutRef.current) {
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
  }, [open, objectKey, bucketName, bucketRegion, objectSize, startInEditMode, filename, maxTextPreviewSizeMb]);

  const handleSave = async () => {
    if (!isEditing) return;

    setIsSaving(true);
    setError(null);

    try {
      await objectApi.putObjectContent(bucketName, bucketRegion, objectKey, editedContent);
      setContent(editedContent);
      // Reset version tracking - current state is now the new baseline
      if (editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          const newVersionId = model.getAlternativeVersionId();
          initialVersionIdRef.current = newVersionId;
          setCurrentVersionId(newVersionId);
        }
      }
      toast.success('File Saved', `${filename} saved successfully`);
      onSave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
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

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    // Store the initial version ID when editor mounts with content
    // This allows us to compare against the original state even after undo
    const model = editor.getModel();
    if (model) {
      initialVersionIdRef.current = model.getAlternativeVersionId();
    }
  };

  const handleClose = () => {
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

  return (
    <BaseDialog 
      open={open} 
      onClose={handleClose} 
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
                    onClick={() => { setIsEditing(false); setEditedContent(content); }} 
                    sx={{ color: theme.palette.text.secondary, fontWeight: 600 }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    startIcon={<SaveIcon />} 
                    onClick={handleSave} 
                    variant="contained" 
                    disabled={isSaving || !hasChanges}
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
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 1 }}>
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

        {!isLoading && !error && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Image Preview */}
            {isImageFile && presignedUrl && (
              <Box sx={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                p: 2, 
                position: 'relative',
                bgcolor: alpha(theme.palette.background.paper, 0.5)
              }}>
                {isImageRendering && <CircularProgress size={32} sx={{ position: 'absolute' }} />}
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URLs are dynamic and not known to Next image config. */}
                <img 
                  src={presignedUrl} 
                  alt={filename}
                  onLoad={() => setIsImageRendering(false)}
                  style={{ 
                    maxWidth: '100%', 
                    maxHeight: '100%', 
                    objectFit: 'contain',
                    borderRadius: 4,
                    opacity: isImageRendering ? 0 : 1,
                    transition: 'opacity 0.3s'
                  }}
                />
              </Box>
            )}

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
                    value={isEditing ? editedContent : content}
                    options={{ 
                        readOnly: !isEditing, 
                        minimap: { enabled: true },
                        scrollBeyondLastLine: false,
                        fontSize: 14,
                        wordWrap: 'on',
                        automaticLayout: true,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        padding: { top: 16, bottom: 16 }
                    }}
                    theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                    onChange={(val) => {
                      setEditedContent(val || '');
                      // Track version ID for accurate undo detection
                      if (editorRef.current) {
                        const model = editorRef.current.getModel();
                        if (model) {
                          setCurrentVersionId(model.getAlternativeVersionId());
                        }
                      }
                    }}
                    onMount={handleEditorDidMount}
                    loading={<CircularProgress size={32} />}
                 />
               </Box>
            )}

            {!isImageFile && !isVideoFile && !isPdfFile && !isText && (
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
  );
}
