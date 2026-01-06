'use client';

import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Paper,
  Tooltip,
  Button,
} from '@mui/material';
import {
  History as HistoryIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { useHistoryStore, RecentItem } from '@/store/historyStore';
import { useAppStore } from '@/store/appStore';

export default function RecentPage() {
  const router = useRouter();
  const { recentItems, clearRecent } = useHistoryStore();
  const { addTab } = useAppStore();

  const handleItemClick = (item: RecentItem) => {
    if (item.isFolder) {
      const path = `/bucket?name=${item.bucket}&region=${item.region}&prefix=${encodeURIComponent(item.key)}`;
      addTab({ title: item.name, path, icon: 'folder' });
      router.push(path);
    } else {
      // Navigate to parent folder with the file selected
      const parentPrefix = item.key.split('/').slice(0, -1).join('/');
      const path = `/bucket?name=${item.bucket}&region=${item.region}${parentPrefix ? `&prefix=${encodeURIComponent(parentPrefix + '/')}` : ''}`;
      addTab({ title: item.bucket, path, icon: 'bucket' });
      router.push(path);
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <Box sx={{ p: 3, maxWidth: 800 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <HistoryIcon color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Recent
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Recently accessed files and folders
            </Typography>
          </Box>
        </Box>
        {recentItems.length > 0 && (
          <Button 
            variant="outlined" 
            color="error" 
            size="small"
            startIcon={<DeleteIcon />}
            onClick={clearRecent}
          >
            Clear All
          </Button>
        )}
      </Box>

      {recentItems.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <HistoryIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No recent items
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Files and folders you access will appear here
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List dense>
            {recentItems.map((item, index) => (
              <ListItem
                key={`${item.bucket}-${item.key}-${index}`}
                disablePadding
                secondaryAction={
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                    {formatTime(item.accessedAt)}
                  </Typography>
                }
              >
                <ListItemButton onClick={() => handleItemClick(item)}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {item.isFolder ? (
                      <FolderIcon sx={{ color: '#FFB74D' }} />
                    ) : (
                      <FileIcon color="action" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.name}
                    secondary={`${item.bucket} / ${item.key}`}
                    primaryTypographyProps={{ fontWeight: 500 }}
                    secondaryTypographyProps={{ 
                      noWrap: true, 
                      sx: { maxWidth: 400 },
                      title: `${item.bucket}/${item.key}`,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
