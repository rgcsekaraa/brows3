'use client';

import { Suspense, useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  IconButton,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
  Alert,
  Menu,
  MenuItem,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Tooltip,
  Checkbox,
  Stack,
  Divider,
  Skeleton,
  InputAdornment,
  FormControlLabel,
  Fade,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Refresh as RefreshIcon,
  Home as HomeIcon,
  Description as DescriptionIcon,
  MoreVert as MoreVertIcon,
  CloudUpload as CloudUploadIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  ContentPaste as PasteIcon,
  DriveFileRenameOutline as RenameIcon,
  ContentCopy as CopyIcon,
  ContentCut as CutIcon,
  Info as InfoIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Bolt as BoltIcon,
  Sort as SortIcon,
  Storage as StorageIcon,
  FileCopy as FileCopyIcon,
  FilePresent as FilePresentIcon,
  Link as LinkIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  FolderZip as FolderZipIcon,
  ArrowDropDown as ArrowDropDownIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useObjects } from '@/hooks/useObjects';
import { operationsApi, transferApi, objectApi, S3Object } from '@/lib/tauri';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTransferStore } from '@/store/transferStore';
import { useClipboardStore } from '@/store/clipboardStore';
import { useTabStore } from '@/store/tabStore';
import PropertiesDialog from '@/components/dialogs/PropertiesDialog';
import ObjectPreviewDialog from '@/components/dialogs/ObjectPreviewDialog';
import { VirtualizedObjectTable } from '@/components/common/VirtualizedObjectTable';
import { toast } from '@/store/toastStore';
import { useHistoryStore } from '@/store/historyStore';

// Simple format bytes function
const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

function BucketContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const bucketName = searchParams.get('name');
  const bucketRegion = searchParams.get('region') || 'us-east-1';
  const prefix = searchParams.get('prefix') || '';
  
  const { data, isLoading, error: initialError, stats, refresh, loadMore, isLoadingMore, hasMore } = useObjects(bucketName || '', bucketRegion, prefix);
  const { addJob } = useTransferStore();
  const { addBucket } = useTabStore();
  
  // Sorting State
  const [sortField, setSortField] = useState<'name' | 'size' | 'date' | 'class'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeepSearch, setIsDeepSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<S3Object[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Error handling effect
  useEffect(() => {
    if (initialError) {
      toast.error(typeof initialError === 'string' ? initialError : 'Failed to load objects');
    }
  }, [initialError]);

  const handleSearch = async () => {
    if (!bucketName) return;
    
    // If empty query, clear everything
    if (!searchQuery.trim()) {
        setSearchResults(null);
        return;
    }
    
    if (isDeepSearch) {
        setIsSearching(true);
        try {
            // Server-side deep search (recursive)
            const results = await objectApi.searchObjects(bucketName, bucketRegion, searchQuery, prefix);
            setSearchResults(results);
        } catch (err) {
            displayError(`Search failed: ${err}`);
            setSearchResults(null);
        } finally {
            setIsSearching(false);
        }
    } else {
        // Local search is handled by useMemo (displayData), so we just clear server results
        setSearchResults(null); 
    }
  };

  // Auto-trigger search when toggling deep search if query exists
  useEffect(() => {
      if (searchQuery.trim()) {
        handleSearch();
      }
  }, [isDeepSearch]);

  // derived data for display (sorting handled by VirtualizedObjectTable)
  const displayData = useMemo(() => {
     // 1. Deep Search Results (Server-side)
     if (isDeepSearch && searchResults) {
         return {
             common_prefixes: [],
             objects: searchResults,
             next_continuation_token: null,
             is_truncated: false,
             prefix: prefix,
         };
     }
     
     // 2. Local Filtering (Client-side on current page data)
     if (!isDeepSearch && searchQuery && data) {
         const lowerQ = searchQuery.toLowerCase();
         return {
             ...data,
             objects: data.objects.filter(o => o.key.toLowerCase().includes(lowerQ)),
             common_prefixes: data.common_prefixes.filter(p => p.toLowerCase().includes(lowerQ))
         };
     }
     
     // 3. Default View
     return data;
  }, [data, searchResults, searchQuery, prefix, isDeepSearch]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMenuAnchor, setUploadMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Create Folder State
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Context Menu State
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedObject, setSelectedObject] = useState<{key: string, isFolder: boolean} | null>(null);
  
  // Properties State
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [selectedObjectProp, setSelectedObjectProp] = useState<string | null>(null);

  // Preview/Edit Dialog State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const handlePropertiesOpen = () => {
    handleMenuClose();
    if (selectedObject) {
       setSelectedObjectProp(selectedObject.key);
       setPropertiesOpen(true);
    }
  };

  // Delete Check State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayError = (msg: string, details?: string) => {
    toast.error(msg, details);
  };

  const displaySuccess = (msg: string) => {
    toast.success(msg);
  };

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean);
    let path = '';
    return parts.map((part) => {
      path += part + '/';
      return { name: part, path: path };
    });
  }, [prefix]);

  const { addRecent, addFavorite, removeFavorite, isFavorite } = useHistoryStore();

  const handleNavigate = (newPrefix: string) => {
    // Track in recent history
    if (newPrefix && bucketName) {
      const name = newPrefix.split('/').filter(Boolean).pop() || newPrefix;
      addRecent({
        key: newPrefix,
        name,
        bucket: bucketName,
        region: bucketRegion,
        isFolder: true,
      });
    }
    
    const params = new URLSearchParams();
    if (bucketName) params.set('name', bucketName);
    if (bucketRegion) params.set('region', bucketRegion);
    if (newPrefix) params.set('prefix', newPrefix);
    router.push(`/bucket?${params.toString()}`);
  };

  const handleBack = () => {
    if (!prefix) {
      router.push('/');
      return;
    }
    const parts = prefix.split('/').filter(Boolean);
    parts.pop();
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    handleNavigate(newPrefix);
  };

  // --- ACTIONS ---

  // Multi-select State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  
  // Selection Handlers
  const handleSelect = (key: string, checked: boolean) => {
    const newSelected = new Set(selectedKeys);
    if (checked) newSelected.add(key);
    else newSelected.delete(key);
    setSelectedKeys(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && displayData) {
      const allKeys = [
        ...displayData.common_prefixes, 
        ...displayData.objects.map(o => o.key)
      ];
      setSelectedKeys(new Set(allKeys));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const clearSelection = () => setSelectedKeys(new Set());

  // Clipboard State
  const { items: clipboardItems, mode: clipboardMode, copy, cut, clear: clearClipboard } = useClipboardStore();

  const handleCopy = () => {
     if (selectedKeys.size === 0) return;
     const items = Array.from(selectedKeys).map(key => ({
       bucket: bucketName || '',
       region: bucketRegion,
       key,
       isFolder: key.endsWith('/')
     }));
     copy(items);
     clearSelection();
     displaySuccess(`Copied ${items.length} items`);
  };

  const handleCut = () => {
    if (selectedKeys.size === 0) return;
    const items = Array.from(selectedKeys).map(key => ({
      bucket: bucketName || '',
      region: bucketRegion,
      key,
      isFolder: key.endsWith('/')
    }));
    cut(items);
    clearSelection();
    displaySuccess(`Cut ${items.length} items to clipboard`);
  };

  const handlePaste = async () => {
    if (!bucketName || clipboardItems.length === 0) return;
    let successCount = 0;
    
    // We can't really do bulk copy via API yet, so iterate
    // Ideally this should be a backend Loop or Job in Phase 6+
    // For now, let's keep it simple: one by one (slow but works)
    
    try {
      for (const item of clipboardItems) {
        const fileName = item.key.split('/').filter(Boolean).pop();
        let destKey = prefix + fileName + (item.isFolder ? '/' : '');
        
        // Check for same location paste
        if (item.bucket === bucketName && item.region === bucketRegion && destKey === item.key) {
           // Auto-rename
           const namePart = fileName?.split('.').slice(0, -1).join('.') || fileName;
           const extPart = (fileName?.split('.').length ?? 0) > 1 ? '.' + fileName?.split('.').pop() : '';
           destKey = prefix + namePart + `-${Date.now()}` + extPart + (item.isFolder ? '/' : '');
        }
        
        if (clipboardMode === 'copy') {
          await operationsApi.copyObject(item.bucket, item.region, item.key, bucketName, bucketRegion, destKey);
        } else {
          await operationsApi.moveObject(item.bucket, item.region, item.key, bucketName, bucketRegion, destKey);
        }
        successCount++;
      }
      displaySuccess(`Pasted ${successCount} items`);
      if (clipboardMode === 'move') clearClipboard();
      refresh();
    } catch (err) {
      displayError(`Paste failed: ${err}`);
    }
  };

  // Actions

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
       // Copy: Cmd+C
       if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
         e.preventDefault();
         handleCopy();
       }
       // Cut: Cmd+X
       if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
         e.preventDefault();
         handleCut();
       }
       // Paste: Cmd+V
       if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
         e.preventDefault();
         handlePaste();
       }
       // Delete: Delete/Backspace (if verified)
       // Be careful with Backspace as it is nav back usually. allow only Del key or if explicitly focused
       // Let's stick to Delete key explicitly
       if (e.key === 'Delete' && selectedKeys.size > 0) {
         setDeleteConfirmOpen(true);
       }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedKeys, bucketName, clipboardItems, clipboardMode, propertiesOpen]); // Re-bind on dependency change

  // Restored Actions
  const handleUploadFiles = async () => {
    setUploadMenuAnchor(null);
    if (!bucketName) return;
    try {
      const selected = await open({
        multiple: true,
        title: 'Select files to upload'
      });
      
      if (selected) {
        setIsUploading(true);
        setError(null);
        
        const files = Array.isArray(selected) ? selected : [selected];
        let count = 0;
        
        for (const file of files) {
           const filename = file.split(/[/\\]/).pop() || 'uploaded-file';
           const key = prefix + filename;
           
           const jobId = await transferApi.queueUpload(bucketName, bucketRegion, key, file, 0); 
           
           addJob({
              id: jobId,
              transfer_type: 'Upload',
              bucket: bucketName,
              bucket_region: bucketRegion,
              key: key,
              local_path: file,
              total_bytes: 0,
              processed_bytes: 0,
              status: 'Queued',
              created_at: Date.now()
           });
           count++;
        }
        displaySuccess(`Queued ${count} files for upload`);
      }
    } catch (err) {
      displayError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadFolder = async () => {
    setUploadMenuAnchor(null);
    if (!bucketName) return;
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: 'Select folders to upload'
      });
      
      if (selected) {
         setIsUploading(true);
         const folders = Array.isArray(selected) ? selected : [selected];
         let totalFiles = 0;
         
         for (const folder of folders) {
             const count = await transferApi.queueFolderUpload(bucketName, bucketRegion, prefix, folder);
             totalFiles += count;
         }
         
         displaySuccess(`Queued ${totalFiles} files from ${folders.length} folders`);
      }
    } catch (err) {
      displayError(`Folder upload failed: ${err}`);
    } finally {
        setIsUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!bucketName || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const cleanName = newFolderName.trim().replace(/^\/+/, '').replace(/\/+$/, '');
      const key = prefix + cleanName + '/';
      
      await operationsApi.putObject(bucketName, bucketRegion, key);
      setCreateFolderOpen(false);
      setNewFolderName('');
      displaySuccess(`Created folder ${cleanName}`);
      refresh();
    } catch (err) {
      displayError(`Failed to create folder: ${err}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedKeys.size === 0) return;
    
    // Select directory for downloads
    const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Download Directory'
    });
    
    if (!selected) return;
    
    const downloadDir = Array.isArray(selected) ? selected[0] : selected;

    setIsUploading(true);
    let count = 0;
    try {
      for (const key of Array.from(selectedKeys)) {
        // Find if it's an object or folder in the current display
        const isSelectedObject = displayData?.objects.find(o => o.key === key);
        const isSelectedFolder = displayData?.common_prefixes ? (displayData as any).common_prefixes.find((p: string) => p === key) : null;
        
        if (isSelectedFolder) {
            const folderName = key.split('/').filter(Boolean).pop() || 'folder';
            const localPath = `${downloadDir}/${folderName}`;
            await transferApi.queueFolderDownload(bucketName || '', bucketRegion, key, localPath);
            count++;
        } else if (isSelectedObject) {
          const fileName = key.split('/').pop() || 'file';
          const localPath = `${downloadDir}/${fileName}`;
          await transferApi.queueDownload(bucketName || '', bucketRegion, key, localPath, isSelectedObject.size);
          count++;
        }
      }
      displaySuccess(`Queued ${count} items for download.`);
      setSelectedKeys(new Set());
    } catch (err) {
      displayError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  };
  
  const handleBulkDelete = async () => {
    if (!bucketName || selectedKeys.size === 0) return;
    
    setIsDeleting(true);
    try {
        await operationsApi.deleteObjects(bucketName, bucketRegion, Array.from(selectedKeys));
        displaySuccess(`Successfully deleted ${selectedKeys.size} items`);
        setSelectedKeys(new Set());
        refresh();
        setDeleteConfirmOpen(false); // Close dialog if open
    } catch (err) {
        displayError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
        setIsDeleting(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, key: string, isFolder: boolean) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
    setSelectedObject({ key, isFolder });
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setSelectedObject(null);
  };

  const handleDelete = async () => {
    if (!bucketName || !selectedObject) return;
    setIsDeleting(true);
    try {
      await operationsApi.deleteObject(bucketName, bucketRegion, selectedObject.key);
      setDeleteConfirmOpen(false);
      setSelectedObject(null);
      displaySuccess('Item deleted');
      refresh();
    } catch (err) {
      displayError(`Delete failed: ${err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Existing single actions
  const handleDownload = async () => {
    handleMenuClose();
    if (!bucketName || !selectedObject) return;
    
    try {
      if (selectedObject.isFolder) {
        // Select directory for folder download
        const downloadDir = await open({
            directory: true,
            multiple: false,
            title: 'Select Destination Directory'
        });
        
        if (downloadDir) {
            const dir = Array.isArray(downloadDir) ? downloadDir[0] : downloadDir;
            const folderName = selectedObject.key.split('/').filter(Boolean).pop() || 'folder';
            const localPath = `${dir}/${folderName}`;
            await transferApi.queueFolderDownload(bucketName, bucketRegion, selectedObject.key, localPath);
            displaySuccess('Folder download queued');
        }
      } else {
        const filename = selectedObject.key.split('/').pop() || 'download';
        const savePath = await save({
          defaultPath: filename,
          title: 'Save file as'
        });
        
        if (savePath) {
          // Use Transfer Queue
          await transferApi.queueDownload(bucketName, bucketRegion, selectedObject.key, savePath, 0);
          displaySuccess('Download queued');
        }
      }
    } catch (err) {
      displayError(`Download failed: ${err}`);
    }
  };

  const handleDeletePrompt = () => {
    handleMenuClose();
    if (selectedObject) {
       setSelectedKeys(new Set([selectedObject.key]));
       setDeleteConfirmOpen(true);
    } else if (selectedKeys.size > 0) {
       setDeleteConfirmOpen(true);
    }
  };
  
  // Rename
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  
  const handleRenamePrompt = () => {
    handleMenuClose();
    if (selectedObject) {
      const name = selectedObject.key.split('/').filter(Boolean).pop() || '';
      setRenameValue(name);
      setRenameOpen(true);
    }
  };

  const handleRename = async () => {
    if (!bucketName || !selectedObject || !renameValue.trim()) return;
    try {
       const oldKey = selectedObject.key;
       // Preserve 'folder/' structure if needed, or just filename
       // Assuming rename is just filename change in current directory
       const parent = oldKey.substring(0, oldKey.lastIndexOf(oldKey.endsWith('/') ? oldKey.slice(0, -1).split('/').pop() + '/' : oldKey.split('/').pop() || ''));
       // Actually simpler: we are at `prefix`
       // new key = prefix + renameValue
       // BUT if we selected something from a subfolder search? 
       // For now, assume rename happens in current view `prefix`.
       let newKey = prefix + renameValue.trim();
       if (selectedObject.isFolder && !newKey.endsWith('/')) newKey += '/';
       
       await operationsApi.moveObject(bucketName, bucketRegion, oldKey, bucketName, bucketRegion, newKey);
       displaySuccess('Renamed successfully');
       setRenameOpen(false);
       refresh();
    } catch (err) {
       displayError(`Rename failed: ${err}`);
    }
  };

  if (!bucketName) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error">Invalid bucket name</Typography>
        <Button onClick={() => router.push('/')} sx={{ mt: 2 }}>Back to Home</Button>
      </Box>
    );
  }

  // Show error state if bucket failed to load
  // Show error state if bucket failed to load
  if (initialError && !isLoading) {
    // Check if this might be a prefix-restricted access issue
    const isAccessDenied = initialError.toLowerCase().includes('access') || 
                           initialError.toLowerCase().includes('denied') ||
                           initialError.toLowerCase().includes('forbidden') ||
                           initialError.toLowerCase().includes('permission');
    
    return (
      <Box sx={{ 
        p: 6, 
        textAlign: 'center', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        gap: 2,
        maxWidth: 700,
        mx: 'auto',
        mt: 8
      }}>
        <StorageIcon sx={{ fontSize: 80, color: 'text.disabled' }} />
        <Typography variant="h5" fontWeight={600} gutterBottom>
          {isAccessDenied ? 'Access Restricted' : 'Bucket Not Found'}
        </Typography>
        <Typography color="text.secondary" variant="body1" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxWidth: '100%', overflow: 'auto' }}>
          {initialError}
        </Typography>
        
        {isAccessDenied ? (
          <>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              Your AWS credentials may have limited access to this bucket.
            </Typography>
            <Alert severity="info" sx={{ mt: 2, textAlign: 'left', maxWidth: 600 }}>
              <Typography variant="body2" gutterBottom>
                <strong>If you have access to a specific folder/prefix:</strong>
              </Typography>
              <Typography variant="body2" component="div">
                Use the <strong>Path Bar</strong> in the top navbar to navigate directly to your accessible path:
              </Typography>
              <Typography variant="body2" component="div" sx={{ mt: 1, fontFamily: 'monospace', bgcolor: 'background.paper', p: 1, borderRadius: 1 }}>
                s3://{bucketName}/your-prefix/
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Example: s3://my-bucket/team-data/reports/
              </Typography>
            </Alert>
          </>
        ) : (
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            This bucket may not exist, or you might not have permission to access it.
          </Typography>
        )}
        
        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button 
            variant="contained" 
            startIcon={<HomeIcon />}
            onClick={() => router.push('/')}
          >
            Back to Home
          </Button>
          <Button 
            variant="outlined" 
            startIcon={<RefreshIcon />}
            onClick={() => refresh()}
          >
            Try Again
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1, mt: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header & Breadcrumbs */}
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={handleBack} size="small">
          <ArrowBackIcon />
        </IconButton>
        
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <Breadcrumbs maxItems={5} itemsBeforeCollapse={2}>
            
            <Link
              component="button" 
              underline="hover"
              color={!prefix ? 'text.primary' : 'inherit'}
              onClick={() => bucketName && handleNavigate('')} 
              fontWeight={!prefix ? 800 : 500}
            >
              {bucketName}
            </Link>
            
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Link
                  key={crumb.path}
                  component="button"
                  underline={isLast ? 'none' : 'hover'}
                  color={isLast ? 'text.primary' : 'inherit'}
                  fontWeight={isLast ? 700 : 400}
                  onClick={() => !isLast && handleNavigate(crumb.path)}
                >
                  {crumb.name}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>


        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
           <TextField
             placeholder="Search current folder..."
             size="small"
             value={searchQuery}
             onChange={(e) => setSearchQuery(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
             InputProps={{
               startAdornment: (
                 <InputAdornment position="start">
                   <SearchIcon color="action" fontSize="small" />
                 </InputAdornment>
               ),
               endAdornment: (
                   <InputAdornment position="end">
                     {searchQuery && (
                         <IconButton size="small" onClick={() => { setSearchQuery(''); setIsDeepSearch(false); setSearchResults(null); }} edge="end">
                           <CloseIcon fontSize="small" />
                         </IconButton>
                     )}
                   </InputAdornment>
               )
             }}
              sx={{ width: 300, bgcolor: 'background.paper' }}
           />
           
           <FormControlLabel 
             control={
               <Checkbox 
                 checked={isDeepSearch} 
                 onChange={(e) => setIsDeepSearch(e.target.checked)} 
                 size="small"
                 sx={{ p: 0.5 }}
               />
             } 
             label={<Typography variant="body2" color="text.secondary">Deep Search</Typography>}
             sx={{ mr: 0, ml: 0.5 }}
           />

        {selectedKeys.size > 0 ? (
          <Fade in={selectedKeys.size > 0}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip 
                label={`${selectedKeys.size} selected`} 
                size="small" 
                color="primary" 
                variant="outlined" 
                onDelete={() => setSelectedKeys(new Set())}
                sx={{ fontWeight: 700, borderRadius: 1 }}
              />
              <Button 
                variant="outlined"
                size="small"
                onClick={handleDownloadSelected}
                startIcon={<DownloadIcon />}
                disabled={isUploading}
                sx={{ fontWeight: 700 }}
              >
                Download
              </Button>
               <Button 
                variant="contained" 
                color="error"
                size="small" 
                onClick={handleDeletePrompt}
                startIcon={<DeleteIcon />}
                disabled={isDeleting}
                sx={{ fontWeight: 700 }}
              >
                Delete
              </Button>
            </Box>
          </Fade>
        ) : (
          <>
        <Button 
          variant="outlined" 
          startIcon={<CreateNewFolderIcon />} 
          size="small"
          onClick={() => setCreateFolderOpen(true)}
          sx={{ fontWeight: 700 }} 
        >
          New Folder
        </Button>
        <Button 
          variant="contained" 
          startIcon={<CloudUploadIcon />} 
          endIcon={<ArrowDropDownIcon />}
          size="small" 
          disabled={isUploading}
          onClick={(e) => setUploadMenuAnchor(e.currentTarget)}
          sx={{ fontWeight: 700 }}
        >
          Upload
        </Button>
        {/* Premium Menu Styled globally via theme.ts */}
        <Menu
            anchorEl={uploadMenuAnchor}
            open={Boolean(uploadMenuAnchor)}
            onClose={() => setUploadMenuAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        >
            <MenuItem onClick={handleUploadFiles}>
                <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
                Files
            </MenuItem>
            <MenuItem onClick={handleUploadFolder}>
                <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
                Folder
            </MenuItem>
        </Menu>
          </>
        )}

        <Tooltip title="Refresh">
            <IconButton 
              onClick={() => refresh()} 
              disabled={isLoading} 
              color="primary" 
              sx={{ 
                bgcolor: 'background.paper', 
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
            <RefreshIcon className={isLoading ? 'spin-animation' : ''} />
            </IconButton>
        </Tooltip>
        </Box>
      </Box>





      {/* Content Table - Virtualized for 20k+ objects */}
      <VirtualizedObjectTable
        folders={displayData?.common_prefixes || []}
        objects={displayData?.objects || []}
        selectedKeys={selectedKeys}
        sortField={sortField}
        sortDirection={sortDirection}
        isLoading={isLoading || isSearching}
        onNavigate={handleNavigate}
        onSelect={handleSelect}
        onEndReached={loadMore}
        onSelectAll={handleSelectAll}
        onMenuOpen={handleMenuOpen}
        onSortChange={(field) => {
          if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
          } else {
            setSortField(field);
            setSortDirection(field === 'name' || field === 'class' ? 'asc' : 'desc');
          }
        }}
        onDownload={async (key) => {
          const filename = key.split('/').pop() || 'download';
          const savePath = await save({ defaultPath: filename, title: 'Save file as' });
          if (savePath && bucketName) {
            const jobId = await transferApi.queueDownload(bucketName, bucketRegion, key, savePath, 0);
            // Add to transfer store so it shows in the panel
            addJob({
              id: jobId,
              transfer_type: 'Download',
              bucket: bucketName,
              bucket_region: bucketRegion,
              key: key,
              local_path: savePath,
              total_bytes: 0,
              processed_bytes: 0,
              status: 'Queued',
              created_at: Date.now(),
            });
            displaySuccess(`Downloading: ${filename}`);
          }
        }}
        onDelete={(key) => {
          setSelectedObject({ key, isFolder: key.endsWith('/') });
          setSelectedKeys(new Set([key]));
          setDeleteConfirmOpen(true);
        }}
        onPreview={(key) => {
          setPreviewKey(key);
          setPreviewOpen(true);
        }}
        onEdit={(key) => {
          setPreviewKey(key);
          setPreviewOpen(true);
        }}
        onCopyPath={(key) => {
          const s3Uri = `s3://${bucketName}/${key}`;
          navigator.clipboard.writeText(s3Uri);
          displaySuccess(`Copied: ${s3Uri}`);
        }}
      />

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
      >
        {!selectedObject?.isFolder && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
            Download
          </MenuItem>
        )}
        {!selectedObject?.isFolder && selectedObject && (selectedObject.key.split('.').pop() || '').match(/^(txt|md|json|xml|html|css|js|ts|py|yaml|yml|log|csv)$/) && (
          <MenuItem onClick={() => {
            if (selectedObject) {
              setPreviewKey(selectedObject.key);
              setPreviewOpen(true);
            }
            handleMenuClose();
          }}>
            <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
            Edit
          </MenuItem>
        )}
        {selectedObject?.isFolder && (
          <MenuItem onClick={async () => {
            if (!selectedObject || !bucketName) return;
            handleMenuClose();
            
            // Get folder to save to
            const folderPath = await open({
              directory: true,
              title: 'Select folder to save files',
            });
            
            if (!folderPath) return;
            
            // Get all objects under this prefix
            try {
              displaySuccess('Starting folder download...');
              const objects = await objectApi.searchObjects(bucketName, bucketRegion, selectedObject.key);
              const filesToDownload = objects.filter(obj => !obj.key.endsWith('/'));
              
              // Calculate parent prefix to preserve folder structure
              const parts = selectedObject.key.split('/').filter(Boolean);
              parts.pop(); 
              const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';

              for (const obj of filesToDownload) {
                const relativePath = obj.key.substring(parentPrefix.length);
                const localPath = `${folderPath}/${relativePath}`;
                
                const jobId = await transferApi.queueDownload(bucketName, bucketRegion, obj.key, localPath, obj.size);
                addJob({
                  id: jobId,
                  transfer_type: 'Download',
                  bucket: bucketName,
                  bucket_region: bucketRegion,
                  key: obj.key,
                  local_path: localPath,
                  total_bytes: obj.size,
                  processed_bytes: 0,
                  status: 'Queued',
                  created_at: Date.now(),
                });
              }
              
              displaySuccess(`Queued ${filesToDownload.length} files for download`);
            } catch (err) {
              displayError('Failed to download folder', String(err));
            }
          }}>
            <ListItemIcon><FolderZipIcon fontSize="small" /></ListItemIcon>
            Download Folder
          </MenuItem>
        )}
        <MenuItem onClick={handlePropertiesOpen}>
           <ListItemIcon><InfoIcon fontSize="small" /></ListItemIcon>
           Properties
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject && bucketName) {
            const name = selectedObject.key.split('/').filter(Boolean).pop() || selectedObject.key;
            if (isFavorite(selectedObject.key)) {
              removeFavorite(selectedObject.key);
              displaySuccess('Removed from favorites');
            } else {
              addFavorite({
                key: selectedObject.key,
                name,
                bucket: bucketName,
                region: bucketRegion,
                isFolder: selectedObject.isFolder,
              });
              displaySuccess('Added to favorites');
            }
          }
          handleMenuClose();
        }}>
          <ListItemIcon>
            {selectedObject && isFavorite(selectedObject.key) 
              ? <StarIcon fontSize="small" color="warning" /> 
              : <StarBorderIcon fontSize="small" />}
          </ListItemIcon>
          {selectedObject && isFavorite(selectedObject.key) ? 'Remove from Favorites' : 'Add to Favorites'}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          if (selectedObject) {
            const filename = selectedObject.key.split('/').filter(Boolean).pop() || selectedObject.key;
            navigator.clipboard.writeText(filename);
            displaySuccess(`Copied filename: ${filename}`);
          }
          handleMenuClose();
        }}>
          <ListItemIcon><FilePresentIcon fontSize="small" /></ListItemIcon>
          Copy Filename
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject) {
            navigator.clipboard.writeText(selectedObject.key);
            displaySuccess(`Copied key: ${selectedObject.key}`);
          }
          handleMenuClose();
        }}>
          <ListItemIcon><FileCopyIcon fontSize="small" /></ListItemIcon>
          Copy Key
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject) {
            const s3Uri = `s3://${bucketName}/${selectedObject.key}`;
            navigator.clipboard.writeText(s3Uri);
            displaySuccess(`Copied S3 URI: ${s3Uri}`);
          }
          handleMenuClose();
        }}>
          <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
          Copy S3 URI
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRenamePrompt}>
          <ListItemIcon><RenameIcon fontSize="small" /></ListItemIcon>
          Rename
        </MenuItem>
        <MenuItem onClick={handleDeletePrompt} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onClose={() => setCreateFolderOpen(false)}>
        <DialogTitle>Create New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Folder Name"
            fullWidth
            variant="outlined"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateFolder} disabled={isCreatingFolder || !newFolderName.trim()}>
            {isCreatingFolder ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Rename Dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)}>
        <DialogTitle>Rename</DialogTitle>
        <DialogContent>
          <TextField
             autoFocus
             margin="dense"
             label="New Name"
             fullWidth
             variant="outlined"
             value={renameValue}
             onChange={(e) => setRenameValue(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button onClick={handleRename} disabled={!renameValue.trim()}>Rename</Button>
        </DialogActions>
      </Dialog>
      
      {/* Properties Dialog */}
      <PropertiesDialog 
        open={propertiesOpen} 
        onClose={() => setPropertiesOpen(false)} 
        bucketName={bucketName} 
        bucketRegion={bucketRegion}
        objectKey={selectedObjectProp || ''} 
      />

      {/* Preview/Edit Dialog */}
      <ObjectPreviewDialog
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewKey(null); }}
        bucketName={bucketName}
        bucketRegion={bucketRegion}
        objectKey={previewKey || ''}
        onSave={() => refresh()}
      />

      {/* Delete Confirmation Dialog */}
       <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Delete Confirmation</DialogTitle>
        <DialogContent>
          <Typography component="div">
            Are you sure you want to delete <strong>{selectedObject ? selectedObject.key.split('/').filter(Boolean).pop() : `${selectedKeys.size} items`}</strong>?
            {(selectedObject?.isFolder || (selectedKeys.size > 0)) && (
               <Box component="span" sx={{ display: 'block', mt: 1, color: 'warning.main', fontSize: '0.9em' }}>
                 Warning: This action cannot be undone.
               </Box>
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => {
             if (selectedObject) handleDelete();
             else handleBulkDelete();
          }} color="error" disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-animation { animation: spin 1s linear infinite; }
      `}</style>
    </Box>
  );
}

export default function BucketPage() {
  return (
    <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>}>
      <BucketContent />
    </Suspense>
  );
}
