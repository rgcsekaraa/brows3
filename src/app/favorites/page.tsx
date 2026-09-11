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
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Folder as FolderIcon,
  Storage as BucketIcon,
  InsertDriveFile as FileIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useHistoryStore, FavoriteItem } from '@/store/historyStore';
import { useAppStore } from '@/store/appStore';
import { useProfileStore } from '@/store/profileStore';

export default function FavoritesPage() {
  const router = useRouter();
  const { favorites, removeFavorite, clearFavorites } = useHistoryStore();
  const { addTab, discoveredRegions } = useAppStore();
  const { activeProfileId, profiles } = useProfileStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  const visibleFavorites = favorites.filter((item) => item.profileId === activeProfileId);

  const buildBucketPath = (item: FavoriteItem, prefix?: string) => {
    const params = new URLSearchParams();
    params.set('name', item.bucket);
    const region = item.region || discoveredRegions[item.bucket] || activeProfile?.region;
    if (region) params.set('region', region);
    if (prefix) params.set('prefix', prefix);
    return `/bucket?${params.toString()}`;
  };

  const handleItemClick = (item: FavoriteItem) => {
    if (item.isFolder) {
      const path = buildBucketPath(item, item.key);
      addTab({ title: item.name, path, icon: item.key ? 'folder' : 'bucket' });
      router.push(path);
    } else {
      // Navigate to parent folder
      const parentPrefix = item.key.split('/').slice(0, -1).join('/');
      const path = buildBucketPath(item, parentPrefix ? `${parentPrefix}/` : undefined);
      addTab({ title: item.bucket, path, icon: 'bucket' });
      router.push(path);
    }
  };

  return (
    <Box sx={{ p: 1, mt: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StarIcon color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Favorites
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your starred buckets, files and folders
            </Typography>
          </Box>
        </Box>
        {visibleFavorites.length > 0 && (
          <Button 
            variant="outlined" 
            color="error" 
            size="small"
            startIcon={<DeleteIcon />}
            onClick={() => clearFavorites(activeProfileId || undefined)}
          >
            Clear All
          </Button>
        )}
      </Box>

      {visibleFavorites.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <StarBorderIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No favorites yet
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Star buckets, files and folders to add them here
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <List dense sx={{ flex: 1, overflow: 'auto' }}>
            {visibleFavorites.map((item, index) => (
              <ListItem
                key={`${item.bucket}-${item.key}-${index}`}
                disablePadding
                secondaryAction={
                  <Tooltip title="Remove from favorites">
                    <IconButton 
                      size="small"
                      aria-label={`Remove ${item.name} from favorites`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFavorite(item.key, item.bucket, activeProfileId || undefined);
                      }}
                    >
                      <StarIcon color="warning" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton onClick={() => handleItemClick(item)}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {item.isFolder && !item.key ? (
                      <BucketIcon color="primary" />
                    ) : item.isFolder ? (
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
