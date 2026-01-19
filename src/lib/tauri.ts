import { useMonitorStore } from '@/store/monitorStore';

// Check if running in Tauri environment
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Dynamically get Tauri invoke - only import when actually in Tauri context
const getTauriInvoke = async () => {
  if (!isTauri()) {
    throw new Error('Not running in Tauri environment. This feature requires the desktop application.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
};

// Monitored invoke wrapper
const invoke = async <T>(cmd: string, args?: any): Promise<T> => {
  const store = useMonitorStore.getState();
  store.incrementRequests();
  
  try {
    const tauriInvoke = await getTauriInvoke();
    const result = await tauriInvoke<T>(cmd, args);
    store.addLog('success', cmd);
    return result;
  } catch (err) {
    store.incrementFailures();
    
    let errorMessage = String(err);
    if (err instanceof Error) {
      errorMessage = err.message;
    } else if (err && typeof err === 'object') {
      // Handle serialization of backend errors
      try {
        errorMessage = JSON.stringify(err);
      } catch {
        // Fallback if circular or not serializable
        errorMessage = String(err);
      }
    }

    store.addLog('error', cmd, errorMessage);
    throw err;
  }
};

// Cache invalidation helper - will be imported in hook, defined here for API layer
let cacheInvalidator: (() => void) | null = null;
export const setCacheInvalidator = (fn: () => void) => { cacheInvalidator = fn; };
const invalidateCache = () => { if (cacheInvalidator) cacheInvalidator(); };

// Profile types matching Rust backend
export type CredentialType = 
  | { type: 'Environment' }
  | { type: 'SharedConfig'; profile_name?: string }
  | { type: 'Manual'; access_key_id: string; secret_access_key: string }
  | { type: 'CustomEndpoint'; endpoint_url: string; access_key_id: string; secret_access_key: string };

export interface Profile {
  id: string;
  name: string;
  credential_type: CredentialType;
  region?: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  region?: string;
  bucket_count?: number;
}

// Tauri API wrapper functions
export const profileApi = {
  async listProfiles(): Promise<Profile[]> {
    return invoke<Profile[]>('list_profiles');
  },

  async getProfile(id: string): Promise<Profile> {
    return invoke<Profile>('get_profile', { id });
  },

  async addProfile(profile: Partial<Profile>): Promise<Profile> {
    return invoke<Profile>('add_profile', { profile });
  },

  async updateProfile(id: string, profile: Partial<Profile>): Promise<Profile> {
    return invoke<Profile>('update_profile', { id, profile });
  },

  async deleteProfile(id: string): Promise<void> {
    return invoke<void>('delete_profile', { id });
  },

  async setActiveProfile(id: string): Promise<void> {
    return invoke<void>('set_active_profile', { id });
  },

  async getActiveProfile(): Promise<Profile | null> {
    return invoke<Profile | null>('get_active_profile');
  },

  async testConnection(profile: Partial<Profile>): Promise<TestConnectionResult> {
    return invoke<TestConnectionResult>('test_connection', { profile });
  },
  
  async discoverLocalProfiles(): Promise<{ name: string; region?: string }[]> {
    return invoke<{ name: string; region?: string }[]>('discover_local_profiles');
  },

  async checkAwsEnvironment(): Promise<{ has_access_key: boolean; has_secret_key: boolean; has_session_token: boolean; region?: string }> {
    return invoke('check_aws_environment');
  },
};



// Bucket types matching Rust backend
export interface BucketInfo {
  name: string;
  region: string | null;
  creation_date: string | null;
  object_count: number | null;
  total_size: number | null;
  total_size_formatted: string | null;
}

export interface BucketWithRegion {
  name: string;
  region: string;
  creation_date: string | null;
  object_count: number | null;
  total_size: number | null;
  total_size_formatted: string | null;
}

// Bucket API wrapper functions
export const bucketApi = {
  async listBuckets(): Promise<BucketInfo[]> {
    return invoke<BucketInfo[]>('list_buckets');
  },

  async listBucketsWithRegions(): Promise<BucketWithRegion[]> {
    return invoke<BucketWithRegion[]>('list_buckets_with_regions');
  },

  async getBucketRegion(bucketName: string): Promise<string> {
    return invoke<string>('get_bucket_region', { bucketName });
  },

  async refreshS3Client(): Promise<void> {
    return invoke<void>('refresh_s3_client');
  },
};

// Object types matching Rust backend
export interface S3Object {
  key: string;
  last_modified: string | null;
  size: number;
  storage_class: string | null;
}

export interface ListObjectsResult {
  objects: S3Object[];
  common_prefixes: string[];
  next_continuation_token: string | null;
  is_truncated: boolean;
  prefix: string;
  bucket_region?: string;
}

export const objectApi = {
  async listObjects(bucketName: string, bucketRegion?: string, prefix = '', delimiter = '/', continuationToken?: string, bypassCache = false): Promise<ListObjectsResult> {
    return invoke<ListObjectsResult>('list_objects', { 
      bucketName, 
      bucketRegion,
      prefix: prefix || null, 
      delimiter: delimiter === undefined ? null : delimiter,
      continuationToken: continuationToken || null,
      bypassCache
    });
  },

  async searchObjects(bucketName: string, bucketRegion: string | undefined, query: string, prefix: string = ''): Promise<S3Object[]> {
    return invoke<S3Object[]>('search_objects', { bucketName, bucketRegion, query, prefix: prefix || null });
  },

  async getPresignedUrl(bucketName: string, bucketRegion: string | undefined, key: string, expiresIn: number = 3600): Promise<string> {
    return invoke<string>('get_presigned_url', { bucketName, bucketRegion, key, expiresIn });
  },

  async getObjectContent(bucketName: string, bucketRegion: string | undefined, key: string): Promise<string> {
    return invoke<string>('get_object_content', { bucketName, bucketRegion, key });
  },

  async putObjectContent(bucketName: string, bucketRegion: string | undefined, key: string, content: string): Promise<void> {
    return invoke<void>('put_object_content', { bucketName, bucketRegion, key, content });
  },
};

export const operationsApi = {
  async putObject(bucketName: string, bucketRegion: string | undefined, key: string, localPath?: string): Promise<void> {
    await invoke<void>('put_object', { bucketName, bucketRegion, key, localPath });
    invalidateCache(); // Auto-refresh after upload
  },

  async getObject(bucketName: string, bucketRegion: string | undefined, key: string, localPath: string): Promise<void> {
    return invoke<void>('get_object', { bucketName, bucketRegion, key, localPath });
  },

  async deleteObject(bucketName: string, bucketRegion: string | undefined, key: string): Promise<void> {
    await invoke<void>('delete_object', { bucketName, bucketRegion, key });
    invalidateCache(); // Auto-refresh after delete
  },

  async copyObject(sourceBucket: string, sourceRegion: string | undefined, sourceKey: string, destinationBucket: string, destinationRegion: string | undefined, destinationKey: string): Promise<void> {
    await invoke<void>('copy_object', { sourceBucket, sourceRegion, sourceKey, destinationBucket, destinationRegion, destinationKey });
    invalidateCache(); // Auto-refresh after copy
  },

  async moveObject(sourceBucket: string, sourceRegion: string | undefined, sourceKey: string, destinationBucket: string, destinationRegion: string | undefined, destinationKey: string): Promise<void> {
    await invoke<void>('move_object', { sourceBucket, sourceRegion, sourceKey, destinationBucket, destinationRegion, destinationKey });
    invalidateCache(); // Auto-refresh after move
  },

  async deleteObjects(bucketName: string, bucketRegion: string | undefined, keys: string[]): Promise<void> {
    await invoke<void>('delete_objects', { bucketName, bucketRegion, keys });
    invalidateCache(); // Auto-refresh after bulk delete
  },

  async getObjectMetadata(bucketName: string, bucketRegion: string | undefined, key: string): Promise<ObjectMetadata> {
    return invoke<ObjectMetadata>('get_object_metadata', { bucketName, bucketRegion, key });
  },
};

export interface ObjectMetadata {
  key: string;
  size: number;
  last_modified: string | null;
  content_type: string | null;
  e_tag: string | null;
  storage_class: string | null;
  user_metadata: Record<string, string>;
}

export interface TransferJob {
  id: string;
  transfer_type: 'Upload' | 'Download';
  bucket: string;
  bucket_region: string | null;
  key: string;
  local_path: string;
  total_bytes: number;
  processed_bytes: number;
  status: 'Pending' | 'InProgress' | 'Completed' | { Failed: string } | 'Paused' | 'Cancelled';
  created_at: number; // milliseconds
  finished_at?: number; // milliseconds
  parent_group_id?: string;
  group_name?: string;
  is_group_root?: boolean;
}

export interface TransferEvent {
  job_id: string;
  processed_bytes: number;
  total_bytes: number;
  status: TransferJob['status'];
  finished_at?: number;
}

export const transferApi = {
  async queueUpload(bucketName: string, bucketRegion: string | undefined, key: string, localPath: string, totalBytes: number): Promise<string> {
    return invoke<string>('queue_upload', { bucketName, bucketRegion, key, localPath, totalBytes });
  },

  async queueDownload(bucketName: string, bucketRegion: string | undefined, key: string, localPath: string, totalBytes: number): Promise<string> {
    return invoke<string>('queue_download', { bucketName, bucketRegion, key, localPath, totalBytes });
  },

  async queueFolderUpload(bucketName: string, bucketRegion: string | undefined, prefix: string, localPath: string): Promise<number> {
    return invoke<number>('queue_folder_upload', { bucketName, bucketRegion, prefix, localPath });
  },

  async queueFolderDownload(bucketName: string, bucketRegion: string | undefined, prefix: string, localPath: string): Promise<number> {
    return invoke<number>('queue_folder_download', { bucketName, bucketRegion, prefix, localPath });
  },

  async listTransfers(): Promise<TransferJob[]> {
    return invoke<TransferJob[]>('list_transfers');
  },

  async cancelTransfer(jobId: string): Promise<boolean> {
    return invoke<boolean>('cancel_transfer', { jobId });
  },

  async retryTransfer(jobId: string): Promise<string | null> {
    return invoke<string | null>('retry_transfer', { jobId });
  },

  async removeTransfer(jobId: string): Promise<boolean> {
    return invoke<boolean>('remove_transfer', { jobId });
  },

  async clearCompletedTransfers(): Promise<number> {
    return invoke<number>('clear_completed_transfers');
  },
};
