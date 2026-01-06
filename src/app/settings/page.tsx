'use client';

import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemSecondaryAction, 
  Select, 
  MenuItem, 
  TextField, 
  Slider, 
  Container 
} from '@mui/material';
import { useSettingsStore } from '@/store/settingsStore';

export default function SettingsPage() {
  const { 
    theme, setTheme, 
    defaultRegion, setDefaultRegion, 
    maxConcurrentTransfers, setMaxConcurrentTransfers 
  } = useSettingsStore();

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        Settings
      </Typography>

      {/* Appearance Section */}
      <Paper variant="outlined" sx={{ mb: 4 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Appearance</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Theme" 
              secondary="Choose your preferred interface appearance" 
            />
            <ListItemSecondaryAction>
              <Select
                size="small"
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="light">Light</MenuItem>
                <MenuItem value="dark">Dark</MenuItem>
                <MenuItem value="system">System</MenuItem>
              </Select>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Defaults Section */}
      <Paper variant="outlined" sx={{ mb: 4 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Defaults</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Default Region" 
              secondary="Region used when creating buckets or defaulting connections" 
            />
            <ListItemSecondaryAction>
              <TextField 
                size="small" 
                variant="outlined" 
                value={defaultRegion} 
                onChange={(e) => setDefaultRegion(e.target.value)}
                sx={{ width: 150 }}
              />
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Performance Section */}
      <Paper variant="outlined">
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Performance</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="Max Concurrent Transfers" 
              secondary={`Allow up to ${maxConcurrentTransfers} simultaneous uploads/downloads`} 
            />
            <Box sx={{ width: 200, mr: 2 }}>
               <Slider
                 value={maxConcurrentTransfers}
                 min={1}
                 max={20}
                 step={1}
                 valueLabelDisplay="auto"
                 onChange={(_, val) => setMaxConcurrentTransfers(val as number)}
               />
            </Box>
          </ListItem>
        </List>
      </Paper>
    </Container>
  );
}
