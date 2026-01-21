'use client';

import { memo, useMemo, useCallback, useRef, useState, useEffect } from 'react';
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
  Stack,
  Divider,
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
  Visibility as PreviewIcon,
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import { S3Object } from '@/lib/tauri';
import { formatSize } from '@/lib/utils';

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
const PREVIEW_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 
  'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 
  'pdf',
  'txt', 'md', 'markdown', 'json', 'xml', 'html', 'css', 'scss', 'less', 'sass', 
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 
  'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'groovy', 'pl', 'sh', 'bash', 'zsh', 'fish', 
  'bat', 'cmd', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 
  'gradle', 'sql', 'prisma', 'graphql', 'gql', 'log', 'csv', 'tsv', 'lock', 'gitignore', 
  'dockerfile', 'makefile', 'cmake', 'tf', 'hcl', 'lua', 'dart', 'r', 'ex', 'exs'
]);

const EDIT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'xml', 'html', 'css', 'scss', 'less', 'sass', 
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 
  'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'groovy', 'pl', 'sh', 'bash', 'zsh', 'fish', 
  'bat', 'cmd', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 
  'gradle', 'sql', 'prisma', 'graphql', 'gql', 'log', 'csv', 'tsv', 'lock', 'gitignore', 
  'dockerfile', 'makefile', 'cmake', 'tf', 'hcl', 'lua', 'dart', 'r', 'ex', 'exs'
]);

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
  onPreview?: (key: string, size: number) => void;
  onEdit?: (key: string) => void;
  onCopyPath?: (key: string) => void;
  onEndReached?: () => void;
}

// Lightweight table components with explicit backgrounds for WebKit
const VirtuosoComponents: TableComponents<RowData> = {
  Scroller: memo(({ style, ...props }: any) => (
    <Box 
      {...props} 
      style={style}
      sx={{ 
        bgcolor: 'background.paper',
        '&::-webkit-scrollbar': { width: 6, height: 6 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'grey.600', borderRadius: 3 },
        willChange: 'transform',
      }} 
    />
  )),
  Table: memo((props: any) => (
    <Table {...props} size="small" sx={{ tableLayout: 'fixed', minWidth: '100%', bgcolor: 'background.paper' }} />
  )),
  TableHead: memo((props: any) => <TableHead {...props} sx={{ bgcolor: 'background.default' }} />),
  TableRow: memo(({ item, ...props }: any) => <TableRow hover {...props} sx={{ bgcolor: 'background.paper' }} />),
  TableBody: memo((props: any) => <TableBody {...props} sx={{ bgcolor: 'background.paper' }} />),
};

// Memoized row component for performance - prevents flickering on Ubuntu/WebKitGTK
const RowContent = memo(function RowContent({
  row,
  rowIndex,
  isSelected,
  onSelect,
  onNavigate,
  onPreview,
  onEdit,
  onMenuOpen,
}: {
  row: RowData;
  rowIndex: number;
  isSelected: boolean;
  onSelect: (key: string, checked: boolean) => void;
  onNavigate: (prefix: string) => void;
  onPreview?: (key: string, size: number) => void;
  onEdit?: (key: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>, key: string, isFolder: boolean) => void;
}) {
  const ext = getExt(row.name);
  const canPreview = !row.isFolder && PREVIEW_EXTS.has(ext);
  const canEdit = !row.isFolder && EDIT_EXTS.has(ext);

  // Debounce checkbox to prevent rapid clicking
  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect(row.key, e.target.checked);
  }, [onSelect, row.key]);

  return (
    <>
      {/* Row number column */}
      <TableCell sx={{ width: 40, py: 0.5, textAlign: 'center', color: 'text.secondary', fontSize: '0.75rem', fontFamily: 'monospace', bgcolor: 'background.paper' }}>
        {rowIndex + 1}
      </TableCell>
      <TableCell padding="checkbox" sx={{ width: 40, py: 0, bgcolor: 'background.paper' }}>
        <Checkbox
          checked={isSelected}
          onChange={handleCheckboxChange}
          size="small"
          disableRipple
          sx={{ 
            p: 0.5,
            // Disable animations that can crash WebKitGTK
            transition: 'none',
            '& .MuiSvgIcon-root': {
              transition: 'none',
            }
          }}
        />
      </TableCell>
      <TableCell sx={{ width: 32, py: 0.5, bgcolor: 'background.paper' }}>
        {getIcon(row.name, row.isFolder)}
      </TableCell>
      <TableCell 
        sx={{ 
          py: 0.5,
          cursor: row.isFolder ? 'pointer' : 'default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          bgcolor: 'background.paper',
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
      <TableCell align="right" sx={{ width: 80, py: 0.5, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
        {row.isFolder ? '—' : formatSize(row.size)}
      </TableCell>
      <TableCell align="right" sx={{ width: 100, py: 0.5, fontSize: '0.75rem', color: 'text.secondary', bgcolor: 'background.paper' }}>
        {row.modified || '—'}
      </TableCell>
      <TableCell sx={{ width: 80, py: 0.25, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', opacity: 0.7, '&:hover': { opacity: 1 } }}>
          {row.isFolder ? (
            <IconButton size="small" onClick={() => onNavigate(row.key)} sx={{ p: 0.5 }}>
              <OpenIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : (
            <>
              {canPreview && onPreview && (
                <IconButton size="small" onClick={() => onPreview(row.key, row.size)} sx={{ p: 0.5 }} title="Preview">
                  <PreviewIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
              {canEdit && onEdit && (
                <IconButton size="small" onClick={() => onEdit(row.key)} sx={{ p: 0.5 }} title="Edit">
                  <EditIcon sx={{ fontSize: 16 }} />
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
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props changed
  return prevProps.isSelected === nextProps.isSelected &&
         prevProps.row.key === nextProps.row.key &&
         prevProps.rowIndex === nextProps.rowIndex &&
         prevProps.row.size === nextProps.row.size &&
         prevProps.row.modified === nextProps.row.modified;
});

export const VirtualizedObjectTable = memo(function VirtualizedObjectTable({
  folders = [],
  objects = [],
  selectedKeys,
  sortField,
  sortDirection,
  isLoading,
  onNavigate,
  onSelect,
  onSelectAll,
  onMenuOpen,
  onSortChange,
  onPreview,
  onEdit,
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

  // Memoize selection state for header
  const allSelected = rows.length > 0 && selectedKeys.size === rows.length;
  const someSelected = selectedKeys.size > 0 && selectedKeys.size < rows.length;

  // Stable callback refs to avoid recreating
  const onSelectRef = useRef(onSelect);
  const onNavigateRef = useRef(onNavigate);
  const onPreviewRef = useRef(onPreview);
  const onEditRef = useRef(onEdit);
  const onMenuOpenRef = useRef(onMenuOpen);
  
  // Use ref for selectedKeys to avoid callback recreation on selection change
  // This prevents flickering on Ubuntu/WebKitGTK
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  
  // Update refs on each render
  useEffect(() => {
    onSelectRef.current = onSelect;
    onNavigateRef.current = onNavigate;
    onPreviewRef.current = onPreview;
    onEditRef.current = onEdit;
    onMenuOpenRef.current = onMenuOpen;
  });

  // Fixed header - memoized
  const headerContent = useCallback(() => (
    <TableRow sx={{ bgcolor: 'background.default' }}>
      <TableCell sx={{ width: 40, bgcolor: 'background.default', textAlign: 'center', fontWeight: 600, fontSize: '0.75rem' }}>#</TableCell>
      <TableCell padding="checkbox" sx={{ width: 40, bgcolor: 'background.default' }}>
        <Checkbox
          indeterminate={someSelected}
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          size="small"
          disableRipple
          sx={{ 
            p: 0.5,
            transition: 'none',
            '& .MuiSvgIcon-root': { transition: 'none' }
          }}
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

  // Optimize Context for Virtuoso
  // We pass changing values via context so rowContent callback can remain stable
  const context = useMemo(() => ({
      selectedKeys,
      onSelect: onSelectRef.current,
      onNavigate: onNavigateRef.current,
      onPreview: onPreviewRef.current,
      onEdit: onEditRef.current,
      onMenuOpen: onMenuOpenRef.current
  }), [selectedKeys]); // Only recreates when selection changes

  // Row renderer - COMPLETELY STABLE (no deps)
  // This is the key fix for Ubuntu crashes: Virtuoso sees the same function reference
  // and efficiently propagates context changes only to rows that need it.
  const rowContent = useCallback((index: number, row: RowData, context: any) => (
    <RowContent
      key={row.key}
      row={row}
      rowIndex={index}
      isSelected={context.selectedKeys.has(row.key)}
      onSelect={context.onSelect}
      onNavigate={context.onNavigate}
      onPreview={context.onPreview}
      onEdit={context.onEdit}
      onMenuOpen={context.onMenuOpen}
    />
  ), []);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      {/* Table Body Area */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {isLoading ? (
          <Table size="small" sx={{ tableLayout: 'fixed', minWidth: '100%' }}>
            <TableHead>{headerContent()}</TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <CircularProgress size={32} />
                    <Typography variant="caption" color="text.secondary">Loading...</Typography>
                  </Box>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : rows.length === 0 ? (
          <Table size="small">
            <TableHead>{headerContent()}</TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">Empty folder</Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <TableVirtuoso
            data={rows}
            context={context}
            components={VirtuosoComponents}
            fixedHeaderContent={headerContent}
            itemContent={rowContent}
            style={{ height: '100%' }}
            overscan={20}
            increaseViewportBy={{ top: 100, bottom: 100 }}
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
