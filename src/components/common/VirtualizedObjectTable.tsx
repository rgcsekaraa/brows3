'use client';

import { memo, useMemo, useCallback } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Checkbox,
  IconButton,
  Typography,
  Skeleton,
  Tooltip,
  Stack,
  Divider,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Folder as FolderIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
  AudioFile as AudioIcon,
  PictureAsPdf as PdfIcon,
  Code as CodeIcon,
  DataObject as JsonIcon,
  TextSnippet as TextIcon,
  InsertDriveFile as FileIcon,
  Archive as ArchiveIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Visibility as PreviewIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import { S3Object } from '@/lib/tauri';

// Format bytes - memoized outside component
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Get extension - simple and fast
const getExt = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

// File icon lookup - cached for performance
const ICON_STYLES = { fontSize: 18 };
const ICON_MAP: Record<string, React.ReactNode> = {
  // Images
  jpg: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  jpeg: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  png: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  gif: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  webp: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  svg: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  ico: <ImageIcon sx={{ color: '#4CAF50', ...ICON_STYLES }} />,
  // Videos
  mp4: <VideoIcon sx={{ color: '#9C27B0', ...ICON_STYLES }} />,
  webm: <VideoIcon sx={{ color: '#9C27B0', ...ICON_STYLES }} />,
  mov: <VideoIcon sx={{ color: '#9C27B0', ...ICON_STYLES }} />,
  avi: <VideoIcon sx={{ color: '#9C27B0', ...ICON_STYLES }} />,
  mkv: <VideoIcon sx={{ color: '#9C27B0', ...ICON_STYLES }} />,
  // Audio
  mp3: <AudioIcon sx={{ color: '#FF5722', ...ICON_STYLES }} />,
  wav: <AudioIcon sx={{ color: '#FF5722', ...ICON_STYLES }} />,
  ogg: <AudioIcon sx={{ color: '#FF5722', ...ICON_STYLES }} />,
  flac: <AudioIcon sx={{ color: '#FF5722', ...ICON_STYLES }} />,
  aac: <AudioIcon sx={{ color: '#FF5722', ...ICON_STYLES }} />,
  // Documents
  pdf: <PdfIcon sx={{ color: '#F44336', ...ICON_STYLES }} />,
  json: <JsonIcon sx={{ color: '#FFC107', ...ICON_STYLES }} />,
  // Code
  js: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  ts: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  jsx: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  tsx: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  py: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  go: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  rs: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  java: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  cpp: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  c: <CodeIcon sx={{ color: '#2196F3', ...ICON_STYLES }} />,
  // Text
  txt: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  md: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  log: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  csv: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  xml: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  html: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  css: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  yaml: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  yml: <TextIcon sx={{ color: '#607D8B', ...ICON_STYLES }} />,
  // Archive
  zip: <ArchiveIcon sx={{ color: '#795548', ...ICON_STYLES }} />,
  tar: <ArchiveIcon sx={{ color: '#795548', ...ICON_STYLES }} />,
  gz: <ArchiveIcon sx={{ color: '#795548', ...ICON_STYLES }} />,
  rar: <ArchiveIcon sx={{ color: '#795548', ...ICON_STYLES }} />,
  '7z': <ArchiveIcon sx={{ color: '#795548', ...ICON_STYLES }} />,
};

const FOLDER_ICON = <FolderIcon sx={{ color: '#FFB74D', fontSize: 20 }} />;
const DEFAULT_FILE_ICON = <FileIcon sx={{ color: '#9E9E9E', ...ICON_STYLES }} />;

const getIcon = (name: string, isFolder: boolean): React.ReactNode => {
  if (isFolder) return FOLDER_ICON;
  const ext = getExt(name);
  return ICON_MAP[ext] || DEFAULT_FILE_ICON;
};

// Previewable extensions
const PREVIEW_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'log', 'csv', 'yaml', 'yml', 'pdf']);
const EDIT_EXTS = new Set(['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'yaml', 'yml', 'log', 'csv']);

// Row data type
interface RowData {
  key: string;
  name: string;
  isFolder: boolean;
  size: number;
  modified: string;
}

interface Props {
  folders: string[];
  objects: S3Object[];
  selectedKeys: Set<string>;
  sortField: 'name' | 'size' | 'date' | 'class';
  sortDirection: 'asc' | 'desc';
  isLoading: boolean;
  onNavigate: (prefix: string) => void;
  onSelect: (key: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>, key: string, isFolder: boolean) => void;
  onSortChange: (field: 'name' | 'size' | 'date' | 'class') => void;
  onDownload?: (key: string) => void;
  onDelete?: (key: string) => void;
  onPreview?: (key: string) => void;
  onEdit?: (key: string) => void;
  onCopyPath?: (key: string) => void;
  onEndReached?: () => void;
}

// Lightweight table components - no Paper wrapper, minimal styling
const VirtuosoComponents: TableComponents<RowData> = {
  Scroller: memo(({ style, ...props }: any) => (
    <Box 
      {...props} 
      style={style}
      sx={{ 
        '&::-webkit-scrollbar': { width: 6, height: 6 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'grey.600', borderRadius: 3 },
      }} 
    />
  )),
  Table: memo((props: any) => (
    <Table {...props} size="small" sx={{ tableLayout: 'fixed', minWidth: '100%' }} />
  )),
  TableHead: memo((props: any) => <TableHead {...props} />),
  TableRow: memo(({ item, ...props }: any) => <TableRow hover {...props} />),
  TableBody: memo((props: any) => <TableBody {...props} />),
};

// Memoized row component for maximum performance
const RowContent = memo(function RowContent({
  row,
  isSelected,
  onSelect,
  onNavigate,
  onDownload,
  onDelete,
  onPreview,
  onEdit,
  onCopyPath,
  onMenuOpen,
}: {
  row: RowData;
  isSelected: boolean;
  onSelect: (key: string, checked: boolean) => void;
  onNavigate: (prefix: string) => void;
  onDownload?: (key: string) => void;
  onDelete?: (key: string) => void;
  onPreview?: (key: string) => void;
  onEdit?: (key: string) => void;
  onCopyPath?: (key: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>, key: string, isFolder: boolean) => void;
}) {
  const ext = getExt(row.name);
  const canPreview = !row.isFolder && PREVIEW_EXTS.has(ext);
  const canEdit = !row.isFolder && EDIT_EXTS.has(ext);

  return (
    <>
      <TableCell padding="checkbox" sx={{ width: 40, py: 0 }}>
        <Checkbox
          checked={isSelected}
          onChange={(e) => onSelect(row.key, e.target.checked)}
          size="small"
          sx={{ p: 0.5 }}
        />
      </TableCell>
      <TableCell sx={{ width: 32, py: 0.5 }}>
        {getIcon(row.name, row.isFolder)}
      </TableCell>
      <TableCell 
        sx={{ 
          py: 0.5,
          cursor: row.isFolder ? 'pointer' : 'default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        onClick={row.isFolder ? () => onNavigate(row.key) : undefined}
      >
        <Typography 
          variant="body2" 
          component="span"
          sx={{ fontWeight: row.isFolder ? 600 : 400 }}
        >
          {row.name}{row.isFolder ? '/' : ''}
        </Typography>
        {ext && !row.isFolder && (
          <Typography 
            component="span" 
            sx={{ 
              ml: 1, 
              px: 0.5, 
              py: 0.1,
              fontSize: '0.65rem', 
              bgcolor: 'action.hover', 
              borderRadius: 0.5,
              fontWeight: 600,
            }}
          >
            {ext.toUpperCase()}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ width: 80, py: 0.5, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
        {row.isFolder ? '—' : formatSize(row.size)}
      </TableCell>
      <TableCell align="right" sx={{ width: 100, py: 0.5, fontSize: '0.75rem', color: 'text.secondary' }}>
        {row.modified || '—'}
      </TableCell>
      <TableCell sx={{ width: 80, py: 0.25 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', opacity: 0.7, '&:hover': { opacity: 1 } }}>
          {row.isFolder ? (
            <IconButton size="small" onClick={() => onNavigate(row.key)} sx={{ p: 0.5 }}>
              <OpenIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : (
            <>
              {canPreview && onPreview && (
                <IconButton size="small" onClick={() => onPreview(row.key)} sx={{ p: 0.5 }} title="Preview">
                  <PreviewIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </>
          )}
          <IconButton size="small" onClick={(e) => onMenuOpen(e, row.key, row.isFolder)} sx={{ p: 0.5 }}>
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </TableCell>
    </>
  );
});

export const VirtualizedObjectTable = memo(function VirtualizedObjectTable({
  folders,
  objects,
  selectedKeys,
  sortField,
  sortDirection,
  isLoading,
  onNavigate,
  onSelect,
  onSelectAll,
  onMenuOpen,
  onSortChange,
  onDownload,
  onDelete,
  onPreview,
  onEdit,
  onCopyPath,
  onEndReached,
}: Props) {
  // Build rows - highly optimized
  const rows = useMemo<RowData[]>(() => {
    const result: RowData[] = [];
    
    // Add folders
    for (const prefix of folders) {
      const parts = prefix.split('/').filter(Boolean);
      result.push({
        key: prefix,
        name: parts[parts.length - 1] || prefix,
        isFolder: true,
        size: 0,
        modified: '',
      });
    }
    
    // Add files
    for (const obj of objects) {
      const parts = obj.key.split('/');
      result.push({
        key: obj.key,
        name: parts[parts.length - 1] || obj.key,
        isFolder: false,
        size: obj.size,
        modified: obj.last_modified ? new Date(obj.last_modified).toLocaleDateString() : '',
      });
    }
    
    // Sort - folders first, then by field
    result.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'size') cmp = a.size - b.size;
      else if (sortField === 'date') cmp = a.modified.localeCompare(b.modified);
      
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    
    return result;
  }, [folders, objects, sortField, sortDirection]);

  const allSelected = rows.length > 0 && selectedKeys.size === rows.length;
  const someSelected = selectedKeys.size > 0 && selectedKeys.size < rows.length;

  // Fixed header
  const headerContent = useCallback(() => (
    <TableRow sx={{ bgcolor: 'background.default' }}>
      <TableCell padding="checkbox" sx={{ width: 40, bgcolor: 'background.default' }}>
        <Checkbox
          indeterminate={someSelected}
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          size="small"
          sx={{ p: 0.5 }}
        />
      </TableCell>
      <TableCell sx={{ width: 32, bgcolor: 'background.default' }} />
      <TableCell 
        sx={{ bgcolor: 'background.default', cursor: 'pointer', fontWeight: 600 }}
        onClick={() => onSortChange('name')}
      >
        Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
      </TableCell>
      <TableCell 
        align="right"
        sx={{ width: 80, bgcolor: 'background.default', cursor: 'pointer', fontWeight: 600 }}
        onClick={() => onSortChange('size')}
      >
        Size {sortField === 'size' && (sortDirection === 'asc' ? '↑' : '↓')}
      </TableCell>
      <TableCell 
        align="right"
        sx={{ width: 140, bgcolor: 'background.default', cursor: 'pointer', fontWeight: 600 }}
        onClick={() => onSortChange('date')}
      >
        Modified {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
      </TableCell>
      <TableCell sx={{ width: 80, bgcolor: 'background.default', textAlign: 'right' }}>Actions</TableCell>
    </TableRow>
  ), [allSelected, someSelected, sortField, sortDirection, onSelectAll, onSortChange]);

  // Row renderer - returns memoized component
  const rowContent = useCallback((_index: number, row: RowData) => (
    <RowContent
      row={row}
      isSelected={selectedKeys.has(row.key)}
      onSelect={onSelect}
      onNavigate={onNavigate}
      onDownload={onDownload}
      onDelete={onDelete}
      onPreview={onPreview}
      onEdit={onEdit}
      onCopyPath={onCopyPath}
      onMenuOpen={onMenuOpen}
    />
  ), [selectedKeys, onSelect, onNavigate, onDownload, onDelete, onPreview, onEdit, onCopyPath, onMenuOpen]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      {/* Table Body Area */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {isLoading ? (
          <Table size="small">
            <TableHead>{headerContent()}</TableHead>
            <TableBody>
              {Array.from({ length: 15 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell padding="checkbox"><Skeleton width={18} height={18} /></TableCell>
                  <TableCell><Skeleton variant="circular" width={18} height={18} /></TableCell>
                  <TableCell><Skeleton width="60%" /></TableCell>
                  <TableCell><Skeleton width={40} /></TableCell>
                  <TableCell><Skeleton width={60} /></TableCell>
                  <TableCell><Skeleton width={80} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : rows.length === 0 ? (
          <Table size="small">
            <TableHead>{headerContent()}</TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">Empty folder</Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <TableVirtuoso
            data={rows}
            components={VirtuosoComponents}
            fixedHeaderContent={headerContent}
            itemContent={rowContent}
            style={{ height: '100%' }}
            overscan={50}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            endReached={onEndReached}
          />
        )}
      </Box>

      {/* Persistent Footer */}
      <Box sx={{ 
        px: 2, 
        py: 0.75, 
        borderTop: 1, 
        borderColor: 'divider', 
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 32
      }}>
        <Stack direction="row" spacing={3} alignItems="center">
          <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" fontWeight={700} color="text.primary">{rows.length.toLocaleString()}</Box>
            <Box component="span" color="text.secondary">items visible</Box>
          </Typography>

          <Divider orientation="vertical" flexItem sx={{ height: 12, my: 'auto' }} />

          <Stack direction="row" spacing={1.5}>
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" fontWeight={600} color="text.secondary">{folders.length.toLocaleString()}</Box>
              <Box component="span" color="text.secondary">folders</Box>
            </Typography>
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" fontWeight={600} color="text.secondary">{objects.length.toLocaleString()}</Box>
              <Box component="span" color="text.secondary">files</Box>
            </Typography>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          {selectedKeys.size > 0 && (
            <Chip 
              label={`${selectedKeys.size} selected`} 
              size="small" 
              color="primary" 
              sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, borderRadius: 0.5 }}
            />
          )}
          {onEndReached && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
              Scroll for more
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
});
