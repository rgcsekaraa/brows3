import { useState, useEffect, useRef } from 'react';
import {
  Button,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  ContentCopy as CopyIcon,
  AutoFixHigh as FormatIcon,
} from '@mui/icons-material';
import { objectApi } from '@/lib/tauri';
import Editor, { OnMount } from '@monaco-editor/react';
import { toast } from '@/store/toastStore';
import { BaseDialog } from '../common/BaseDialog';

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
  objectSize,
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

      // 2MB Limit check for text files
      const MAX_PREVIEW_SIZE = 2 * 1024 * 1024; // 2MB
      if (isText && objectSize && objectSize > MAX_PREVIEW_SIZE) {
          setIsLoading(false);
          setError(`File is too large to preview (${(objectSize / 1024 / 1024).toFixed(2)} MB). Please download to view locally.`);
          return;
      }

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
  }, [open, objectKey, bucketName, bucketRegion, isImageFile, isVideoFile, isPdfFile, isText, objectSize]);

  const handleSave = async () => {
    if (!isEditing) return;

    setIsSaving(true);
    setError(null);

    try {
      await objectApi.putObjectContent(bucketName, bucketRegion, objectKey, editedContent);
      setContent(editedContent);
      toast.success('File Saved', `${filename} saved successfully`);
      onSave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(isEditing ? editedContent : content);
    toast.info('Copied', 'Content copied to clipboard');
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
              {isEditing && isFormattable && (
                <Button 
                  startIcon={<FormatIcon />} 
                  onClick={handleFormat} 
                  size="small"
                  sx={{ color: theme.palette.text.secondary, fontWeight: 600 }}
                >
                  Format
                </Button>
              )}
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
                    disabled={isSaving || editedContent === content}
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
                    defaultLanguage={getLanguage(filename)}
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
                    onChange={(val) => setEditedContent(val || '')}
                    onMount={handleEditorDidMount}
                    loading={<CircularProgress size={32} />}
                 />
               </Box>
            )}

            {!isImageFile && !isVideoFile && !isPdfFile && !isText && (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
                <Typography color="text.secondary" variant="body1" sx={{ fontWeight: 500 }}>
                  Preview not available for this file type ({ext || 'unknown'})
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </BaseDialog>
  );
}
