'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ListObjectsResult, objectApi, S3Object } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

interface BucketStats {
  totalCount: number;
  totalSize: number;
  isCached: boolean;
  isBackgroundLoading: boolean;
}

interface UseObjectsResult {
  data: ListObjectsResult | null;
  isLoading: boolean;
  error: string | null;
  stats: BucketStats;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  isLoadingMore: boolean;
  hasMore: boolean;
  folderTotalCount: number;
}

export function useObjects(bucketName: string, bucketRegion?: string, prefix = ''): UseObjectsResult {
  const [data, setData] = useState<ListObjectsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BucketStats>({ 
    totalCount: 0, 
    totalSize: 0, 
    isCached: false, 
    isBackgroundLoading: false 
  });
  
  const { activeProfileId } = useProfileStore();
  
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [folderTotalCount, setFolderTotalCount] = useState(0);
  
  const lastKey = useRef<string>('');
  const fetchInProgress = useRef(false);

  // Core fetch function - now returns result for downstream logic
  const fetchItems = useCallback(async (bypassCache = false) => {
    if (!bucketName || !activeProfileId) return null;
    
    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await objectApi.listObjects(bucketName, bucketRegion, prefix, '/', undefined, bypassCache);
      setData(result);
      setContinuationToken(result.next_continuation_token || null);
      setHasMore(!!result.next_continuation_token);
      const folderTotal = result.folder_total_objects + result.folder_total_prefixes;
      if (folderTotal > 0) {
          setFolderTotalCount(folderTotal);
      }
      return result;
    } catch (err: any) {
      // Only log detailed errors in development
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to load bucket "${bucketName}" with prefix "${prefix}":`, err);
      }
      
      let msg = 'Failed to load objects';
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'string') {
        msg = err;
      } else if (typeof err === 'object' && err !== null) {
        msg = err.message || err.error || 'Bucket access failed';
      }
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId]);

  // Combined effect for navigation and synchronization
  useEffect(() => {
    let cancelled = false;
    const currentKey = `${activeProfileId}:${bucketName}:${prefix}`;
    
    if (lastKey.current === currentKey) return;

    // Only reset bucket-wide stats if it's a completely different bucket
    const bucketKey = `${activeProfileId}:${bucketName}`;
    const previousBucketKey = lastKey.current.split(':').slice(0, 2).join(':');
    
    if (previousBucketKey && previousBucketKey !== bucketKey) {
        setStats({ totalCount: 0, totalSize: 0, isCached: false, isBackgroundLoading: false });
    }
    
    lastKey.current = currentKey;

    // Fast state reset for navigation
    setData(null);
    setIsLoading(true);
    setContinuationToken(null);
    setHasMore(false);
    setFolderTotalCount(0);

    const run = async () => {
      // 1. Initial Load - Prioritizes cache (Ultra Fast)
      const initialData = await fetchItems(false);
      if (cancelled) return;

      // 2. Background Sync - Fetch all objects for stats/search
      // Rust backend now handles the "already cached" check efficiently
      setStats(prev => ({ ...prev, isBackgroundLoading: !prev.isCached }));
      
      try {
        const totalCount = await objectApi.fetchAllObjects(bucketName, bucketRegion);
        if (!cancelled) {
          setStats({ totalCount, totalSize: 0, isCached: true, isBackgroundLoading: false });
          
          // 3. Smart Refresh: If initial load was truncated or empty, refresh from now-filled cache
          const wasTruncated = initialData?.next_continuation_token || (initialData?.objects.length === 1000);
          const wasEmpty = !initialData || (initialData.objects.length === 0 && initialData.common_prefixes.length === 0);
          
          if (wasTruncated || wasEmpty) {
            await fetchItems(false);
          }
        }
      } catch (e) {
        if (!cancelled) setStats(prev => ({ ...prev, isBackgroundLoading: false }));
      }
    };

    run();

    return () => { cancelled = true; };
  }, [bucketName, bucketRegion, prefix, activeProfileId, fetchItems]);

  const loadMore = useCallback(async () => {
    if (!bucketName || !activeProfileId || !continuationToken || isLoadingMore || fetchInProgress.current) return;
    
    setIsLoadingMore(true);
    try {
       // Pagination works on both S3 (via token) and Cache (via offset token)
       const result = await objectApi.listObjects(bucketName, bucketRegion, prefix, '/', continuationToken);
       setData(prev => {
         if (!prev) return result;
         // Deduplicate common prefixes
         const uniquePrefixes = Array.from(new Set([...prev.common_prefixes, ...result.common_prefixes]));
         return {
           ...result,
           objects: [...prev.objects, ...result.objects],
           common_prefixes: uniquePrefixes,
           prefix: prev.prefix
         };
       });
       setContinuationToken(result.next_continuation_token || null);
       setHasMore(!!result.next_continuation_token);
       const folderTotal = result.folder_total_objects + result.folder_total_prefixes;
       if (folderTotal > 0) {
           setFolderTotalCount(folderTotal);
       }
    } catch (err) {
       console.error('Load more error:', err);
    } finally {
       setIsLoadingMore(false);
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId, continuationToken, isLoadingMore]);

  const refresh = useCallback(async () => {
    if (!bucketName || !activeProfileId || fetchInProgress.current) return;
    
    // Refresh protocol:
    // 1. Force S3 fetch (bypass cache) to show immediate changes
    await fetchItems(true);
    
    // 2. Trigger background cache update
    setStats(prev => ({ ...prev, isBackgroundLoading: true }));
    try {
        const count = await objectApi.fetchAllObjects(bucketName, bucketRegion);
        setStats({ totalCount: count, totalSize: 0, isCached: true, isBackgroundLoading: false });
        // 3. Update view from full cache
        await fetchItems(false);
    } catch (e) {
        setStats(prev => ({ ...prev, isBackgroundLoading: false }));
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId, fetchItems]);

  return { data, isLoading, error, stats, refresh, loadMore, hasMore, isLoadingMore, folderTotalCount };
}
