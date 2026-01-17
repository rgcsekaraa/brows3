'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Alert,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
  AutoFixHigh as FormatIcon,
} from '@mui/icons-material';
import { objectApi } from '@/lib/tauri';
import Editor, { OnMount } from '@monaco-editor/react';
import { toast } from '@/store/toastStore';

interface ObjectPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion: string;
  objectKey: string;
  onSave?: () => void;
  startInEditMode?: boolean;
}

// Get file extension
const getExtension = (filename: string): string => {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts.pop()?.toLowerCase() || '';
};

// Check if file is an image
const isImage = (filename: string): boolean => {
  const ext = getExtension(filename);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff'].includes(ext);
};

// Check if file is video
const isVideo = (filename: string): boolean => {
  const ext = getExtension(filename);
  return ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'].includes(ext);
};

// Check if file is PDF
const isPdf = (filename: string): boolean => {
  return getExtension(filename) === 'pdf';
};

// Check if file is text/editable
// Check if file is text/editable
const isTextFile = (filename: string): boolean => {
  const ext = getExtension(filename);
  const textExts = [
    'txt', 'md', 'markdown', 'json', 'xml', 'html', 'css', 'scss', 'less', 'sass', 
    'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 
    'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'groovy', 'pl', 'sh', 'bash', 'zsh', 'fish', 
    'bat', 'cmd', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 
    'gradle', 'sql', 'prisma', 'graphql', 'gql', 'log', 'csv', 'tsv', 'lock', 'gitignore', 
    'dockerfile', 'makefile', 'cmake', 'tf', 'hcl', 'lua', 'dart', 'r', 'ex', 'exs'
  ];
  return textExts.includes(ext) || filename.startsWith('.') || ext === ''; // Treat no-extension files as text usually
};

const getLanguage = (filename: string): string => {
    const ext = getExtension(filename);
    switch(ext) {
        case 'js': case 'jsx': return 'javascript';
        case 'ts': case 'tsx': return 'typescript';
        case 'py': return 'python';
        case 'rs': return 'rust';
        case 'md': case 'markdown': return 'markdown';
        case 'sh': case 'bash': case 'zsh': case 'fish': return 'shell';
        case 'yml': case 'yaml': return 'yaml';
        case 'json': case 'lock': return 'json';
        case 'xml': case 'svg': return 'xml';
        case 'html': return 'html';
        case 'css': case 'scss': case 'less': case 'sass': return 'css';
        case 'sql': return 'sql';
        case 'java': return 'java';
        case 'cpp': case 'c': case 'h': case 'hpp': return 'cpp';
        case 'cs': return 'csharp';
        case 'go': return 'go';
        case 'dockerfile': return 'dockerfile';
        case 'lua': return 'lua';
        case 'rb': return 'ruby';
        case 'php': return 'php';
        case 'ini': case 'conf': case 'cfg': case 'properties': case 'env': case 'toml': return 'ini';
        case 'bat': case 'cmd': case 'ps1': return 'bat';
        case 'kt': case 'kts': return 'kotlin';
        case 'swift': return 'swift';
        case 'scala': return 'scala';
        case 'pl': return 'perl';
        case 'graphql': case 'gql': return 'graphql';
        case 'tf': case 'hcl': return 'hcl'; // Monaco might need plugin for hcl, fallback to plaintext if not built-in, but often maps to ruby or similar highlighting
        case 'r': return 'r';
        default: return 'plaintext';
    }
};

export default function ObjectPreviewDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
  onSave,
  startInEditMode = false,
}: ObjectPreviewDialogProps) {
  const theme = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [isImageRendering, setIsImageRendering] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const editorRef = useRef<any>(null);

  const filename = objectKey.split('/').pop() || objectKey;
  const ext = getExtension(filename);
  const isImageFile = isImage(filename);
  const isVideoFile = isVideo(filename);
  const isPdfFile = isPdf(filename);
  const isText = isTextFile(filename);

  useEffect(() => {
    if (!open || !objectKey) return;

    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      setContent('');
      setEditedContent('');
      setPresignedUrl(null);
      setIsEditing(startInEditMode); // Reset edit mode based on prop

      // Safety timeout to prevent infinite spinner
      const timeoutId = setTimeout(() => {
        if (isLoading) {
             console.error("Content loading timed out");
             setIsLoading(false);
             setError("Loading timed out. Please try again.");
        }
      }, 15000); 

      try {
        if (isImageFile || isVideoFile || isPdfFile) {
          // Get presigned URL for preview
          if (isImageFile) setIsImageRendering(true);
          if (isPdfFile) {
             setIsPdfLoading(true);
             setTimeout(() => setIsPdfLoading(false), 5000); 
          }
          const url = await objectApi.getPresignedUrl(bucketName, bucketRegion, objectKey, 3600);
          setPresignedUrl(url);
        } else if (isText) {
          // Get text content
          const textContent = await objectApi.getObjectContent(bucketName, bucketRegion, objectKey);
          
          // Even if empty, it's valid content
          setContent(textContent || '');
          setEditedContent(textContent || '');
        } else {
             // Not a recognized preview type, but maybe accessible as text?
             // We won't auto-load to save bandwidth/confusion, just show "Preview not available"
        }
      } catch (err) {
        console.error("Failed to load object content:", err);
        setError(err instanceof Error ? err.message : 'Failed to load content');
      } finally {
        clearTimeout(timeoutId);
        setIsLoading(false);
      }
    };

    loadContent();
  }, [open, objectKey, bucketName, bucketRegion, isImageFile, isVideoFile, isPdfFile, isText]);

  const handleSave = async () => {
    // Only save if content changed or if we just want to force save (user might format and save)
    if (!isEditing) return;

    setIsSaving(true);
    setError(null);

    try {
      await objectApi.putObjectContent(bucketName, bucketRegion, objectKey, editedContent);
      setContent(editedContent);
      toast.success('File Saved', `${objectKey.split('/').pop()} saved successfully`);
      onSave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(isEditing ? editedContent : content);
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
  };

  const handleFormat = () => {
      if (editorRef.current) {
          editorRef.current.getAction('editor.action.formatDocument').run();
      }
  };

  const handleClose = () => {
    setIsEditing(false);
    onClose();
  };

  const isFormattable = ['json', 'html', 'xml', 'css', 'js', 'ts', 'jsx', 'tsx'].includes(ext);

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="lg" 
      fullWidth
      PaperProps={{ sx: { height: '75vh', maxHeight: '900px' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ maxWidth: 500 }}>
            {filename}
          </Typography>
          {ext && (
            <Typography variant="caption" sx={{ bgcolor: 'action.hover', px: 1, py: 0.25, borderRadius: 1 }}>
              {ext.toUpperCase()}
            </Typography>
          )}
        </Box>
        <Box>
            {isText && (
                <IconButton onClick={handleCopyContent} size="small" title="Copy Content">
                    <CopyIcon fontSize="small" />
                </IconButton>
            )}
            <IconButton onClick={handleClose} size="small">
                <CloseIcon />
            </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        {isLoading && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
        )}

        {/* Image Preview */}
        {!isLoading && !error && isImageFile && presignedUrl && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, overflow: 'auto', position: 'relative' }}>
            {isImageRendering && (
                <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', zIndex: 1 }}>
                    <CircularProgress size={32} />
                </Box>
            )}
            <img 
              src={presignedUrl} 
              alt={filename}
              onLoad={() => setIsImageRendering(false)}
              style={{ 
                maxWidth: '100%', 
                maxHeight: '100%', 
                objectFit: 'contain',
                opacity: isImageRendering ? 0 : 1,
                transition: 'opacity 0.2s ease-in-out'
              }}
            />
          </Box>
        )}

        {/* Video Preview */}
        {!isLoading && !error && isVideoFile && presignedUrl && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0, bgcolor: 'black' }}>
             <video 
                controls 
                src={presignedUrl} 
                style={{ width: '100%', height: '100%' }}
                onError={() => setError('This video format is not supported by your browser.')}
             >
                Your browser does not support the video tag.
             </video>
          </Box>
        )}

        {/* PDF Preview */}
        {/* PDF Preview */}
        {!isLoading && !error && isPdfFile && presignedUrl && (
             <Box sx={{ flex: 1, width: '100%', height: '100%', position: 'relative' }}>
                {isPdfLoading && (
                    <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', zIndex: 1, gap: 2 }}>
                        <CircularProgress size={32} />
                        <Typography variant="caption" color="text.secondary">Loading PDF...</Typography>
                    </Box>
                )}
                {/* Fallback frame error message isn't easy to catch cross-origin, but we can offer a download link if it looks stuck or user wants external view */}
                <embed 
                    src={`${presignedUrl}#toolbar=0&navpanes=0&view=FitH`} 
                    title={filename}
                    width="100%" 
                    height="100%" 
                    type="application/pdf"
                    style={{ border: 'none' }} 
                    onLoad={() => setIsPdfLoading(false)}
                    onError={() => {
                        setIsPdfLoading(false);
                        setError("Failed to load PDF preview.");
                    }}
                />
             </Box>
        )}

        {/* Monaco Editor (Text) */}
        {!isLoading && !error && isText && (
           <Box sx={{ flex: 1, height: '100%', overflow: 'hidden' }}>
             <Editor 
                height="100%"
                defaultLanguage={getLanguage(filename)}
                value={isEditing ? editedContent : content}
                options={{ 
                    readOnly: !isEditing, 
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    wordWrap: 'on',
                    automaticLayout: true,
                }}
                theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                onChange={(val) => setEditedContent(val || '')}
                onMount={handleEditorDidMount}
                loading={
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress size={32} />
                  </Box>
                }
             />
           </Box>
        )}

        {!isLoading && !error && !isImageFile && !isVideoFile && !isPdfFile && !isText && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
            <Typography color="text.secondary">
              Preview not available for this file type ({ext || 'unknown'})
            </Typography>
          </Box>
        )}
      </DialogContent>

      {isText && (
        <DialogActions sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1, display: 'flex', gap: 1 }}>
              {isFormattable && isEditing && (
                  <Button 
                      startIcon={<FormatIcon />} 
                      onClick={handleFormat} 
                      size="small"
                      title="Format Document"
                  >
                      Format
                  </Button>
              )}
          </Box>
          
          {!isEditing && (
            <Button startIcon={<EditIcon />} onClick={() => setIsEditing(true)} variant="contained" size="small">
              Edit
            </Button>
          )}
          
          {isEditing && (
            <>
              <Button onClick={() => { setIsEditing(false); setEditedContent(content); }} color="inherit">
                Cancel
              </Button>
              <Button 
                startIcon={<SaveIcon />} 
                onClick={handleSave} 
                variant="contained" 
                color="primary"
                disabled={isSaving || editedContent === content}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}
