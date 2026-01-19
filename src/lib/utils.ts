// Utility functions shared across the application

/**
 * Format bytes into human-readable size string
 * @param bytes - Number of bytes
 * @returns Formatted string like "1.5 MB"
 */
export const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

/**
 * Get file extension from filename
 * @param name - Filename or path
 * @returns Lowercase extension without dot, or empty string
 */
export const getFileExtension = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

/**
 * Format date for display
 * @param dateString - ISO date string or null
 * @returns Formatted date string or placeholder
 */
export const formatDate = (dateString: string | null): string => {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString();
};
