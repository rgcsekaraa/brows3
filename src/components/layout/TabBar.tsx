'use client';

import { Box, Tabs, Tab, IconButton, Typography, Tooltip } from '@mui/material';
import { 
    Close as CloseIcon, 
    Add as AddIcon,
    Cloud as BucketIcon,
    Storage as ObjectIcon,
    Home as HomeIcon,
    Star as StarIcon,
    History as RecentIcon,
    FileUpload as UploadIcon,
    FileDownload as DownloadIcon
} from '@mui/icons-material';
import { useAppStore, Tab as TabType } from '@/store/appStore';
import { useProfileStore } from '@/store/profileStore';
import { useRouter } from 'next/navigation';

const TAB_WIDTH = 140; // Fixed width for all tabs

export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useAppStore();
  const { activeProfileId } = useProfileStore();
  const router = useRouter();

  // Don't show tabs during setup (no profile)
  const hasProfile = !!activeProfileId;
  
  // Hide entire TabBar when no profile exists
  if (!hasProfile) {
    return null;
  }

  const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
    const tab = tabs.find(t => t.id === newValue);
    if (tab) {
        router.push(tab.path);
    }
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    // If we are closing the active tab, we need to navigate to the new one
    if (id === activeTabId) {
        const filteredTabs = tabs.filter(t => t.id !== id);
        if (filteredTabs.length > 0) {
            const nextTab = filteredTabs[filteredTabs.length - 1];
            router.push(nextTab.path);
        }
    }
    
    removeTab(id);
  };

  const handleAddTab = () => {
    if (!hasProfile) return;
    addTab({ title: 'Explorer', path: '/', icon: 'cloud' });
    router.push('/');
  };

  const getIcon = (iconName?: string) => {
    switch (iconName) {
        case 'home': return <HomeIcon sx={{ fontSize: 16 }} />;
        case 'star': return <StarIcon sx={{ fontSize: 16 }} />;
        case 'recent': return <RecentIcon sx={{ fontSize: 16 }} />;
        case 'upload': return <UploadIcon sx={{ fontSize: 16 }} />;
        case 'download': return <DownloadIcon sx={{ fontSize: 16 }} />;
        default: return <BucketIcon sx={{ fontSize: 16 }} />;
    }
  };

  return (
    <Box sx={{ 
      display: 'flex', 
      alignItems: 'center', 
      bgcolor: 'background.paper', 
      borderBottom: '1px solid',
      borderColor: 'divider',
      width: '100%',
      overflow: 'hidden'
    }}>
      <Tabs
        value={activeTabId || false}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 36,
          '& .MuiTabs-indicator': {
            height: 2,
            bottom: 0,
          },
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            component="div"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                {getIcon(tab.icon)}
                <Typography 
                  variant="caption" 
                  sx={{ 
                    fontWeight: 500, 
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }} 
                >
                  {tab.title}
                </Typography>
                {tabs.length > 1 && (
                  <IconButton
                    size="small"
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    sx={{ p: 0.2, '&:hover': { color: 'error.main' } }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
            }
            sx={{
              minHeight: 36,
              textTransform: 'none',
              width: TAB_WIDTH,
              minWidth: TAB_WIDTH,
              maxWidth: TAB_WIDTH,
              px: 1.5,
              borderRight: '1px solid',
              borderColor: 'divider',
              opacity: activeTabId === tab.id ? 1 : 0.7,
              '&:hover': { opacity: 1 },
            }}
          />
        ))}
      </Tabs>
      
      {/* Only show New Tab button when profile exists */}
      {hasProfile && (
        <Tooltip title="New Tab">
          <IconButton size="small" onClick={handleAddTab} sx={{ ml: 1, p: 0.5 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

